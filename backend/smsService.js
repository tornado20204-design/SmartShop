const http = require('http');
const https = require('https');
const nodemailer = require('nodemailer');
const { getDb } = require('./db');

// Limits
const PHONE_MINUTELY_LIMIT = 1;
const PHONE_HOURLY_LIMIT = 5;
const IP_HOURLY_LIMIT = 10;

const SMS_API_URL = process.env.SMS_API_URL || '';
const SMS_API_METHOD = (process.env.SMS_API_METHOD || 'POST').toUpperCase();
const SMS_API_HEADERS = parseJson(process.env.SMS_API_HEADERS, { 'Content-Type': 'application/json' });
const SMS_API_BODY_TEMPLATE = process.env.SMS_API_BODY_TEMPLATE || JSON.stringify({ phone: '{{phone}}', message: '{{message}}' });
const SMS_API_QUERY_TEMPLATE = process.env.SMS_API_QUERY_TEMPLATE || '';

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const EMAIL_FROM = process.env.EMAIL_FROM || SMTP_USER;

const TELEGRAM_BOTS = [];
if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
  TELEGRAM_BOTS.push({ token: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID });
}
if (process.env.TELEGRAM_BOT_TOKEN_2 && process.env.TELEGRAM_CHAT_ID_2) {
  TELEGRAM_BOTS.push({ token: process.env.TELEGRAM_BOT_TOKEN_2, chatId: process.env.TELEGRAM_CHAT_ID_2 });
}
const SHOW_OTP_IN_RESPONSE = process.env.SHOW_OTP_IN_RESPONSE === 'true';

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function isValidPhone(phone) {
  const digits = normalizePhone(phone);
  return /^998\d{9}$/.test(digits);
}

function parseJson(value, defaultValue) {
  if (!value) return defaultValue;
  try {
    return JSON.parse(value);
  } catch {
    return defaultValue;
  }
}

function renderTemplate(template, values) {
  return String(template).replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => {
    return values[key] != null ? values[key] : '';
  });
}

function buildTelegramMessage(phone, code) {
  return `SmartShop tasdiqlash kodi:\n${code}\nTelefon: ${phone}\nIltimos, bu kodni hech kimga bermang.`;
}

function sendTelegramMessage(botToken, chatId, phone, code) {
  return new Promise((resolve, reject) => {
    if (!botToken || !chatId) {
      return resolve({ success: false, message: 'Telegram bot sozlamalari mavjud emas.' });
    }

    const text = buildTelegramMessage(phone, code);
    const body = JSON.stringify({ chat_id: chatId, text });

    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${botToken}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.ok) {
            resolve({ success: true });
          } else {
            reject(new Error(result.description || 'Telegram xatosi'));
          }
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.write(body);
    req.end();
  });
}

