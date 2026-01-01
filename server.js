const express = require("express");
const cors = require("cors");
const path = require("path");
const fetch = require("node-fetch"); // ✅ node-fetch v2
const db = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Render 端口（必须）
const PORT = process.env.PORT || 3000;

// ✅ 静态网页
app.use(express.static("public"));

/**
 * =========================
 * ✅ 简单管理员认证（只保护 /api/admin）
 * =========================
 */
const ADMIN_KEY = process.env.ADMIN_KEY || "admin123";

// ✅ 只保护 /api/admin 开头的接口
app.use("/api/admin", (req, res, next) => {
  const key = req.query.key || req.headers["x-admin-key"];
  if (key !== ADMIN_KEY) {
    return res.status(401).json({ error: "Unauthorized (admin only)" });
  }
  next();
});

/**
 * =========================
 * ✅ Binance 公共接口（K线）
 * =========================
 * 前端会请求：
 * /api/klines?symbol=BTCUSDT&interval=1m
 * 我们这里代理到 Binance API：
 * https://api.binance.com/api/v3/klines
 */
app.get("/api/klines", async (req, res) => {
  try {
    const symbol = (req.query.symbol || "BTCUSDT").toUpperCase();
    const interval = req.query.interval || "1m";
    const limit = parseInt(req.query.limit || "200", 10);

    // ✅ Binance 支持的 interval: 1m, 3m, 5m, 15m, 30m, 1h, 4h, 1d ...
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

    const r = await fetch(url, {
      headers: {
        "User-Agent": "crypto-sim"
      }
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(500).json({ error: "Binance API error", detail: text });
    }

    const raw = await r.json();

    // ✅ Binance 返回数组格式：
    // [ openTime, open, high, low, close, volume, closeTime, ... ]
    // 我们转换成 lightweight-charts 需要的格式：
    // { time: 秒级时间戳, open, high, low, close }
    const candles = raw.map(k => ({
      time: Math.floor(k[0] / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
    }));

    res.json(candles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * ✅ 可选：获取某币最新价格（不一定要用）
 */
app.get("/api/price", async (req, res) => {
  try {
    const symbol = (req.query.symbol || "BTCUSDT").toUpperCase();
    const url = `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`;
    const r = await fetch(url);
    const data = await r.json();
    res.json(data); // {symbol, price}
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * =========================
 * ✅ 普通用户接口（公开）
 * =========================
 */

// 1) 获取币种列表
app.get("/api/coins", (req, res) => {
  db.all("SELECT * FROM coins", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 2) 获取余额（demo 用户）
app.get("/api/balance", (req, res) => {
  const user = "demo";
  db.all("SELECT * FROM balances WHERE user = ?", [user], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 3) 买币
app.post("/api/buy", (req, res) => {
  const user = "demo";
  const { symbol, amount } = req.body;

  db.get("SELECT price FROM coins WHERE symbol = ?", [symbol], (err, coin) => {
    if (err || !coin) return res.status(400).json({ error: "Coin not found" });

    const cost = coin.price * amount;

    db.get(
      "SELECT amount FROM balances WHERE user=? AND coin_symbol='USDT'",
      [user],
      (err, usdtRow) => {
        if (err) return res.status(500).json({ error: err.message });

        const usdt = usdtRow ? usdtRow.amount : 0;
        if (usdt < cost) return res.status(400).json({ error: "Not enough USDT" });

        db.run(
          "UPDATE balances SET amount = amount - ? WHERE user=? AND coin_symbol='USDT'",
          [cost, user]
        );

        db.run(
          `
          INSERT INTO balances(user, coin_symbol, amount)
          VALUES (?, ?, ?)
          ON CONFLICT(user, coin_symbol)
          DO UPDATE SET amount = amount + excluded.amount
        `,
          [user, symbol, amount]
        );

        db.run(
          `INSERT INTO transactions(user,type,coin_symbol,amount,price,total,note,created_at)
           VALUES (?,?,?,?,?,?,?,datetime('now'))`,
          [user, "buy", symbol, amount, coin.price, cost, ""]
        );

        res.json({ message: "Buy success", symbol, amount, cost });
      }
    );
  });
});

// 4) 卖币
app.post("/api/sell", (req, res) => {
  const user = "demo";
  const { symbol, amount } = req.body;

  db.get("SELECT price FROM coins WHERE symbol = ?", [symbol], (err, coin) => {
    if (err || !coin) return res.status(400).json({ error: "Coin not found" });

    const gain = coin.price * amount;

    db.get(
      "SELECT amount FROM balances WHERE user=? AND coin_symbol=?",
      [user, symbol],
      (err, coinRow) => {
        if (err) return res.status(500).json({ error: err.message });

        const coinBal = coinRow ? coinRow.amount : 0;
        if (coinBal < amount) return res.status(400).json({ error: "Not enough coin" });

        db.run(
          "UPDATE balances SET amount = amount - ? WHERE user=? AND coin_symbol=?",
          [amount, user, symbol]
        );

        db.run(
          `
          INSERT INTO balances(user, coin_symbol, amount)
          VALUES (?, 'USDT', ?)
          ON CONFLICT(user, coin_symbol)
          DO UPDATE SET amount = amount + excluded.amount
        `,
          [user, gain]
        );

        db.run(
          `INSERT INTO transactions(user,type,coin_symbol,amount,price,total,note,created_at)
           VALUES (?,?,?,?,?,?,?,datetime('now'))`,
          [user, "sell", symbol, amount, coin.price, gain, ""]
        );

        res.json({ message: "Sell success", symbol, amount, gain });
      }
    );
  });
});

// 5) 提现申请（用户）
app.post("/api/withdraw-request", (req, res) => {
  const user = "demo";
  const { coin_symbol, requested_amount, address } = req.body;

  db.run(
    `INSERT INTO withdraw_requests(user, coin_symbol, requested_amount, address, status, note, created_at)
     VALUES (?, ?, ?, ?, 'pending', '', datetime('now'))`,
    [user, coin_symbol, requested_amount, address || ""],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Withdraw request submitted", id: this.lastID, status: "pending" });
    }
  );
});

// 6) 充值申请（用户）
app.post("/api/deposit-request", (req, res) => {
  const user = "demo";
  const { coin_symbol, requested_amount } = req.body;

  db.run(
    `INSERT INTO deposit_requests(user, coin_symbol, requested_amount, status, note, created_at)
     VALUES (?, ?, ?, 'pending', '', datetime('now'))`,
    [user, coin_symbol, requested_amount],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Deposit request submitted", id: this.lastID, status: "pending" });
    }
  );
});

// 7) 用户查看自己的充值申请
app.get("/api/deposit-requests", (req, res) => {
  const user = "demo";
  db.all("SELECT * FROM deposit_requests WHERE user=? ORDER BY id DESC", [user], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 8) 用户查看自己的提现申请
app.get("/api/withdraw-requests", (req, res) => {
  const user = "demo";
  db.all("SELECT * FROM withdraw_requests WHERE user=? ORDER BY id DESC", [user], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 9) 交易记录
app.get("/api/transactions", (req, res) => {
  const user = "demo";
  db.all("SELECT * FROM transactions WHERE user=? ORDER BY id DESC", [user], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

/**
 * =========================
 * ✅ 后台管理员接口（必须带 key）
 * =========================
 */

// 管理员查看所有充值申请
app.get("/api/admin/deposits", (req, res) => {
  db.all("SELECT * FROM deposit_requests ORDER BY id DESC", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 管理员审批充值
app.post("/api/admin/deposits/:id/approve", (req, res) => {
  const id = req.params.id;
  const { approved_amount, note } = req.body;

  db.get("SELECT * FROM deposit_requests WHERE id=?", [id], (err, row) => {
    if (err || !row) return res.status(404).json({ error: "Request not found" });

    db.run(
      `UPDATE deposit_requests SET approved_amount=?, status='approved', note=?, approved_at=datetime('now') WHERE id=?`,
      [approved_amount, note || "", id]
    );

    db.run(
      `
      INSERT INTO balances(user, coin_symbol, amount)
      VALUES (?, ?, ?)
      ON CONFLICT(user, coin_symbol)
      DO UPDATE SET amount = amount + excluded.amount
      `,
      [row.user, row.coin_symbol, approved_amount]
    );

    db.run(
      `INSERT INTO transactions(user,type,coin_symbol,amount,price,total,note,created_at)
       VALUES (?,?,?,?,?,?,?,datetime('now'))`,
      [row.user, "deposit", row.coin_symbol, approved_amount, null, approved_amount, note || ""]
    );

    res.json({ message: "Deposit approved and balance updated", id, status: "approved" });
  });
});

// 管理员查看提现申请
app.get("/api/admin/withdraws", (req, res) => {
  db.all("SELECT * FROM withdraw_requests ORDER BY id DESC", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 管理员审批提现
app.post("/api/admin/withdraws/:id/approve", (req, res) => {
  const id = req.params.id;
  const { approved_amount, note } = req.body;

  db.get("SELECT * FROM withdraw_requests WHERE id=?", [id], (err, row) => {
    if (err || !row) return res.status(404).json({ error: "Request not found" });

    db.get(
      "SELECT amount FROM balances WHERE user=? AND coin_symbol=?",
      [row.user, row.coin_symbol],
      (err, balRow) => {
        if (err) return res.status(500).json({ error: err.message });

        const bal = balRow ? balRow.amount : 0;
        if (bal < approved_amount) return res.status(400).json({ error: "Not enough balance" });

        db.run(
          "UPDATE balances SET amount = amount - ? WHERE user=? AND coin_symbol=?",
          [approved_amount, row.user, row.coin_symbol]
        );

        db.run(
          `UPDATE withdraw_requests SET approved_amount=?, status='approved', note=?, approved_at=datetime('now') WHERE id=?`,
          [approved_amount, note || "", id]
        );

        db.run(
          `INSERT INTO transactions(user,type,coin_symbol,amount,price,total,note,created_at)
           VALUES (?,?,?,?,?,?,?,datetime('now'))`,
          [row.user, "withdraw", row.coin_symbol, approved_amount, null, approved_amount, note || ""]
        );

        res.json({ message: "Withdraw approved and balance updated", id, status: "approved" });
      }
    );
  });
});

// ✅ 健康检查
app.get("/api/health", (req, res) => res.json({ ok: true }));

// ✅ 启动
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
});
