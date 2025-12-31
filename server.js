const express = require("express");
const cors = require("cors");
const db = require("./db");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

function nowISO() {
  return new Date().toISOString();
}

// ===========================
// ✅ Auth: 简单 username + pin
// 前端每次请求都带：
// headers: { "x-user": username, "x-pin": pin }
// ===========================
function authRequired(req, res, next) {
  const user = req.headers["x-user"];
  const pin = req.headers["x-pin"];

  if (!user || !pin) {
    return res.status(401).json({ error: "Missing login headers" });
  }

  db.get("SELECT * FROM users WHERE username = ? AND pin = ?", [user, pin], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(401).json({ error: "Invalid user or pin" });
    req.user = user;
    next();
  });
}

function adminRequired(req, res, next) {
  const user = req.headers["x-user"];
  const pin = req.headers["x-pin"];

  if (!user || !pin) return res.status(401).json({ error: "Missing admin login headers" });

  db.get("SELECT * FROM users WHERE username = 'admin' AND pin = ?", [pin], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row || user !== "admin") return res.status(403).json({ error: "Admin only" });
    req.user = "admin";
    next();
  });
}

// ===========================
// ✅ Auth APIs
// ===========================

// 注册：username + pin
app.post("/api/auth/register", (req, res) => {
  const { username, pin } = req.body;

  if (!username || !pin) return res.status(400).json({ error: "username and pin required" });
  if (String(username).length < 2) return res.status(400).json({ error: "username too short" });
  if (String(pin).length < 4) return res.status(400).json({ error: "pin must be >= 4 chars" });

  const u = String(username).trim();

  db.get("SELECT username FROM users WHERE username=?", [u], (err, exists) => {
    if (err) return res.status(500).json({ error: err.message });
    if (exists) return res.status(400).json({ error: "Username already exists" });

    db.run(
      "INSERT INTO users(username, pin, created_at) VALUES (?, ?, ?)",
      [u, String(pin), nowISO()],
      (err2) => {
        if (err2) return res.status(500).json({ error: err2.message });

        // 初始化余额：USDT=10000
        db.run(
          "INSERT OR IGNORE INTO balances(user, coin_symbol, amount) VALUES (?, 'USDT', 10000)",
          [u],
          () => {
            res.json({ message: "Register success", username: u });
          }
        );
      }
    );
  });
});

// 登录：校验 username + pin
app.post("/api/auth/login", (req, res) => {
  const { username, pin } = req.body;
  if (!username || !pin) return res.status(400).json({ error: "username and pin required" });

  db.get("SELECT username FROM users WHERE username=? AND pin=?", [String(username).trim(), String(pin)], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(401).json({ error: "Invalid username or pin" });
    res.json({ message: "Login success", username: row.username });
  });
});

// ===========================
// ✅ Public APIs（需要登录）
// ===========================