async function sendSmsMessage(phone, code) {
  if (!SMS_API_URL) {
    return { success: false, message: 'SMS shlyuzi manzili sozlanmagan.' };
  }

  const message = `SmartShop tasdiqlash kodi: ${code}`;
  const targetUrl = new URL(SMS_API_URL);

  if (SMS_API_QUERY_TEMPLATE) {
    targetUrl.search = renderTemplate(SMS_API_QUERY_TEMPLATE, { phone, message });
  }

  const headers = { ...SMS_API_HEADERS };
  let body = null;

  if (SMS_API_METHOD !== 'GET') {
    const rendered = renderTemplate(SMS_API_BODY_TEMPLATE, { phone, message });
    body = rendered;
  }

  const client = targetUrl.protocol === 'http:' ? http : https;
  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || (targetUrl.protocol === 'http:' ? 80 : 443),
    path: targetUrl.pathname + targetUrl.search,
    method: SMS_API_METHOD,
    headers
  };

  return new Promise((resolve, reject) => {
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true });
        } else {
          reject(new Error(`SMS shlyuzi xatosi: ${res.statusCode} ${data}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function sendEmailVerification(email, phone, code) {
  if (!email || !SMTP_USER || !SMTP_PASS) {
    return { success: false, message: 'Email sozlamalari toʻliq emas.' };
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });

  const mailOptions = {
    from: EMAIL_FROM,
    to: email,
    subject: 'SmartShop tasdiqlash kodi',
    text: `Sizning SmartShop tasdiqlash kodingiz: ${code}\nTelefon: ${phone}`
  };

  await transporter.sendMail(mailOptions);
  return { success: true };
}

async function sendVerificationCode({ phone, email, ip }) {
  const normalizedPhone = normalizePhone(phone);
  if (!isValidPhone(normalizedPhone)) {
    return { success: false, message: 'Telefon raqam noto‘g‘ri formatda.' };
  }

  const rateLimit = checkSmsRateLimit(normalizedPhone, ip);
  if (rateLimit.limited) {
    return { success: false, message: rateLimit.reason };
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const now = Date.now();
  const expiresAt = new Date(now + 2 * 60 * 1000).toISOString(); // 2 minutes expiry

  const db = getDb();
  db.prepare('INSERT INTO otp_codes (phone, code, expiresAt, ip) VALUES (?, ?, ?, ?)')
    .run(normalizedPhone, code, expiresAt, ip);

  const channelResults = [];
  let sentAny = false;
  let lastError = null;

  if (SMS_API_URL) {
    try {
      const smsResult = await sendSmsMessage(normalizedPhone, code);
      if (smsResult.success) {
        sentAny = true;
        channelResults.push('sms');
      }
    } catch (err) {
      lastError = err;
    }
  }

  for (const bot of TELEGRAM_BOTS) {
    try {
      const telegramResult = await sendTelegramMessage(bot.token, bot.chatId, normalizedPhone, code);
      if (telegramResult.success) {
        sentAny = true;
        channelResults.push('telegram');
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (email) {
    try {
      const emailResult = await sendEmailVerification(email, normalizedPhone, code);
      if (emailResult.success) {
        sentAny = true;
        channelResults.push('email');
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (!sentAny) {
    if (SHOW_OTP_IN_RESPONSE) {
      return { success: true, code, channels: [] };
    }
    const errorMessage = lastError ? lastError.message : 'Har qanday kanal orqali OTP yuborilmadi.';
    return { success: false, message: errorMessage };
  }

  return { success: true, code: SHOW_OTP_IN_RESPONSE ? code : undefined, channels: channelResults };
}

function checkSmsRateLimit(phone, ip) {
  const db = getDb();

  // 1. Check phone minutely limit
  const minutelyRes = db.prepare(`
    SELECT count(*) as count FROM otp_codes 
    WHERE phone = ? AND datetime(createdAt) > datetime('now', '-1 minute')
  `).get(phone);

  if (minutelyRes && minutelyRes.count >= PHONE_MINUTELY_LIMIT) {
    return { limited: true, reason: `SMS jo'natish cheklangan. Iltimos birozdan so'ng qayta urinib ko'ring.` };
  }

  // 2. Check phone hourly limit
  const hourlyPhoneRes = db.prepare(`
    SELECT count(*) as count FROM otp_codes 
    WHERE phone = ? AND datetime(createdAt) > datetime('now', '-1 hour')
  `).get(phone);

  if (hourlyPhoneRes && hourlyPhoneRes.count >= PHONE_HOURLY_LIMIT) {
    return { limited: true, reason: `Ushbu raqamga soatlik SMS limiti tugadi. Iltimos 1 soatdan so'ng qayta urinib ko'ring.` };
  }

  // 3. Check IP hourly limit
  const hourlyIpRes = db.prepare(`
    SELECT count(*) as count FROM otp_codes 
    WHERE ip = ? AND datetime(createdAt) > datetime('now', '-1 hour')
  `).get(ip);

  if (hourlyIpRes && hourlyIpRes.count >= IP_HOURLY_LIMIT) {
    return { limited: true, reason: `Sizning qurilmangizdan soatlik SMS so'rovlari ko'payib ketdi. Iltimos 1 soatdan so'ng qayta urinib ko'ring.` };
  }

  return { limited: false };
}

function sendMockSMS(phone, ip) {
  const rateLimit = checkSmsRateLimit(phone, ip);
  if (rateLimit.limited) {
    return { success: false, message: rateLimit.reason };
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const now = Date.now();
  const expiresAt = new Date(now + 2 * 60 * 1000).toISOString(); // 2 minutes expiry

  const db = getDb();
  db.prepare('INSERT INTO otp_codes (phone, code, expiresAt, ip) VALUES (?, ?, ?, ?)')
    .run(phone, code, expiresAt, ip);

  if (process.env.DEBUG_OTP === 'true') {
    console.log(`[SMS MOCK] Kod yaratildi -> Telefon: ${phone}, IP: ${ip}, Kod: ${code}`);
  }

  return { success: true, code: SHOW_OTP_IN_RESPONSE ? code : undefined };
}

function verifyOTP(phone, code) {
  const db = getDb();
  const otp = db.prepare('SELECT * FROM otp_codes WHERE phone = ? AND used = 0 ORDER BY id DESC LIMIT 1').get(phone);

  if (!otp) {
    return { success: false, message: "Kodni faollashtirish so'rovi topilmadi. Qayta urinib ko'ring." };
  }

  const expiresAtTime = new Date(otp.expiresAt + (otp.expiresAt.endsWith('Z') ? '' : 'Z')).getTime();
  if (Date.now() > expiresAtTime) {
    return { success: false, message: "Tasdiqlash kodining muddati tugagan" };
  }

  if (otp.attempts >= 5) {
    return { success: false, message: "Urinishlar soni tugadi. Kod bloklandi." };
  }

  if (String(otp.code) !== String(code)) {
    db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').run(otp.id);
    return { success: false, message: `Noto'g'ri tasdiqlash kodi. Qolgan urinishlar: ${5 - (otp.attempts + 1)}` };
  }

  // Success - single use code
  db.prepare('UPDATE otp_codes SET used = 1 WHERE id = ?').run(otp.id);
  return { success: true };
}

module.exports = {
  sendMockSMS,
  sendVerificationCode,
  verifyOTP
};
