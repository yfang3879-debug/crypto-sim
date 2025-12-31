const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./exchange.db");

// ✅ 初始化数据库
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
      PRIMARY KEY (user, coin_symbol)
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
      status TEXT,         -- pending / approved / rejected
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
      status TEXT,         -- pending / approved / rejected
      note TEXT,
      created_at TEXT,
      approved_at TEXT
    )
  `);

  // 5) 交易记录表
  db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user TEXT,
      type TEXT,          -- buy / sell / deposit / withdraw
      coin_symbol TEXT,
      amount REAL,
      price REAL,
      total REAL,
      note TEXT,
      created_at TEXT
    )
  `);

  // ✅ 6) 用户表：username + pin（简单版本，不加密）
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      pin TEXT,
      created_at TEXT
    )
  `);

  // ✅ 初始化默认币种
  db.run(`INSERT OR IGNORE INTO coins(symbol, price) VALUES ('BTC', 50000)`);
  db.run(`INSERT OR IGNORE INTO coins(symbol, price) VALUES ('ETH', 2500)`);
  db.run(`INSERT OR IGNORE INTO coins(symbol, price) VALUES ('BNB', 300)`);
  db.run(`INSERT OR IGNORE INTO coins(symbol, price) VALUES ('SOL', 100)`);
  db.run(`INSERT OR IGNORE INTO coins(symbol, price) VALUES ('USDT', 1)`);

  // ✅ 初始化默认用户 demo / admin
  const now = new Date().toISOString();
  db.run(`INSERT OR IGNORE INTO users(username, pin, created_at) VALUES ('demo', '1234', ?)`, [now]);
  db.run(`INSERT OR IGNORE INTO users(username, pin, created_at) VALUES ('admin', 'admin123', ?)`, [now]);

  // ✅ 给 demo 初始化余额
  db.run(`
    INSERT OR IGNORE INTO balances(user, coin_symbol, amount)
    VALUES ('demo', 'USDT', 10000)
  `);

  // ✅ 给 admin 初始化余额（可选）
  db.run(`
    INSERT OR IGNORE INTO balances(user, coin_symbol, amount)
    VALUES ('admin', 'USDT', 0)
  `);
});

module.exports = db;
