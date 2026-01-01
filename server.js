const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const db = require("./db");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

/**
 * ✅ 1) 获取币种列表（从数据库）
 */
app.get("/api/coins", (req, res) => {
  db.all("SELECT * FROM coins", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

/**
 * ✅ 2) 获取余额（demo 用户）
 */
app.get("/api/balance", (req, res) => {
  const user = "demo";
  db.all("SELECT * FROM balances WHERE user = ?", [user], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

/**
 * ✅ 3) 买币
 */
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

        res.json({ message: "Buy success", symbol, amount, cost });
      }
    );
  });
});

/**
 * ✅ 4) 卖币
 */
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

        res.json({ message: "Sell success", symbol, amount, gain });
      }
    );
  });
});

/**
 * ✅ 5) Binance Klines (公开行情)
 * /api/klines?symbol=BTCUSDT&interval=1m
 */
app.get("/api/klines", async (req, res) => {
  try {
    const symbol = req.query.symbol || "BTCUSDT";
    const interval = req.query.interval || "1m";
    const limit = req.query.limit || 200;

    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const r = await fetch(url);

    if (!r.ok) {
      return res.status(500).json({ error: "Binance API error", status: r.status });
    }

    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * ✅ Render 必须用 PORT 环境变量
 */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running: http://localhost:${PORT}`);
});