// 币种列表
app.get("/api/coins", (req, res) => {
  db.all("SELECT * FROM coins", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 余额（登录用户）
app.get("/api/balance", authRequired, (req, res) => {
  const user = req.user;
  db.all("SELECT * FROM balances WHERE user = ?", [user], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 交易记录（登录用户）
app.get("/api/transactions", authRequired, (req, res) => {
  const user = req.user;
  db.all(
    "SELECT * FROM transactions WHERE user=? ORDER BY id DESC LIMIT 50",
    [user],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// ===========================
// ✅ Buy / Sell（内部账本）
// ===========================

// 买币：用 USDT 买 selectedCoin
app.post("/api/buy", authRequired, (req, res) => {
  const user = req.user;
  const { symbol, amount } = req.body;
  if (!symbol || !amount) return res.status(400).json({ error: "symbol and amount required" });

  db.get("SELECT price FROM coins WHERE symbol = ?", [symbol], (err, coin) => {
    if (err || !coin) return res.status(400).json({ error: "Coin not found" });

    const cost = coin.price * amount;

    db.get(
      "SELECT amount FROM balances WHERE user=? AND coin_symbol='USDT'",
      [user],
      (err2, usdtRow) => {
        if (err2) return res.status(500).json({ error: err2.message });

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
          `
          INSERT INTO transactions(user, type, coin_symbol, amount, price, total, note, created_at)
          VALUES (?, 'buy', ?, ?, ?, ?, '', ?)
        `,
          [user, symbol, amount, coin.price, cost, nowISO()]
        );

        res.json({ message: "Buy success", user, symbol, amount, price: coin.price, total: cost });
      }
    );
  });
});

// 卖币：卖 selectedCoin 换 USDT
app.post("/api/sell", authRequired, (req, res) => {
  const user = req.user;
  const { symbol, amount } = req.body;
  if (!symbol || !amount) return res.status(400).json({ error: "symbol and amount required" });

  db.get("SELECT price FROM coins WHERE symbol = ?", [symbol], (err, coin) => {
    if (err || !coin) return res.status(400).json({ error: "Coin not found" });

    const gain = coin.price * amount;

    db.get(
      "SELECT amount FROM balances WHERE user=? AND coin_symbol=?",
      [user, symbol],
      (err2, coinRow) => {
        if (err2) return res.status(500).json({ error: err2.message });

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
          `
          INSERT INTO transactions(user, type, coin_symbol, amount, price, total, note, created_at)
          VALUES (?, 'sell', ?, ?, ?, ?, '', ?)
        `,
          [user, symbol, amount, coin.price, gain, nowISO()]
        );

        res.json({ message: "Sell success", user, symbol, amount, price: coin.price, total: gain });
      }
    );
  });
});

// ===========================
// ✅ Deposit / Withdraw Requests
// ===========================

// 用户提交充值申请
app.post("/api/deposit-request", authRequired, (req, res) => {
  const user = req.user;
  const { coin_symbol, requested_amount } = req.body;
  if (!coin_symbol || !requested_amount) return res.status(400).json({ error: "coin_symbol and requested_amount required" });

  db.run(
    `
    INSERT INTO deposit_requests(user, coin_symbol, requested_amount, approved_amount, address, status, note, created_at, approved_at)
    VALUES (?, ?, ?, NULL, '', 'pending', '', ?, NULL)
  `,
    [user, coin_symbol, requested_amount, nowISO()],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Deposit request submitted", id: this.lastID, user, coin_symbol, requested_amount, status: "pending" });
    }
  );
});

// 用户查看自己的充值申请
app.get("/api/deposit-requests", authRequired, (req, res) => {
  const user = req.user;
  db.all("SELECT * FROM deposit_requests WHERE user=? ORDER BY id DESC LIMIT 50", [user], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 用户提交提币申请
app.post("/api/withdraw-request", authRequired, (req, res) => {
  const user = req.user;
  const { coin_symbol, requested_amount, address } = req.body;
  if (!coin_symbol || !requested_amount) return res.status(400).json({ error: "coin_symbol and requested_amount required" });

  db.run(
    `
    INSERT INTO withdraw_requests(user, coin_symbol, requested_amount, approved_amount, address, status, note, created_at, approved_at)
    VALUES (?, ?, ?, NULL, ?, 'pending', '', ?, NULL)
  `,
    [user, coin_symbol, requested_amount, address || "", nowISO()],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Withdraw request submitted", id: this.lastID, user, coin_symbol, requested_amount, status: "pending" });
    }
  );
});

// 用户查看自己的提币申请
app.get("/api/withdraw-requests", authRequired, (req, res) => {
  const user = req.user;
  db.all("SELECT * FROM withdraw_requests WHERE user=? ORDER BY id DESC LIMIT 50", [user], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// ===========================
// ✅ Admin APIs（管理员）
// ===========================

// 管理员：查看所有用户（不返回 pin）
app.get("/api/admin/users", adminRequired, (req, res) => {
  db.all("SELECT username, created_at FROM users ORDER BY created_at DESC", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 管理员：重置用户 PIN（不显示原 PIN）
app.post("/api/admin/users/:username/reset-pin", adminRequired, (req, res) => {
  const username = req.params.username;
  const { new_pin } = req.body;

  if (!new_pin || String(new_pin).length < 4) {
    return res.status(400).json({ error: "new_pin must be >= 4 chars" });
  }

  db.run("UPDATE users SET pin=? WHERE username=?", [String(new_pin), username], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "User not found" });
    res.json({ message: "PIN reset success", username });
  });
});

// 管理员：查看充值列表
app.get("/api/admin/deposits", adminRequired, (req, res) => {
  db.all("SELECT * FROM deposit_requests ORDER BY id DESC LIMIT 100", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 管理员：审批充值
app.post("/api/admin/deposits/:id/approve", adminRequired, (req, res) => {
  const id = req.params.id;
  const { approved_amount, note } = req.body;

  if (approved_amount === undefined) return res.status(400).json({ error: "approved_amount required" });

  db.get("SELECT * FROM deposit_requests WHERE id=?", [id], (err, row) => {
    if (err || !row) return res.status(404).json({ error: "Deposit request not found" });
    if (row.status !== "pending") return res.status(400).json({ error: "Already processed" });

    db.run(
      "UPDATE deposit_requests SET approved_amount=?, status='approved', note=?, approved_at=? WHERE id=?",
      [approved_amount, note || "", nowISO(), id]
    );

    // 增加余额
    db.run(
      `
      INSERT INTO balances(user, coin_symbol, amount)
      VALUES (?, ?, ?)
      ON CONFLICT(user, coin_symbol)
      DO UPDATE SET amount = amount + excluded.amount
    `,
      [row.user, row.coin_symbol, approved_amount]
    );

    // 写交易记录
    db.run(
      `
      INSERT INTO transactions(user, type, coin_symbol, amount, price, total, note, created_at)
      VALUES (?, 'deposit', ?, ?, NULL, ?, ?, ?)
    `,
      [row.user, row.coin_symbol, approved_amount, approved_amount, note || "", nowISO()]
    );

    res.json({
      message: "Deposit approved and balance updated",
      id: Number(id),
      user: row.user,
      coin_symbol: row.coin_symbol,
      approved_amount: Number(approved_amount),
      status: "approved"
    });
  });
});

// 管理员：查看提币列表
app.get("/api/admin/withdraws", adminRequired, (req, res) => {
  db.all("SELECT * FROM withdraw_requests ORDER BY id DESC LIMIT 100", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 管理员：审批提币（扣余额 + 写交易）
app.post("/api/admin/withdraws/:id/approve", adminRequired, (req, res) => {
  const id = req.params.id;
  const { approved_amount, note } = req.body;

  if (approved_amount === undefined) return res.status(400).json({ error: "approved_amount required" });

  db.get("SELECT * FROM withdraw_requests WHERE id=?", [id], (err, row) => {
    if (err || !row) return res.status(404).json({ error: "Withdraw request not found" });
    if (row.status !== "pending") return res.status(400).json({ error: "Already processed" });

    // 检查余额是否足够
    db.get(
      "SELECT amount FROM balances WHERE user=? AND coin_symbol=?",
      [row.user, row.coin_symbol],
      (err2, balRow) => {
        if (err2) return res.status(500).json({ error: err2.message });
        const bal = balRow ? balRow.amount : 0;
        if (bal < approved_amount) return res.status(400).json({ error: "User balance not enough" });

        db.run(
          "UPDATE withdraw_requests SET approved_amount=?, status='approved', note=?, approved_at=? WHERE id=?",
          [approved_amount, note || "", nowISO(), id]
        );

        db.run(
          "UPDATE balances SET amount = amount - ? WHERE user=? AND coin_symbol=?",
          [approved_amount, row.user, row.coin_symbol]
        );

        db.run(
          `
          INSERT INTO transactions(user, type, coin_symbol, amount, price, total, note, created_at)
          VALUES (?, 'withdraw', ?, ?, NULL, ?, ?, ?)
        `,
          [row.user, row.coin_symbol, approved_amount, approved_amount, note || "", nowISO()]
        );

        res.json({
          message: "Withdraw approved and balance deducted",
          id: Number(id),
          user: row.user,
          coin_symbol: row.coin_symbol,
          approved_amount: Number(approved_amount),
          status: "approved"
        });
      }
    );
  });
});

// ✅ Server start
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("✅ Server running on port", PORT);
});
