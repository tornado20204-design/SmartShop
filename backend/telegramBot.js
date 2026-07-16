const https = require('https');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
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

function makeMainMenuKeyboard() {
  return JSON.stringify({
    keyboard: [
      [{ text: '🛍️ Mahsulotlar' }, { text: '📦 Buyurtmalarim' }],
      [{ text: '💰 Hamyon (Keshbek)' }, { text: '👤 Profil' }],
      [{ text: '❓ Yordam' }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  });
}

function makeShareContactKeyboard() {
  return JSON.stringify({
    keyboard: [
      [{ text: '📞 Telefon raqamni yuborish (Tasdiqlash)', request_contact: true }]
    ],
    resize_keyboard: true,
    one_time_keyboard: true
  });
}

function handleUpdate(botToken, update, baseUrl) {
  if (!update.message) return;
  const msg = update.message;
  const chatId = msg.chat.id;
  const db = getDb();
  
  // 1. Handle contact sharing (Account verification / register)
  if (msg.contact) {
    let phone = msg.contact.phone_number;
    const normalizedPhone = String(phone).replace(/\D/g, '');
    let user = db.prepare('SELECT * FROM users WHERE phone = ? OR email = ?').get(normalizedPhone, normalizedPhone);
    
    if (user) {
      db.prepare('UPDATE users SET token = ? WHERE id = ?').run(String(chatId), user.id);
      const text = `Muvaffaqiyatli bog'landi! ✅\n\nSalom, *${user.name}*! Endi siz do'konimiz xizmatlaridan bevosita Telegram orqali ham foydalana olasiz.`;
      sendTelegramMessage(botToken, chatId, text, makeMainMenuKeyboard());
    } else {
      // Register a new user
      const dummyPassword = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);
      const name = msg.contact.first_name || `Telegram User (${normalizedPhone.slice(-4)})`;
      const email = `tg_${normalizedPhone}@smartshop.com`;
      
      const stmt = db.prepare('INSERT INTO users (name, email, phone, password, role, token, walletBalance, kycStatus) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      stmt.run(name, email, normalizedPhone, dummyPassword, 'user', String(chatId), 0, 'none');
      
      const text = `Tabriklaymiz! Siz ro'yxatdan o'tdingiz! 🎉\n\nSalom, *${name}*! SmartShop do'koniga xush kelibsiz. Quyidagi menyu orqali mahsulotlarni ko'rishingiz mumkin:`;
      sendTelegramMessage(botToken, chatId, text, makeMainMenuKeyboard());
    }
    return;
  }

  const rawText = (msg.text || '').trim();
  const text = rawText.toLowerCase();
  
  // Look up user by Telegram Chat ID
  let user = db.prepare('SELECT * FROM users WHERE token = ?').get(String(chatId));

  // If user is not verified/logged in yet, require contact sharing
  if (!user && !text.startsWith('/start') && !text.startsWith('start')) {
    const responseText = `Kechirasiz, profilingiz SmartShop tizimi bilan bog'lanmagan 🔒\n\nIltimos, quyidagi tugma orqali telefon raqamingizni yuborib profilingizni tasdiqlang yoki ro'yxatdan o'ting:`;
    sendTelegramMessage(botToken, chatId, responseText, makeShareContactKeyboard());
    return;
  }

  if (text.startsWith('/start') || text.startsWith('start')) {
    const parts = rawText.split(/\s+/);
    const payload = parts[1];

    if (payload) {
      // Start with token from web redirect
      const token = payload.trim();
      const userByToken = db.prepare('SELECT * FROM users WHERE telegramToken = ?').get(token);
      if (userByToken) {
        db.prepare('UPDATE users SET token = ? WHERE id = ?').run(String(chatId), userByToken.id);
        const responseText = `Assalomu alaykum, *${userByToken.name}*! 👋\n\nSmartShop profilingiz Telegram bilan muvaffaqiyatli bog'landi! Saytga qaytib kirishingiz yoki ushbu bot orqali ham xarid qilishingiz mumkin.`;
        sendTelegramMessage(botToken, chatId, responseText, makeMainMenuKeyboard());
      } else {
        const responseText = `Xato: noto'g'ri yoki muddati o'tgan faollashtirish tokeni.`;
        sendTelegramMessage(botToken, chatId, responseText, makeShareContactKeyboard());
      }
    } else {
      // Normal start
      if (user) {
        const responseText = `Salom, *${user.name}*! 👋\nSmartShop do'koniga qaytganingizdan xursandmiz. Quyidagi menyu orqali amallarni bajarishingiz mumkin:`;
        sendTelegramMessage(botToken, chatId, responseText, makeMainMenuKeyboard());
      } else {
        const responseText = `Assalomu alaykum! 👋\nSmartShop savdo platformasi rasmiy botiga xush kelibsiz!\n\nTizimdan foydalanish uchun telefon raqamingizni ulash orqali kirishingiz yoki ro'yxatdan o'tishingiz shart:`;
        sendTelegramMessage(botToken, chatId, responseText, makeShareContactKeyboard());
      }
    }
  } else if (text === '🛍️ mahsulotlar' || text === '/products') {
    showProducts(botToken, chatId);
  } else if (text === '📦 buyurtmalarim' || text === '/orders') {
    showOrders(botToken, chatId, user);
  } else if (text === '💰 hamyon (keshbek)' || text === '💰 hamyon' || text === '/wallet') {
    const text = `💰 *Sizning Hamyoningiz:*\n\nBalans: *100% kafolatlangan keshbek* va naqd pullaringiz:\n💵 Jami: *${(user.walletBalance || 0).toFixed(2)} UZS* (yoki USD ekv.)`;
    sendTelegramMessage(botToken, chatId, text, makeMainMenuKeyboard());
  } else if (text === '👤 profil' || text === '/profile') {
    const profileText = `👤 *SmartShop Profili:*\n\nIsm: *${user.name}*\nEmail: *${user.email || '—'}*\nTelefon: *+${user.phone || '—'}*\nRol: *${user.role.toUpperCase()}*\nID: *${user.id}*`;
    sendTelegramMessage(botToken, chatId, profileText, makeMainMenuKeyboard());
  } else if (text === '❓ yordam' || text === '/help') {
    const helpText = `❓ *Yordam bo'limi*\n\nUshbu bot yordamida siz do'konimizdagi mahsulotlarni ko'rishingiz, buyurtmalaringiz holatini tekshirishingiz va hamyon balansingizni nazorat qilishingiz mumkin.\n\n📞 Qo'llab-quvvatlash: @SmartShopSupport\n🌐 Saytimiz: ${baseUrl}`;
    sendTelegramMessage(botToken, chatId, helpText, makeMainMenuKeyboard());
  } else {
    const responseText = `Kechirasiz, "${msg.text}" buyrug'ini tushunmadim.\n\nYordam uchun quyidagi menyudan foydalaning:`;
    sendTelegramMessage(botToken, chatId, responseText, makeMainMenuKeyboard());
  }
}

function showProducts(botToken, chatId) {
  const db = getDb();
  const products = db.prepare('SELECT * FROM products ORDER BY id DESC LIMIT 5').all();
  
  if (products.length === 0) {
    sendTelegramMessage(botToken, chatId, "Hozirda do'konda mahsulotlar mavjud emas. 🛍️", makeMainMenuKeyboard());
    return;
  }

  const listText = products.map((p, idx) => {
    return `${idx + 1}. *${p.name}*\n💰 Narxi: *${p.price} UZS*\n📦 Omborda: *${p.stock} ta*\n📝 Tafsif: _${p.description || '—'}_\n`;
  }).join('\n');

  const text = `🛍️ *Do'konimizdagi so'nggi mahsulotlar:*\n\n${listText}\nBatafsil xaridlar uchun saytimizga o'ting!`;
  sendTelegramMessage(botToken, chatId, text, makeMainMenuKeyboard());
}

function showOrders(botToken, chatId, user) {
  const db = getDb();
  const orders = db.prepare('SELECT * FROM orders WHERE userId = ? ORDER BY id DESC LIMIT 5').all();
  
  if (orders.length === 0) {
    sendTelegramMessage(botToken, chatId, "Sizda hali buyurtmalar mavjud emas. 📦", makeMainMenuKeyboard());
    return;
  }

  const listText = orders.map((o) => {
    const items = JSON.parse(o.items || '[]');
    const itemsSummary = items.map(i => `${i.name} (${i.quantity || 1} ta)`).join(', ');
    return `📋 *Buyurtma #${o.id}*\n🛍️ Mahsulotlar: _${itemsSummary || '—'}_\n💵 Jami: *${(o.total || 0).toFixed(2)} UZS*\n⚡ Status: *${o.status}*\n`;
  }).join('\n');

  const text = `📦 *Sizning so'nggi buyurtmalaringiz:*\n\n${listText}`;
  sendTelegramMessage(botToken, chatId, text, makeMainMenuKeyboard());
}

function sendTelegramMessage(botToken, chatId, text, replyMarkup = null) {
  const payload = { 
    chat_id: chatId, 
    text,
    parse_mode: 'Markdown'
  };
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }
  const body = JSON.stringify(payload);
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
