const path = require('path');
const Database = require('better-sqlite3');

let db;

function getDb() {
  if (db) return db;

  const dbPath = process.env.DB_PATH || path.join(__dirname, 'database.sqlite');
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      email TEXT UNIQUE,
      phone TEXT,
      password TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      avatar TEXT DEFAULT '',
      walletBalance REAL DEFAULT 0,
      kycStatus TEXT DEFAULT 'pending',
      passportNumber TEXT DEFAULT '',
      birthDate TEXT DEFAULT '',
      sellerType TEXT DEFAULT 'jismoniy',
      passportPhoto TEXT DEFAULT '',
      selfieUrl TEXT DEFAULT '',
      bankDetails TEXT DEFAULT '',
      rejectionReason TEXT DEFAULT '',
      rejectionCount INTEGER DEFAULT 0,
      specialization TEXT DEFAULT '',
      addresses TEXT DEFAULT '',
      token TEXT DEFAULT '',
      telegramToken TEXT DEFAULT '',
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      cost REAL DEFAULT 0,
      description TEXT DEFAULT '',
      image TEXT DEFAULT 'smartphone.png',
      category TEXT DEFAULT 'Elektronika',
      stock INTEGER DEFAULT 0,
      originalPrice REAL,
      returnDays INTEGER DEFAULT 0,
      rating REAL DEFAULT 5.0,
      reviews TEXT DEFAULT '[]',
      sellerId INTEGER,
      sellerName TEXT DEFAULT '',
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (sellerId) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER,
      items TEXT DEFAULT '[]',
      total REAL DEFAULT 0,
      status TEXT DEFAULT 'Tayyorlanmoqda',
      deliveryMethod TEXT DEFAULT 'pickup',
      customerName TEXT DEFAULT '',
      customerPhone TEXT DEFAULT '',
      customerAddress TEXT DEFAULT '',
      pickupPoint TEXT DEFAULT '',
      courierName TEXT DEFAULT '',
      courierPhone TEXT DEFAULT '',
      courierVehicle TEXT DEFAULT '',
      estimatedDeliveryTime INTEGER DEFAULT 30,
      cashbackEarned REAL DEFAULT 0,
      cashbackCredited INTEGER DEFAULT 0,
      transactionId TEXT DEFAULT '',
      paymentMethod TEXT DEFAULT 'full',
      promoDiscount REAL DEFAULT 0,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'UZS',
      description TEXT,
      provider TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      userId INTEGER NOT NULL,
      orderId INTEGER NOT NULL,
      createdAt TEXT DEFAULT (datetime('now')),
      confirmedAt TEXT,
      FOREIGN KEY (userId) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actorId INTEGER,
      actorRole TEXT DEFAULT '',
      action TEXT NOT NULL,
      targetId TEXT DEFAULT '',
      details TEXT DEFAULT '',
      timestamp TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (actorId) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS otp_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      code TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      used INTEGER DEFAULT 0,
      ip TEXT DEFAULT '',
      createdAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT (datetime('now'))
    );
  `);

  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb };
