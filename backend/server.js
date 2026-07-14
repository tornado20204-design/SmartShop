// .env yuklash
try { require('dotenv').config(); } catch(e) { /* dotenv mavjud emas */ }

// ============================================================
// SmartShop Backend Server v2.0 — SQLite + Xavfsiz versiya
// ============================================================
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('./db');
const { sendSMSNotification } = require('./smsNotification');
const smsService = require('./smsService');
const paymentService = require('./paymentService');
const { sendOrderEmail, sendPasswordResetEmail } = require('./emailService');

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(48).toString('hex');
const frontendDir = path.join(__dirname, '..', 'frontend');
const uploadsDir = path.join(__dirname, 'uploads');

const fs = require('fs');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// ===== LOGGER =====
function logInfo(tag, msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [INFO] [${tag}] ${msg}`);
}
function logWarn(tag, msg) {
  const ts = new Date().toISOString();
  console.warn(`[${ts}] [WARN] [${tag}] ${msg}`);
}
function logError(tag, msg, stack) {
  const ts = new Date().toISOString();
  console.error(`[${ts}] [ERROR] [${tag}] ${msg}`);
  if (stack) console.error(stack);
}
function logAudit(actorId, actorRole, action, targetId, details) {
  try {
    const db = getDb();
    db.prepare(`INSERT INTO audit_logs (actorId, actorRole, action, targetId, details, timestamp) VALUES (?, ?, ?, ?, ?, datetime('now'))`).run(actorId, actorRole, action, String(targetId || ''), details || '');
  } catch (err) {
    logError('AUDIT', `Audit yozishda xato: ${err.message}`);
  }
}

// ===== MIME TYPES =====
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function getRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch(e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function serveStaticFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';
  try {
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>404 — Sahifa topilmadi</h1>');
      return;
    }
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 
      'Content-Type': contentType,
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    res.end(content);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>500 — Server xatosi</h1>');
  }
}

// ===== RATE LIMITER (Login) =====
const loginAttempts = {};
function cleanLoginAttempts() {
  const now = Date.now();
  for (const key in loginAttempts) {
    const record = loginAttempts[key];
    if (record.blockedUntil < now && (!record.lastAttempt || now - record.lastAttempt > 30 * 60 * 1000)) {
      delete loginAttempts[key];
    }
  }
}
setInterval(cleanLoginAttempts, 5 * 60 * 1000);

function getIpAddress(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return forwarded ? forwarded.split(',')[0].trim() : req.socket.remoteAddress;
}

function checkLoginBlock(ip, identifier) {
  const now = Date.now();
  const keys = [`ip:${ip}`, `id:${identifier}`];
  for (const key of keys) {
    const record = loginAttempts[key];
    if (record && record.blockedUntil && record.blockedUntil > now) {
      return Math.ceil((record.blockedUntil - now) / 60000);
    }
  }
  return 0;
}

function recordLoginAttempt(ip, identifier, success) {
  const now = Date.now();
  const keys = [`ip:${ip}`, `id:${identifier}`];
  for (const key of keys) {
    if (!loginAttempts[key]) {
      loginAttempts[key] = { count: 0, blockedUntil: 0, lastAttempt: now };
    }
    const record = loginAttempts[key];
    record.lastAttempt = now;
    if (success) {
      record.count = 0;
      record.blockedUntil = 0;
    } else {
      record.count += 1;
      if (record.count >= 5) {
        record.blockedUntil = now + 15 * 60 * 1000;
      }
    }
  }
}

// ===== AUTH =====
function authenticate(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = getDb();
    return db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.id) || null;
  } catch (e) {
    return null;
  }
}

// ===== XSS HIMOYA =====
function escapeHtml(input) {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ===== SAVE UPLOADED FILE (Base64) =====
function saveUploadedFile(base64Data) {
  if (!base64Data) return '';
  
  const matches = base64Data.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
  if (!matches) {
    throw new Error('Noto\'g\'ri rasm formati (data URL emas)');
  }
  
  const mimeType = matches[1];
  const base64Content = matches[2];
  
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedMimeTypes.includes(mimeType)) {
    throw new Error('Faqat .jpg, .png, .webp formatlari ruxsat etiladi');
  }
  
  const sizeInBytes = (base64Content.length * 3) / 4;
  const maxBytes = 5 * 1024 * 1024; // 5MB
  if (sizeInBytes > maxBytes) {
    throw new Error('Rasm o\'lchami 5MB dan oshmasligi kerak');
  }
  
  let ext = '.png';
  if (mimeType === 'image/jpeg') ext = '.jpg';
  else if (mimeType === 'image/webp') ext = '.webp';
  
  const filename = crypto.randomBytes(16).toString('hex') + ext;
  const filePath = path.join(uploadsDir, filename);
  
  if (!filePath.startsWith(uploadsDir)) {
    throw new Error('Xavfsizlik xatosi: noto\'g\'ri yo\'l');
  }
  
  fs.writeFileSync(filePath, Buffer.from(base64Content, 'base64'));
  return `/uploads/${filename}`;
}

// ===== GENERAL RATE LIMITER =====
const generalRequestStore = {};
const rateLimitWindowMs = 60 * 1000;
const rateLimitMaxRequests = 100;

function isRateLimited(req) {
  const ip = getIpAddress(req);
  const now = Date.now();
  
  if (!generalRequestStore[ip]) {
    generalRequestStore[ip] = [];
  }
  
  generalRequestStore[ip] = generalRequestStore[ip].filter(time => now - time < rateLimitWindowMs);
  
  if (generalRequestStore[ip].length >= rateLimitMaxRequests) {
    return true;
  }
  
  generalRequestStore[ip].push(now);
  return false;
}

setInterval(() => {
  const now = Date.now();
  for (const ip in generalRequestStore) {
    generalRequestStore[ip] = generalRequestStore[ip].filter(time => now - time < rateLimitWindowMs);
    if (generalRequestStore[ip].length === 0) {
      delete generalRequestStore[ip];
    }
  }
}, 5 * 60 * 1000);

// ===== SERVER =====
const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  // Xavfsizlik headerlari
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (isRateLimited(req)) {
    sendJson(res, 429, { message: 'Too many requests. Please try again later.' });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const startTime = Date.now();
  const db = getDb();

    // ===== HEALTH CHECK (for Render) =====
    if (url.pathname === '/health' || url.pathname === '/') {
      if (url.pathname === '/health') {
        sendJson(res, 200, { status: 'ok', uptime: process.uptime() });
        return;
      }
      // For root path, serve index.html
      const indexPath = path.join(frontendDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        serveStaticFile(res, indexPath);
        return;
      }
      // Fallback: try home.html
      const homePath = path.join(frontendDir, 'home.html');
      if (fs.existsSync(homePath)) {
        serveStaticFile(res, homePath);
        return;
      }
      sendJson(res, 404, { message: 'Frontend fayllari topilmadi', frontendDir: frontendDir });
      return;
    }

    if (url.pathname.startsWith('/uploads/')) {
      const filePath = path.join(uploadsDir, path.basename(url.pathname));
      if (!filePath.startsWith(uploadsDir)) {
        sendJson(res, 403, { message: 'Ruxsat yo\'q' });
        return;
      }
      serveStaticFile(res, filePath);
      return;
    }

    // ===== REGISTER =====
    if (req.method === 'POST' && url.pathname === '/api/register') {
      const data = await getRequestBody(req);
      const { name, email, phone, password, isSeller, passportNumber, birthDate, sellerType, passportPhotoFile, selfieFile, bankDetails } = data;

      if (!name || !email || !password) {
        sendJson(res, 400, { message: 'Ism, email va parol majburiy' });
        return;
      }

      const existing = db.prepare('SELECT id FROM users WHERE email = ? OR phone = ?').get(email, phone || '');
      if (existing) {
        sendJson(res, 400, { message: 'Bu email yoki telefon allaqachon ro\'yxatdan o\'tgan' });
        return;
      }

      let passportPhotoPath = '';
      let selfieUrlPath = '';
      try {
        if (isSeller) {
          passportPhotoPath = saveUploadedFile(passportPhotoFile);
          selfieUrlPath = saveUploadedFile(selfieFile);
        }
      } catch (uploadErr) {
        sendJson(res, 400, { message: uploadErr.message });
        return;
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const stmt = db.prepare('INSERT INTO users (name, email, phone, password, role, walletBalance, avatar, bankDetails, passportNumber, birthDate, sellerType, passportPhoto, selfieUrl, kycStatus, token, rejectionCount, rejectionReason, specialization) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const result = stmt.run(
        escapeHtml(name), email, phone || '', hashedPassword,
        isSeller ? 'seller' : 'user', 0, '', bankDetails || '',
        passportNumber || '', birthDate || '', sellerType || 'jismoniy',
        passportPhotoPath, selfieUrlPath, isSeller ? 'pending' : 'none',
        '', 0, '', ''
      );

      const newUser = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
      const token = jwt.sign({ id: newUser.id, role: newUser.role }, JWT_SECRET, { expiresIn: '7d' });
      logAudit(newUser.id, newUser.role, 'REGISTER', newUser.id, 'Yangi foydalanuvchi ro\'yxatdan o\'tdi');
      logInfo('AUTH', `Yangi foydalanuvchi: ${email} (${newUser.role})`);

      sendJson(res, 201, {
        success: true, message: 'Ro\'yxatdan o\'tish muvaffaqiyatli',
        user: { ...newUser, password: undefined }, token
      });
      return;
    }

    // ===== REGISTER VIA TELEGRAM =====
    if (req.method === 'POST' && url.pathname === '/api/register/telegram') {
      const data = await getRequestBody(req);
      const { name, email, phone } = data;

      if (!name || !email || !phone) {
        sendJson(res, 400, { message: 'Ism, email va telefon raqami majburiy' });
        return;
      }

      const existing = db.prepare('SELECT id FROM users WHERE email = ? OR phone = ?').get(email, phone);
      if (existing) {
        sendJson(res, 400, { message: 'Bu email yoki telefon allaqachon ro\'yxatdan o\'tgan' });
        return;
      }

      const telegramToken = crypto.randomBytes(24).toString('hex');
      const dummyPassword = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
      
      const stmt = db.prepare('INSERT INTO users (name, email, phone, password, role, walletBalance, avatar, bankDetails, passportNumber, birthDate, sellerType, passportPhoto, selfieUrl, kycStatus, token, telegramToken, rejectionCount, rejectionReason, specialization) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const result = stmt.run(
        escapeHtml(name), email, phone, dummyPassword,
        'user', 0, '', '',
        '', '', 'jismoniy',
        '', '', 'none',
        '', telegramToken, 0, '', ''
      );

      const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'SmartShopBot';
      const link = `https://t.me/${botUsername}?start=${telegramToken}`;

      logAudit(result.lastInsertRowid, 'user', 'REGISTER_TELEGRAM', result.lastInsertRowid, 'Telegram orqali ro\'yxatdan o\'tish boshlandi');

      sendJson(res, 200, {
        success: true,
        message: 'Telegram orqali ro\'yxatdan o\'tish boshlandi',
        link
      });
      return;
    }

    // ===== LOGIN =====
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const data = await getRequestBody(req);
      const { email, password } = data;
      const ip = getIpAddress(req);

      const blocked = checkLoginBlock(ip, email);
      if (blocked > 0) {
        sendJson(res, 429, { message: `Ko'p urinishlar. ${blocked} daqiqa kutib turing.` });
        return;
      }

      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (!user) {
        recordLoginAttempt(ip, email, false);
        sendJson(res, 401, { message: 'Email yoki parol noto\'g\'ri' });
        return;
      }

      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        recordLoginAttempt(ip, email, false);
        sendJson(res, 401, { message: 'Email yoki parol noto\'g\'ri' });
        return;
      }

      recordLoginAttempt(ip, email, true);
      const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
      logAudit(user.id, user.role, 'LOGIN', user.id, 'Foydalanuvchi tizimga kirdi');
      logInfo('AUTH', `Foydalanuvchi kirdi: ${email}`);

      sendJson(res, 200, {
        success: true, message: 'Kirish muvaffaqiyatli',
        user: { ...user, password: undefined }, token
      });
      return;
    }

    // ===== PRODUCTS (GET) =====
    if (req.method === 'GET' && url.pathname === '/api/products') {
      const products = db.prepare('SELECT * FROM products ORDER BY id DESC').all();
      sendJson(res, 200, products);
      return;
    }

    // ===== PRODUCTS (POST) =====
    if (req.method === 'POST' && url.pathname === '/api/products') {
      const user = authenticate(req);
      if (!user || (user.role !== 'admin' && user.role !== 'seller' && user.role !== 'director')) {
        sendJson(res, 403, { message: 'Ruxsat yo\'q' });
        return;
      }
      if (user.role === 'seller' && user.kycStatus !== 'approved') {
        sendJson(res, 403, { message: 'Mahsulot qo\'shish uchun KYC tasdiqlanishi kutilmoqda yoki rad etilgan.' });
        return;
      }
      const data = await getRequestBody(req);
      const stmt = db.prepare(`INSERT INTO products (name, price, cost, description, image, category, stock, originalPrice, returnDays, rating, sellerId, sellerName) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const result = stmt.run(
        escapeHtml(data.name), Number(data.price),
        Number(data.cost) || Math.round(Number(data.price) * 0.65),
        escapeHtml(data.description || ''), data.image || 'smartphone.png',
        data.category || 'Elektronika', Number(data.stock) || 0,
        data.originalPrice ? Number(data.originalPrice) : null,
        data.returnDays !== undefined ? Number(data.returnDays) : 0,
        Number(data.rating) || 5.0, user.id, user.name
      );

      const newProduct = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
      logAudit(user.id, user.role, 'CREATE_PRODUCT', newProduct.id, `Mahsulot qo'shildi: ${newProduct.name}`);
      sendJson(res, 201, { message: 'Mahsulot qo\'shildi', product: newProduct });
      return;
    }

    // ===== PRODUCTS (PUT) =====
    if (req.method === 'PUT' && url.pathname === '/api/products') {
      const userAuth = authenticate(req);
      if (!userAuth || (userAuth.role !== 'admin' && userAuth.role !== 'seller' && userAuth.role !== 'director')) {
        sendJson(res, 403, { message: 'Ruxsat yo\'q' }); return;
      }
      if (userAuth.role === 'seller' && userAuth.kycStatus !== 'approved') {
        sendJson(res, 403, { message: 'Mahsulotni tahrirlash uchun KYC tasdiqlanishi shart.' }); return;
      }
      const data = await getRequestBody(req);
      const id = Number(data.id);
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
      if (!product) { sendJson(res, 404, { message: 'Mahsulot topilmadi' }); return; }
      if (userAuth.role === 'seller' && product.sellerId !== userAuth.id) {
        sendJson(res, 403, { message: 'Bu mahsulot sizga tegishli emas' }); return;
      }

      const updates = {};
      if (data.name !== undefined) updates.name = escapeHtml(data.name);
      if (data.price !== undefined) updates.price = Number(data.price);
      if (data.cost !== undefined) updates.cost = Number(data.cost);
      if (data.stock !== undefined) updates.stock = Number(data.stock);
      if (data.category !== undefined) updates.category = data.category;
      if (data.image !== undefined) updates.image = data.image;
      if (data.description !== undefined) updates.description = escapeHtml(data.description);
      if (data.originalPrice !== undefined) updates.originalPrice = data.originalPrice ? Number(data.originalPrice) : null;
      if (data.returnDays !== undefined) updates.returnDays = Number(data.returnDays);

      if (Object.keys(updates).length > 0) {
        const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
        const values = Object.values(updates);
        values.push(id);
        db.prepare(`UPDATE products SET ${setClause} WHERE id = ?`).run(...values);
      }

      const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
      sendJson(res, 200, { success: true, message: 'Mahsulot yangilandi', product: updated });
      return;
    }

    // ===== PRODUCTS (DELETE) =====
    if (req.method === 'DELETE' && url.pathname === '/api/products') {
      const user = authenticate(req);
      if (!user || (user.role !== 'admin' && user.role !== 'seller' && user.role !== 'director')) {
        sendJson(res, 403, { message: 'Ruxsat yo\'q' }); return;
      }
      if (user.role === 'seller' && user.kycStatus !== 'approved') {
        sendJson(res, 403, { message: 'Mahsulotni o\'chirish uchun KYC tasdiqlanishi shart.' }); return;
      }
      const id = Number(url.searchParams.get('id'));
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
      if (!product) { sendJson(res, 404, { message: 'Mahsulot topilmadi' }); return; }
      if (user.role === 'seller' && product.sellerId !== user.id) {
        sendJson(res, 403, { message: 'Bu mahsulot sizga tegishli emas' }); return;
      }
      db.prepare('DELETE FROM products WHERE id = ?').run(id);
      logAudit(user.id, user.role, 'DELETE_PRODUCT', id, `Mahsulot o'chirildi: ${product.name}`);
      sendJson(res, 200, { success: true, message: 'Mahsulot o\'chirildi' });
      return;
    }

    // ===== ORDERS (GET) =====
    if (req.method === 'GET' && url.pathname === '/api/orders') {
      const user = authenticate(req);
      if (!user) { sendJson(res, 401, { message: 'Avtorizatsiyadan o\'ting' }); return; }
      let orders;
      if (user.role === 'admin' || user.role === 'director') {
      orders = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
      } else {
        orders = db.prepare('SELECT * FROM orders WHERE userId = ? ORDER BY id DESC').all(user.id);
      }
      orders = orders.map(o => ({ ...o, items: JSON.parse(o.items || '[]') }));
      sendJson(res, 200, orders);
      return;
    }

    // ===== ORDERS (POST) =====
    if (req.method === 'POST' && url.pathname === '/api/orders') {
      const user = authenticate(req);
      if (!user) { sendJson(res, 401, { message: 'Avtorizatsiyadan o\'ting' }); return; }
      const received = await getRequestBody(req);

      // Validate items and calculate subtotal
      let subtotal = 0;
      if (!received.items || !Array.isArray(received.items) || received.items.length === 0) {
        sendJson(res, 400, { message: "Buyurtma savati bo'sh bo'lishi mumkin emas" });
        return;
      }

      for (const item of received.items) {
        const dbProduct = db.prepare('SELECT price, stock FROM products WHERE id = ?').get(item.id);
        if (!dbProduct) {
          sendJson(res, 400, { message: `Mahsulot topilmadi: ${item.name || item.id}` });
          return;
        }
        if (Number(item.quantity) > dbProduct.stock) {
          sendJson(res, 400, { message: `Mahsulot omborda yetarli emas: ${item.name}. Qoldiq: ${dbProduct.stock}` });
          return;
        }
        subtotal += dbProduct.price * (item.quantity || 1);
      }

      const shippingFee = (received.deliveryMethod === 'courier') ? 15 : 0;
      let expectedDiscount = 0;
      if (received.appliedPromoDiscount > 0) {
        const possibleDiscount = Math.round(subtotal * 0.2 * 100) / 100;
        if (Math.abs(Number(received.appliedPromoDiscount) - possibleDiscount) > 0.05) {
          sendJson(res, 400, { message: "Noto'g'ri promo chegirma summasi" });
          return;
        }
        expectedDiscount = Number(received.appliedPromoDiscount);
      }

      const expectedTotal = Math.max(0, Math.round((subtotal - expectedDiscount + shippingFee) * 100) / 100);
      if (Math.abs(Number(received.total) - expectedTotal) > 0.05) {
        sendJson(res, 400, { message: "Buyurtma jami summasi mos kelmaydi" });
        return;
      }

      // Stock kamaytirish
      const updateStock = db.prepare('UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?');
      for (const item of received.items) {
        updateStock.run(item.quantity || 1, item.id);
      }

      // Kuryer tayinlash
      let courierDetails = {};
      if (received.deliveryMethod === 'courier') {
        const couriers = [
          { name: "Alijon Solihov", phone: "+998 (99) 555-32-10", vehicle: "Oq Honda Scooter" },
          { name: "Sardor Rahimov", phone: "+998 (93) 120-40-50", vehicle: "Qizil Yamaha Moped" },
          { name: "Ramon Gulyamov", phone: "+998 (90) 888-77-66", vehicle: "Sariq E-Scooter" }
        ];
        const courier = couriers[Math.floor(Math.random() * couriers.length)];
        courierDetails = { courierName: courier.name, courierPhone: courier.phone, courierVehicle: courier.vehicle, estimatedDeliveryTime: Math.floor(Math.random() * 21) + 20 };
      }

      // Keshbek (5%) hisoblash - lekin darhol Hamyonga qo'shmaymiz (cashbackCredited = 0)
      const cashbackEarned = Math.round(expectedTotal * 0.05 * 100) / 100;
      
      const isOnlinePay = (received.paymentMethod === 'click' || received.paymentMethod === 'payme');
      const orderStatus = isOnlinePay ? "To'lov kutilmoqda" : "Tayyorlanmoqda";

      const stmt = db.prepare(`
        INSERT INTO orders (
          userId, items, total, deliveryMethod, customerName, customerPhone, 
          customerAddress, pickupPoint, paymentMethod, status, cashbackEarned, 
          cashbackCredited, courierName, courierPhone, courierVehicle, estimatedDeliveryTime
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
      `);
      
      const result = stmt.run(
        user.id, JSON.stringify(received.items), expectedTotal,
        received.deliveryMethod || 'pickup', escapeHtml(received.customerName || ''),
        received.customerPhone || '', escapeHtml(received.customerAddress || ''),
        escapeHtml(received.pickupPoint || ''), received.paymentMethod || 'full',
        orderStatus, cashbackEarned,
        courierDetails.courierName || '', courierDetails.courierPhone || '',
        courierDetails.courierVehicle || '', courierDetails.estimatedDeliveryTime || 0
      );

      const newOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(result.lastInsertRowid);
      newOrder.items = JSON.parse(newOrder.items || '[]');
      logAudit(user.id, user.role, 'CREATE_ORDER', newOrder.id, `Buyurtma yaratildi. Jami: $${expectedTotal}`);
      
      // Email xabarnoma (faqat onlayn to'lov bo'lmaganlar uchun)
      if (!isOnlinePay && user.email) {
        sendOrderEmail(user.email, user.name, newOrder).catch(err => {
          console.error('[EMAIL]', err.message);
        });
      }

      // SMS xabarnoma (faqat onlayn to'lov bo'lmaganlar uchun)
      if (!isOnlinePay && user.phone) {
        try {
          smsService.sendMockSMS(user.phone, getIpAddress(req));
          const { sendOrderStatusSMS } = require('./smsNotification');
          sendOrderStatusSMS(user.phone, newOrder.id, orderStatus).catch(() => {});
        } catch(e) { /* ignore */ }
      }

      sendJson(res, 201, { success: true, message: 'Buyurtma qabul qilindi', order: newOrder });
      return;
    }

    // ===== ORDERS (DELETE) =====
    if (req.method === 'DELETE' && url.pathname === '/api/orders') {
      const user = authenticate(req);
      if (!user || (user.role !== 'admin' && user.role !== 'director')) {
        sendJson(res, 403, { message: 'Ruxsat yo\'q' }); return;
      }
      db.prepare('DELETE FROM orders WHERE id = ?').run(Number(url.searchParams.get('id')));
      sendJson(res, 200, { success: true, message: 'Buyurtma o\'chirildi' });
      return;
    }

    // ===== ORDERS STATUS =====
    if (req.method === 'POST' && url.pathname === '/api/orders/status') {
      const user = authenticate(req);
      if (!user || (user.role !== 'admin' && user.role !== 'seller' && user.role !== 'director')) {
        sendJson(res, 403, { message: 'Ruxsat yo\'q' }); return;
      }
      const data = await getRequestBody(req);
      if (!data.orderId || !data.status) {
        sendJson(res, 400, { message: 'Buyurtma ID va status majburiy' }); return;
      }
      
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(data.orderId));
      if (!order) {
        sendJson(res, 404, { message: 'Buyurtma topilmadi' }); return;
      }

      // Handle stock restoration and cashback deduction on cancellation
      if (data.status === 'Bekor qilindi' && order.status !== 'Bekor qilindi') {
        const items = JSON.parse(order.items || '[]');
        const updateStock = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
        for (const item of items) {
          updateStock.run(item.quantity || 1, item.id);
        }

        // Deduct cashback if it was already credited
        if (order.cashbackCredited === 1 && order.cashbackEarned > 0) {
          db.prepare('UPDATE users SET walletBalance = ROUND(MAX(0, walletBalance - ?), 2) WHERE id = ?')
            .run(order.cashbackEarned, order.userId);
          db.prepare('UPDATE orders SET cashbackCredited = 0 WHERE id = ?').run(order.id);
        }
      }

      // Handle cashback crediting on delivery
      if (data.status === 'Yetkazildi' && order.status !== 'Yetkazildi') {
        if (order.cashbackCredited === 0 && order.cashbackEarned > 0) {
          db.prepare('UPDATE users SET walletBalance = ROUND((walletBalance + ?), 2) WHERE id = ?')
            .run(order.cashbackEarned, order.userId);
          db.prepare('UPDATE orders SET cashbackCredited = 1 WHERE id = ?').run(order.id);
        }
      }

      db.prepare('UPDATE orders SET status = ?, updatedAt = datetime(\'now\') WHERE id = ?').run(data.status, order.id);
      logAudit(user.id, user.role, 'UPDATE_ORDER_STATUS', order.id, `Buyurtma statusi o'zgartirildi: ${order.status} -> ${data.status}`);
      
      // SMS xabarnoma (buyurtma egasiga)
      const orderUser = db.prepare('SELECT phone FROM users WHERE id = ?').get(order.userId);
      if (orderUser && orderUser.phone) {
        const { sendOrderStatusSMS } = require('./smsNotification');
        sendOrderStatusSMS(orderUser.phone, order.id, data.status).catch(() => {});
      }
      
      sendJson(res, 200, { success: true, message: 'Buyurtma statusi yangilandi' });
      return;
    }

    // ===== PRODUCTS STOCK =====
    if (req.method === 'POST' && url.pathname === '/api/products/stock') {
      const user = authenticate(req);
      if (!user || (user.role !== 'admin' && user.role !== 'seller' && user.role !== 'director')) {
        sendJson(res, 403, { message: 'Ruxsat yo\'q' }); return;
      }
      const data = await getRequestBody(req);
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(data.productId));
      if (!product) { sendJson(res, 404, { message: 'Mahsulot topilmadi' }); return; }
      if (user.role === 'seller' && product.sellerId !== user.id) {
        sendJson(res, 403, { message: 'Bu mahsulot sizga tegishli emas' }); return;
      }
      db.prepare('UPDATE products SET stock = MAX(0, ?) WHERE id = ?').run(Math.max(0, Number(data.stock)), Number(data.productId));
      logAudit(user.id, user.role, 'UPDATE_PRODUCT_STOCK', product.id, `Mahsulot qoldig'i yangilandi: ${product.name} (${product.stock} -> ${Math.max(0, Number(data.stock))})`);
      const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(data.productId));
      sendJson(res, 200, { success: true, message: 'Mahsulot qoldig\'i yangilandi', product: updated });
      return;
    }

    // ===== USERS (GET) =====
    if (req.method === 'GET' && url.pathname === '/api/users') {
      const user = authenticate(req);
      if (!user || (user.role !== 'admin' && user.role !== 'director')) {
        sendJson(res, 403, { message: 'Ruxsat yo\'q' }); return;
      }
      const users = db.prepare('SELECT id, name, email, phone, role, walletBalance, avatar, bankDetails, passportNumber, birthDate, sellerType, kycStatus, rejectionReason, rejectionCount, specialization, addresses, createdAt FROM users ORDER BY id DESC').all();
      sendJson(res, 200, users);
      return;
    }

    // ===== USERS ROLE =====
    if (req.method === 'PUT' && url.pathname === '/api/users/role') {
      const user = authenticate(req);
      if (!user || (user.role !== 'admin' && user.role !== 'director')) {
        sendJson(res, 403, { message: 'Ruxsat yo\'q' }); return;
      }
      const data = await getRequestBody(req);
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(data.role, Number(data.userId));
      logAudit(user.id, user.role, 'CHANGE_ROLE', data.userId, `Rol o'zgartirildi: ${data.role}`);
      sendJson(res, 200, { success: true, message: 'Foydalanuvchi roli yangilandi' });
      return;
    }

    // ===== USERS KYC =====
    if (req.method === 'POST' && url.pathname === '/api/users/kyc') {
      const user = authenticate(req);
      if (!user || (user.role !== 'admin' && user.role !== 'director')) {
        sendJson(res, 403, { message: 'Ruxsat yo\'q' }); return;
      }
      const data = await getRequestBody(req);
      const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(data.userId));
      if (!targetUser) {
        sendJson(res, 404, { message: 'Foydalanuvchi topilmadi' });
        return;
      }
      if (data.status === 'rejected') {
        const newCount = (targetUser.rejectionCount || 0) + 1;
        db.prepare('UPDATE users SET kycStatus = ?, rejectionReason = ?, rejectionCount = ? WHERE id = ?').run('rejected', data.reason || 'Sabab ko\'rsatilmagan', newCount, Number(data.userId));
      } else {
        db.prepare('UPDATE users SET kycStatus = ?, rejectionReason = ? WHERE id = ?').run('approved', '', Number(data.userId));
      }
      logAudit(user.id, user.role, 'KYC_UPDATE', data.userId, `KYC: ${data.status}`);
      sendJson(res, 200, { success: true, message: 'KYC holati yangilandi' });
      return;
    }

    // ===== USERS (DELETE) =====
    if (req.method === 'DELETE' && url.pathname === '/api/users') {
      const userAuth = authenticate(req);
      const id = Number(url.searchParams.get('id'));
      if (!userAuth || (userAuth.role !== 'admin' && userAuth.role !== 'director' && userAuth.id !== id)) {
        sendJson(res, 403, { message: 'Ruxsat yo\'q' }); return;
      }
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
      logAudit(userAuth.id, userAuth.role, 'DELETE_USER', id, 'Foydalanuvchi o\'chirildi');
      sendJson(res, 200, { success: true, message: 'Foydalanuvchi o\'chirildi' });
      return;
    }

    // ===== USERS WALLET =====
    if (req.method === 'POST' && url.pathname === '/api/users/wallet') {
      const userAuth = authenticate(req);
      if (!userAuth || (userAuth.role !== 'admin' && userAuth.role !== 'director')) {
        sendJson(res, 403, { message: 'Ruxsat yo\'q' }); return;
      }
      const data = await getRequestBody(req);
      db.prepare('UPDATE users SET walletBalance = ROUND((walletBalance + ?), 2) WHERE id = ?').run(Number(data.amount), Number(data.userId));
      const updated = db.prepare('SELECT walletBalance FROM users WHERE id = ?').get(Number(data.userId));
      sendJson(res, 200, { success: true, walletBalance: updated.walletBalance });
      return;
    }

    // ===== USERS PROFILE (GET) =====
    if (req.method === 'GET' && url.pathname === '/api/users/profile') {
      const userAuth = authenticate(req);
      if (!userAuth) { sendJson(res, 401, { message: 'Avtorizatsiyadan o\'ting' }); return; }
      
      const user = db.prepare('SELECT id, name, email, phone, role, walletBalance, avatar, bankDetails, addresses, kycStatus FROM users WHERE id = ?').get(userAuth.id);
      sendJson(res, 200, { success: true, user });
      return;
    }

    // ===== USERS PROFILE (PUT) =====
    if (req.method === 'PUT' && url.pathname === '/api/users/profile') {
      const userAuth = authenticate(req);
      if (!userAuth) { sendJson(res, 401, { message: 'Avtorizatsiyadan o\'ting' }); return; }
      const data = await getRequestBody(req);
      
      // Email uniqueness validation
      if (data.email !== undefined && data.email !== userAuth.email) {
        const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(data.email);
        if (existing) {
          sendJson(res, 400, { message: 'Bu email allaqachon ro\'yxatdan o\'tgan' });
          return;
        }
      }

      // bankDetails (card number) verification logic
      const requestedBank = data.bankDetails !== undefined ? data.bankDetails.trim() : '';
      const currentBank = userAuth.bankDetails ? userAuth.bankDetails.trim() : '';
      
      if (requestedBank && requestedBank !== currentBank) {
        // Card linking needs SMS verification
        if (!userAuth.phone) {
          sendJson(res, 400, { message: "Karta raqamini bog'lashdan avval profil sozlamalarida telefon raqamingizni kiriting va saqlang." });
          return;
        }
        
        if (!data.otpCode) {
          // Send SMS verification code
          const smsResult = smsService.sendMockSMS(userAuth.phone, getIpAddress(req));
          if (!smsResult.success) {
            sendJson(res, 429, { message: smsResult.message || "SMS jo'natish limiti tufayli rad etildi" });
            return;
          }
          sendJson(res, 200, { otpRequired: true, message: "Karta raqamini tasdiqlash uchun telefoningizga SMS kod yuborildi." });
          return;
        } else {
          // Verify code
          const verifyResult = smsService.verifyOTP(userAuth.phone, data.otpCode);
          if (!verifyResult.success) {
            sendJson(res, 400, { message: verifyResult.message || "Tasdiqlash kodi noto'g'ri yoki muddati o'tgan" });
            return;
          }
          // OTP correct - will update bankDetails
        }
      }

      const updates = {};
      if (data.name !== undefined) updates.name = escapeHtml(data.name);
      if (data.email !== undefined) updates.email = data.email;
      if (data.phone !== undefined) updates.phone = data.phone;
      if (data.avatar !== undefined) updates.avatar = data.avatar;
      if (data.bankDetails !== undefined) updates.bankDetails = data.bankDetails;
      if (data.addresses !== undefined) updates.addresses = Array.isArray(data.addresses) ? data.addresses.join('\n') : data.addresses;

      if (Object.keys(updates).length > 0) {
        const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
        const values = Object.values(updates);
        values.push(userAuth.id);
        db.prepare(`UPDATE users SET ${setClause} WHERE id = ?`).run(...values);
      }
      const updated = db.prepare('SELECT id, name, email, phone, role, walletBalance, avatar, bankDetails, addresses, kycStatus FROM users WHERE id = ?').get(userAuth.id);
      sendJson(res, 200, { success: true, message: 'Profil muvaffaqiyatli yangilandi', user: updated });
      return;
    }

    // ===== REVIEWS =====
    if (req.method === 'POST' && url.pathname === '/api/reviews') {
      const userAuth = authenticate(req);
      if (!userAuth) { sendJson(res, 401, { message: 'Avtorizatsiyadan o\'ting' }); return; }
      const data = await getRequestBody(req);
      const productId = Number(data.productId);
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
      if (!product) { sendJson(res, 404, { message: 'Mahsulot topilmadi' }); return; }

      const orders = db.prepare('SELECT * FROM orders WHERE userId = ?').all(userAuth.id);
      const hasPurchased = orders.some(o => {
        const items = JSON.parse(o.items || '[]');
        return items.some(i => i.id === productId);
      });
      if (!hasPurchased) {
        sendJson(res, 403, { message: 'Faqat ushbu mahsulotni xarid qilgan mijozlar sharh qoldira oladi' });
        return;
      }

      let reviews = JSON.parse(product.reviews || '[]');
      if (reviews.some(r => r.userId === userAuth.id)) {
        sendJson(res, 400, { message: 'Siz allaqachon bu mahsulotga sharh qoldirgansiz' });
        return;
      }

      reviews.push({
        userId: userAuth.id, userName: userAuth.name || data.userName || 'Anonim',
        rating: Number(data.rating) || 5, comment: escapeHtml(data.comment || ''),
        date: new Date().toISOString().split('T')[0]
      });

      const avgRating = Number((reviews.reduce((s, r) => s + Number(r.rating), 0) / reviews.length).toFixed(1));
      db.prepare('UPDATE products SET reviews = ?, rating = ? WHERE id = ?').run(JSON.stringify(reviews), avgRating, productId);
      sendJson(res, 201, { success: true, review: reviews[reviews.length - 1], newRating: avgRating });
      return;
    }

    // ===== PAYMENT: PROVAYDERLAR RO'YXATI =====
    if (req.method === 'GET' && url.pathname === '/api/payment/providers') {
      const providers = paymentService.getPaymentProviders();
      sendJson(res, 200, providers);
      return;
    }

    // ===== PAYMENT: TO'LOVNI BOSHLASH =====
    if (req.method === 'POST' && url.pathname === '/api/payment/init') {
      const user = authenticate(req);
      if (!user) { sendJson(res, 401, { message: 'Avtorizatsiyadan o\'ting' }); return; }
      const data = await getRequestBody(req);
      
      // Karta ma'lumotlari YO'Q — faqat summa va provider
      const transaction = paymentService.initiatePayment({
        amount: Number(data.amount),
        currency: 'UZS',
        description: data.description || 'SmartShop xaridi',
        provider: data.provider || 'payme',
        userId: user.id,
        orderId: data.orderId
      });
      sendJson(res, 200, {
        success: true,
        transactionId: transaction.id,
        provider: transaction.provider,
        providerLogo: transaction.providerLogo,
        providerColor: transaction.providerColor,
        amount: transaction.amount,
        payUrl: transaction.payUrl,
        message: `To'lov ${transaction.provider} orqali amalga oshirilmoqda`
      });
      return;
    }

    // ===== PAYMENT: STATUS TEKSHIRISH =====
    if (req.method === 'GET' && url.pathname === '/api/payment/status') {
      const txnId = url.searchParams.get('transactionId');
      if (!txnId) { sendJson(res, 400, { message: 'transactionId kerak' }); return; }
      const status = paymentService.checkPaymentStatus(txnId);
      if (!status) { sendJson(res, 404, { message: 'Tranzaksiya topilmadi' }); return; }
      sendJson(res, 200, { success: true, transaction: status });
      return;
    }

    // ===== PAYMENT: MUDDATLI TO'LOV HISOBI =====
    if (req.method === 'GET' && url.pathname === '/api/payment/installment') {
      const amount = Number(url.searchParams.get('amount') || 0);
      const months = Number(url.searchParams.get('months') || 12);
      if (amount <= 0 || ![3, 6, 12].includes(months)) {
        sendJson(res, 400, { message: 'Noto\'g\'ri ma\'lumot' });
        return;
      }
      const calc = paymentService.calculateInstallment(amount, months);
      sendJson(res, 200, calc);
      return;
    }

    // ===== PAYMENT: WEBHOOK (Tasdiqlash) =====
    if (req.method === 'POST' && url.pathname === '/api/payment/webhook') {
      const data = await getRequestBody(req);
      const { transactionId, status } = data;
      if (!transactionId || !status) {
        sendJson(res, 400, { message: 'transactionId va status majburiy' });
        return;
      }

      // Check transaction in database
      const txn = db.prepare('SELECT * FROM transactions WHERE id = ?').get(transactionId);
      if (!txn) {
        sendJson(res, 404, { message: 'Tranzaksiya topilmadi' });
        return;
      }

      if (txn.status !== 'pending') {
        sendJson(res, 200, { success: true, message: 'Tranzaksiya allaqachon qayta ishlangan', status: txn.status });
        return;
      }

      if (status === 'completed') {
        // Confirm transaction in paymentService (updates transactions table)
        paymentService.confirmPayment(transactionId);

        // Fetch corresponding order
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(txn.orderId);
        if (order) {
          // Update order status to "Tayyorlanmoqda" and set transactionId
          db.prepare("UPDATE orders SET status = 'Tayyorlanmoqda', transactionId = ?, updatedAt = datetime('now') WHERE id = ?")
            .run(transactionId, order.id);

          // Credit cashback if not credited yet
          if (order.cashbackCredited === 0 && order.cashbackEarned > 0) {
            db.prepare('UPDATE users SET walletBalance = ROUND((walletBalance + ?), 2) WHERE id = ?')
              .run(order.cashbackEarned, order.userId);
            db.prepare('UPDATE orders SET cashbackCredited = 1 WHERE id = ?')
              .run(order.id);
          }

          // Fetch user and send notification
          const orderUser = db.prepare('SELECT * FROM users WHERE id = ?').get(order.userId);
          if (orderUser) {
            // Email
            if (orderUser.email) {
              const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
              updatedOrder.items = JSON.parse(updatedOrder.items || '[]');
              sendOrderEmail(orderUser.email, orderUser.name, updatedOrder).catch(() => {});
            }
            // SMS
            if (orderUser.phone) {
              try {
                smsService.sendMockSMS(orderUser.phone, getIpAddress(req));
                const { sendOrderStatusSMS } = require('./smsNotification');
                sendOrderStatusSMS(orderUser.phone, order.id, 'Tayyorlanmoqda').catch(() => {});
              } catch(e) {}
            }
          }
        }

        sendJson(res, 200, { success: true, message: "To'lov tasdiqlandi" });
      } else if (status === 'cancelled') {
        paymentService.cancelPayment(transactionId);
        
        // Update order status to "Bekor qilindi"
        db.prepare("UPDATE orders SET status = 'Bekor qilindi', updatedAt = datetime('now') WHERE id = ?")
          .run(txn.orderId);
          
        // Restore stock
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(txn.orderId);
        if (order) {
          const items = JSON.parse(order.items || '[]');
          const updateStock = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
          for (const item of items) {
            updateStock.run(item.quantity || 1, item.id);
          }
        }

        sendJson(res, 200, { success: true, message: "To'lov bekor qilindi" });
      } else {
        sendJson(res, 400, { message: "Noto'g'ri status" });
      }
      return;
    }

    // ===== SMS: YUBORISH =====
    if (req.method === 'POST' && url.pathname === '/api/sms/send') {
      const data = await getRequestBody(req);
      const normalizedPhone = String(data.phone || '').replace(/[^0-9]/g, '');
      const result = await smsService.sendVerificationCode({
        phone: normalizedPhone,
        email: data.email,
        ip: getIpAddress(req)
      });
      sendJson(res, result.success ? 200 : 429, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/sms/verify') {
      const data = await getRequestBody(req);
      const normalizedPhone = String(data.phone || '').replace(/[^0-9]/g, '');
      const result = smsService.verifyOTP(normalizedPhone, data.code);
      sendJson(res, result.success ? 200 : 400, result);
      return;
    }

    // ===== FORGOT PASSWORD =====
    if (req.method === 'POST' && url.pathname === '/api/forgot-password') {
      const data = await getRequestBody(req);
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(data.email);
      if (!user) { sendJson(res, 404, { message: 'Bu email topilmadi' }); return; }
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

      db.prepare('INSERT INTO password_resets (email, code, expiresAt) VALUES (?, ?, ?)')
        .run(user.email, code, expiresAt);

      logInfo('PASSWORD', `Parol tiklash kodi ${user.email}: ${code}`);
      sendPasswordResetEmail(user.email, code).catch(err => {
        logError('PASSWORD_EMAIL', `Parol tiklash emaili yuborishda xato: ${err.message}`);
      });
      sendJson(res, 200, { success: true, message: 'Tasdiqlash kodi emailingizga yuborildi', code: process.env.SHOW_OTP_IN_RESPONSE === 'true' ? code : undefined });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/reset-password') {
      const data = await getRequestBody(req);
      
      const resetRecord = db.prepare('SELECT * FROM password_resets WHERE email = ? AND used = 0 ORDER BY id DESC LIMIT 1').get(data.email);
      if (!resetRecord) {
        sendJson(res, 400, { message: 'Tasdiqlash kodi topilmadi yoki allaqachon ishlatilgan' });
        return;
      }
      
      const expiresAtTime = new Date(resetRecord.expiresAt + (resetRecord.expiresAt.endsWith('Z') ? '' : 'Z')).getTime();
      if (Date.now() > expiresAtTime) {
        sendJson(res, 400, { message: 'Tasdiqlash kodining muddati tugagan' });
        return;
      }
      
      if (String(resetRecord.code) !== String(data.code)) {
        sendJson(res, 400, { message: 'Noto\'g\'ri tasdiqlash kodi' });
        return;
      }

      const passwordToHash = data.password || data.newPassword;
      if (!passwordToHash) {
        sendJson(res, 400, { message: 'Yangi parol kiritilishi shart' });
        return;
      }

      const hashedPassword = await bcrypt.hash(passwordToHash, 10);
      db.prepare('UPDATE users SET password = ? WHERE email = ?').run(hashedPassword, data.email);
      db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(resetRecord.id);
      
      sendJson(res, 200, { success: true, message: 'Parol muvaffaqiyatli yangilandi' });
      return;
    }

    // ===== TELEGRAM AUTH =====
    if (req.method === 'POST' && url.pathname === '/api/telegram/auth') {
      const data = await getRequestBody(req);
      const user = db.prepare('SELECT * FROM users WHERE telegramToken = ?').get(data.tgToken);
      if (!user) { sendJson(res, 401, { message: 'Noto\'g\'ri token' }); return; }
      const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
      sendJson(res, 200, { success: true, message: 'Telegram orqali kirdingiz', user: { ...user, password: undefined }, token });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/telegram/mock-webhook') {
      const data = await getRequestBody(req);
      const rawText = (data.text || '').trim();
      const text = rawText.toLowerCase();
      let responseText = '';

      if (text.startsWith('/start') || text.startsWith('start')) {
        const parts = rawText.split(/\s+/);
        const payload = parts[1];

        if (payload) {
          if (payload.startsWith('login_')) {
            const identifier = decodeURIComponent(payload.substring(6)).trim();
            const user = db.prepare('SELECT * FROM users WHERE email = ? OR phone = ?').get(identifier, identifier);
            if (user) {
              const tgToken = crypto.randomBytes(24).toString('hex');
              db.prepare('UPDATE users SET telegramToken = ? WHERE id = ?').run(tgToken, user.id);
              responseText = `Assalomu alaykum, ${user.name}! 👋\n\nTelegram orqali tizimga kirish uchun quyidagi havolaga bosing:\nhttp://localhost:3000/account.html?tgToken=${tgToken}`;
            } else {
              responseText = `Kechirasiz, "${identifier}" ma'lumotiga ega foydalanuvchi topilmadi.\n\nIltimos, avval ro'yxatdan o'ting: http://localhost:3000/account.html`;
            }
          } else if (payload.startsWith('register_')) {
            const phone = decodeURIComponent(payload.substring(9)).trim();
            const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
            if (user) {
              const tgToken = crypto.randomBytes(24).toString('hex');
              db.prepare('UPDATE users SET telegramToken = ? WHERE id = ?').run(tgToken, user.id);
              responseText = `Siz allaqachon ro'yxatdan o'tgansiz, ${user.name}! 👋\n\nTizimga kirish uchun havolani bosing:\nhttp://localhost:3000/account.html?tgToken=${tgToken}`;
            } else {
              responseText = `Kechirasiz, ushbu telefon raqami (+${phone}) bilan foydalanuvchi topilmadi. Avval saytda ro'yxatdan o'ting: http://localhost:3000/account.html`;
            }
          } else {
            const token = payload.trim();
            const user = db.prepare('SELECT * FROM users WHERE telegramToken = ?').get(token);
            if (user) {
              responseText = `Assalomu alaykum, ${user.name}! 👋\n\nSmartShop-da Telegram orqali ro'yxatdan o'tganingiz uchun rahmat. Tizimga kirish uchun quyidagi havolaga bosing:\nhttp://localhost:3000/account.html?tgToken=${token}`;
            } else {
              responseText = `Noto'g'ri yoki muddati o'tgan faollashtirish tokeni: "${token}".\n\nYordam uchun /help buyrug'ini yuboring.`;
            }
          }
        } else {
          responseText = `Assalomu alaykum, ${data.username || 'foydalanuvchi'}! 👋\nSmartShop botiga xush kelibsiz!\n\n/start - Botni ishga tushirish\n/login - Tizimga kirish\n/register - Ro'yxatdan o'tish\n/products - Mahsulotlar\n/help - Yordam`;
        }
      } else if (text.includes('/login') || text.includes('kirish')) {
        responseText = `Tizimga kirish uchun saytga o'ting:\nhttp://localhost:3000/account.html`;
      } else if (text.includes('/register') || text.includes('ro\'yxat')) {
        responseText = `Ro'yxatdan o'tish uchun saytga o'ting:\nhttp://localhost:3000/account.html`;
      } else if (text.includes('/products') || text.includes('mahsulot')) {
        responseText = `Mahsulotlarni ko'rish uchun:\nhttp://localhost:3000/products.html`;
      } else if (text.includes('yordam') || text.includes('/help')) {
        responseText = `Yordam bo'limi:\n\n/start - Botni ishga tushirish\n/login - Tizimga kirish\n/register - Ro'yxatdan o'tish\n/products - Mahsulotlar\n/help - Yordam\n\n📞 Qo'llab-quvvatlash: support@smartshop.uz`;
      } else {
        responseText = `Kechirasiz, "${data.text}" buyrug'ini tushunmadim.\n\nYordam uchun /help buyrug'ini yuboring.`;
      }

      sendJson(res, 200, { text: responseText });
      return;
    }

    // ===== STATIC FILES =====
    if (url.pathname.startsWith('/api/')) {
      sendJson(res, 404, { message: 'API yo\'li topilmadi' });
      return;
    }

    let requestedPath = url.pathname === '/' ? '/index.html' : url.pathname;
    const filePath = path.join(frontendDir, requestedPath);

    if (!filePath.startsWith(frontendDir)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Ruxsat yo\'q');
      return;
    }

    serveStaticFile(res, filePath);

  } catch (err) {
    logError('SERVER', `Xatolik: ${err.message}`, err.stack);
    if (!res.headersSent) {
      sendJson(res, 500, { message: 'Server xatosi yuz berdi' });
    }
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  logInfo('SERVER', `SmartShop v2.0 http://localhost:${PORT} da ishlayapti`);
  logInfo('SERVER', `JWT_SECRET: ${JWT_SECRET.substring(0, 8)}... (${JWT_SECRET.length} belgi)`);
  console.log(`\n⚡ SmartShop v2.0 — http://localhost:${PORT}`);
  console.log(`📦 SQLite ma'lumotlar bazasi ishga tushdi`);
});