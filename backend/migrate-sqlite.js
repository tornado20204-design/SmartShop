require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getDb, closeDb } = require('./db');
const logger = require('./logger');

const productsPath = path.join(__dirname, 'products.json');
const usersPath = path.join(__dirname, 'users.json');
const ordersPath = path.join(__dirname, 'orders.json');
const auditPath = path.join(__dirname, 'audit.json');

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8').trim();
    return content ? JSON.parse(content) : [];
  } catch (err) {
    logger.error(`Error reading ${filePath}: ${err.message}`);
    return [];
  }
}

async function migrate() {
  logger.info('Starting migration from JSON to SQLite...');
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  db.exec('DELETE FROM products; DELETE FROM users; DELETE FROM orders; DELETE FROM audit_logs;');

  // USERS (20 columns)
  const users = readJson(usersPath);
  let userCount = 0;
  const uSql = db.prepare('INSERT INTO users (id,name,email,phone,password,role,avatar,walletBalance,kycStatus,passportNumber,birthDate,sellerType,passportPhoto,selfieUrl,bankDetails,rejectionReason,rejectionCount,specialization,addresses,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const uMany = db.transaction((list) => {
    for (const u of list) { uSql.run(u.id,u.name||'',u.email||'',u.phone||'',u.password||'',u.role||'user',u.avatar||'',u.walletBalance||0,u.kycStatus||'approved',u.passportNumber||'',u.birthDate||'',u.sellerType||'jismoniy',u.passportPhoto||'',u.selfieUrl||'',u.bankDetails||'',u.rejectionReason||'',u.rejectionCount||0,u.specialization||'',Array.isArray(u.addresses)?u.addresses.join('\n'):(u.addresses||''),u.createdAt||new Date().toISOString()); userCount++; }
  });
  uMany(users);
  logger.info(`Migrated ${userCount} users`);

  // PRODUCTS (15 columns)
  const products = readJson(productsPath);
  let productCount = 0;
  const pSql = db.prepare('INSERT INTO products (id,name,price,cost,description,image,category,stock,originalPrice,returnDays,rating,reviews,sellerId,sellerName,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const pMany = db.transaction((list) => {
    for (const p of list) { pSql.run(p.id,p.name||'',p.price||0,p.cost||0,p.description||'',p.image||'smartphone.png',p.category||'Elektronika',p.stock||0,p.originalPrice||null,p.returnDays||0,p.rating||5.0,JSON.stringify(p.reviews||[]),p.sellerId||null,p.sellerName||'',p.createdAt||new Date().toISOString()); productCount++; }
  });
  pMany(products);
  logger.info(`Migrated ${productCount} products`);

  // ORDERS (18 columns)
  const orders = readJson(ordersPath);
  let orderCount = 0;
  const oSql = db.prepare('INSERT INTO orders (id,userId,items,total,status,deliveryMethod,customerName,customerPhone,customerAddress,pickupPoint,courierName,courierPhone,courierVehicle,estimatedDeliveryTime,cashbackEarned,paymentMethod,promoDiscount,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const oMany = db.transaction((list) => {
    for (const o of list) { oSql.run(o.id,o.userId||null,JSON.stringify(o.items||[]),o.total||0,o.status||'Tayyorlanmoqda',o.deliveryMethod||'pickup',o.customerName||o.name||'',o.customerPhone||o.phone||'',o.customerAddress||o.address||'',o.pickupPoint||'',o.courierName||'',o.courierPhone||'',o.courierVehicle||'',o.estimatedDeliveryTime||30,o.cashbackEarned||0,o.paymentMethod||'full',o.promoDiscount||0,o.createdAt||new Date().toISOString()); orderCount++; }
  });
  oMany(orders);
  logger.info(`Migrated ${orderCount} orders`);

  // AUDIT LOGS (6 columns)
  const auditLogs = readJson(auditPath);
  let auditCount = 0;
  const aSql = db.prepare('INSERT INTO audit_logs (actorId,actorRole,action,targetId,details,timestamp) VALUES (?,?,?,?,?,?)');
  const aMany = db.transaction((list) => {
    for (const l of list) { aSql.run(l.actorId||null,l.actorRole||'',l.action||'',String(l.targetId||''),typeof l.details==='object'?JSON.stringify(l.details):(l.details||''),l.timestamp||new Date().toISOString()); auditCount++; }
  });
  aMany(auditLogs);
  logger.info(`Migrated ${auditCount} audit logs`);

  db.exec("DELETE FROM sqlite_sequence WHERE name IN ('users','products','orders','audit_logs','otp_codes','password_resets')");
  logger.info('Migration completed successfully!');
  db.pragma('foreign_keys = ON');
  closeDb();
}

migrate().catch(err => { logger.error('Migration failed:', err); closeDb(); process.exit(1); });