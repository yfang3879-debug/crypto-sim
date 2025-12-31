const sqlite3 = require("sqlite3").verbose();
const path = require("path");

// ✅ Render 环境建议把 DB 放在项目目录下（本地/云都可用）
const dbPath = path.join(__dirname, "exchange.db");
const db = new sqlite3.Database(dbPath);

// ✅ 初始化数据库（建表 + 默认数据）
db.serialize(() => {
  // 1) 币种表
  db.run(`
    CREATE TABLE IF NOT EXISTS coins (
      symbol TEXT PRIMARY KEY,
      price REAL
    )
  `);

  // 2) 余额表
  db.run(`
    CREATE TABLE IF NOT EXISTS balances (
      user TEXT,
      coin_symbol TEXT,
      amount REAL,
      PRIMARY KEY(user, coin_symbol)
    )
  `);

  // 3) 充值申请表
  db.run(`
    CREATE TABLE IF NOT EXISTS deposit_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user TEXT,
      coin_symbol TEXT,
      requested_amount REAL,
      approved_amount REAL,
      address TEXT,
      status TEXT,
      note TEXT,
      created_at TEXT,
      approved_at TEXT
    )
  `);

  // 4) 提币申请表
  db.run(`
    CREATE TABLE IF NOT EXISTS withdraw_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user TEXT,
      coin_symbol TEXT,
      requested_amount REAL,
      approved_amount REAL,
      address TEXT,
      status TEXT,
      note TEXT,
      created_at TEXT,
      approved_at TEXT
    )
  `);

  // 5) 交易记录表（买/卖/充值/提币）
  db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user TEXT,
      type TEXT,
      coin_symbol TEXT,
      amount REAL,
      price REAL,
      total REAL,
      note TEXT,
      created_at TEXT
    )
  `);

  // 6) 用户表（用于后续登录）
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      created_at TEXT
    )
  `);

  // ✅ 默认币种（如果不存在才插入）
  const defaultCoins = [
    ["BTC", 50000],
    ["ETH", 3000],
    ["BNB", 600],
    ["SOL", 100],
    ["XRP", 0.5],
    ["DOGE", 0.1],
    ["USDT", 1],
  ];

  defaultCoins.forEach(([symbol, price]) => {
    db.run(
      `INSERT OR IGNORE INTO coins(symbol, price) VALUES (?, ?)`,
      [symbol, price]
    );
  });

  // ✅ 默认 demo 余额（没有就插入）
  db.run(
    `INSERT OR IGNORE INTO balances(user, coin_symbol, amount)
     VALUES ('demo', 'USDT', 10000)`
  );

  db.run(
    `INSERT OR IGNORE INTO balances(user, coin_symbol, amount)
     VALUES ('demo', 'BTC', 0)`
  );
});

module.exports = db;
