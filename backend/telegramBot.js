const https = require('https');
const crypto = require('crypto');
const { getDb } = require('./db');

let pollingActive = false;
let offset = 0;

function startTelegramBot(botToken, baseUrl) {
  if (!botToken) {
    console.log("[TELEGRAM BOT] TELEGRAM_BOT_TOKEN sozlanmagan. Real Telegram bot faollashtirilmadi.");
    return;
  }
  if (pollingActive) return;
  pollingActive = true;
  
  const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'SmartShopBot';
  console.log(`[TELEGRAM BOT] @${botUsername} bot polling faollashtirildi...`);
  
  pollUpdates(botToken, baseUrl);
}

function pollUpdates(botToken, baseUrl) {
  if (!pollingActive) return;

  const url = `https://api.telegram.org/bot${botToken}/getUpdates?offset=${offset}&timeout=30`;
  
  const req = https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      try {
        const result = JSON.parse(data);
        if (result.ok && result.result) {
          for (const update of result.result) {
            offset = update.update_id + 1;
            handleUpdate(botToken, update, baseUrl);
          }
        }
      } catch (err) {
        console.error(`[TELEGRAM BOT ERROR] JSON pars qilishda xato: ${err.message}`);
      }
      // Poll again immediately
      setTimeout(() => pollUpdates(botToken, baseUrl), 1000);
    });
  });

  req.on('error', (err) => {
    console.error(`[TELEGRAM BOT ERROR] So'rovda xato: ${err.message}`);
    // Wait 5 seconds before retrying on error
    setTimeout(() => pollUpdates(botToken, baseUrl), 5000);
  });
}

function handleUpdate(botToken, update, baseUrl) {
  if (!update.message) return;
  const msg = update.message;
  const chatId = msg.chat.id;
  const rawText = (msg.text || '').trim();
  const text = rawText.toLowerCase();
  const username = msg.from.username || msg.from.first_name || 'Foydalanuvchi';

  let responseText = '';

  const db = getDb();

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
          responseText = `Assalomu alaykum, ${user.name}! 👋\nTelegram orqali tizimga kirish uchun quyidagi havolaga bosing:\n${baseUrl}/account.html?tgToken=${tgToken}`;
        } else {
          responseText = `Kechirasiz, "${identifier}" ma'lumotiga ega foydalanuvchi topilmadi.\n\nIltimos, avval ro'yxatdan o'ting: ${baseUrl}/account.html`;
        }
      } else if (payload.startsWith('register_')) {
        const phone = decodeURIComponent(payload.substring(9)).trim();
        const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
        if (user) {
          const tgToken = crypto.randomBytes(24).toString('hex');
          db.prepare('UPDATE users SET telegramToken = ? WHERE id = ?').run(tgToken, user.id);
          responseText = `Siz allaqachon ro'yxatdan o'tgansiz, ${user.name}! 👋\n\nTizimga kirish uchun havolani bosing:\n${baseUrl}/account.html?tgToken=${tgToken}`;
        } else {
          responseText = `Kechirasiz, ushbu telefon raqami (+${phone}) bilan foydalanuvchi topilmadi. Avval saytda ro'yxatdan o'tish bo'limida telefon orqali kirishni tanlang.`;
        }
      } else {
        const token = payload.trim();
        const user = db.prepare('SELECT * FROM users WHERE telegramToken = ?').get(token);
        if (user) {
          // Save the user's real Telegram chat ID to token column
          db.prepare('UPDATE users SET token = ? WHERE id = ?').run(String(chatId), user.id);
          responseText = `Assalomu alaykum, ${user.name}! 👋\nSmartShop-da Telegram orqali ro'yxatdan o'tganingiz uchun rahmat. Tizimga kirish uchun quyidagi havolaga bosing:\n${baseUrl}/account.html?tgToken=${token}`;
        } else {
          responseText = `Noto'g'ri yoki muddati o'tgan faollashtirish tokeni: "${token}".\n\nYordam uchun /help buyrug'ini yuboring.`;
        }
      }
    } else {
      responseText = `Assalomu alaykum, ${username}! 👋\nSmartShop botiga xush kelibsiz!\n\n/start - Botni ishga tushirish\n/login - Tizimga kirish\n/register - Ro'yxatdan o'tish\n/products - Mahsulotlar\n/help - Yordam`;
    }
  } else if (text.includes('/login') || text.includes('kirish')) {
    responseText = `Tizimga kirish uchun saytga o'ting:\n${baseUrl}/account.html`;
  } else if (text.includes('/register') || text.includes('ro\'yxat')) {
    responseText = `Ro'yxatdan o'tish uchun saytga o'ting:\n${baseUrl}/account.html`;
  } else if (text.includes('/products') || text.includes('mahsulot')) {
    responseText = `Mahsulotlarni ko'rish uchun:\n${baseUrl}/products.html`;
  } else if (text.includes('yordam') || text.includes('/help')) {
    responseText = `Yordam bo'limi:\n\n/start - Botni ishga tushirish\n/login - Tizimga kirish\n/register - Ro'yxatdan o'tish\n/products - Mahsulotlar\n/help - Yordam\n\n📞 Qo'llab-quvvatlash: support@smartshop.uz`;
  } else {
    responseText = `Kechirasiz, "${msg.text}" buyrug'ini tushunmadim.\n\nYordam uchun /help buyrug'ini yuboring.`;
  }

  sendTelegramMessage(botToken, chatId, responseText);
}

function sendTelegramMessage(botToken, chatId, text) {
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

  const req = https.request(options);
  req.on('error', (err) => {
    console.error(`[TELEGRAM BOT SEND ERROR] Xabar yuborishda xato: ${err.message}`);
  });
  req.write(body);
  req.end();
}

module.exports = { startTelegramBot };
