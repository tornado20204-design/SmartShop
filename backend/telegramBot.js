const https = require('https');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getDb } = require('./db');
const smsService = require('./smsService');

let pollingActive = false;
let offset = 0;

// Registration state machine memory
const userStates = {};

function startTelegramBot(botToken, baseUrl) {
  if (!botToken) {
    console.log("[TELEGRAM BOT] TELEGRAM_BOT_TOKEN sozlanmagan. Real Telegram bot faollashtirilmadi.");
    return;
  }
  if (pollingActive) return;
  pollingActive = true;
  
  let botUsername = process.env.TELEGRAM_BOT_USERNAME || 'SmartShopBot';
  if (botUsername.startsWith('@')) botUsername = botUsername.slice(1);
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
  
  // 1. Handle contact sharing (Account verification / register start)
  if (msg.contact) {
    let phone = msg.contact.phone_number;
    const normalizedPhone = String(phone).replace(/\D/g, '');
    let user = db.prepare('SELECT * FROM users WHERE phone = ? OR email = ?').get(normalizedPhone, normalizedPhone);
    
    if (user) {
      db.prepare('UPDATE users SET token = ? WHERE id = ?').run(String(chatId), user.id);
      const text = `Muvaffaqiyatli bog'landi! ✅\n\nSalom, *${user.name}*! Endi siz do'konimiz xizmatlaridan bevosita Telegram orqali ham foydalana olasiz.`;
      sendTelegramMessage(botToken, chatId, text, makeMainMenuKeyboard());
    } else {
      // Send OTP to phone number
      const otpRes = smsService.sendMockSMS(normalizedPhone, '127.0.0.1');
      if (otpRes.success) {
        userStates[chatId] = {
          step: 'AWAITING_OTP',
          phone: normalizedPhone,
          name: msg.contact.first_name || `Telegram User (${normalizedPhone.slice(-4)})`
        };
        
        let text = `Telefon raqamingiz muvaffaqiyatli qabul qilindi! 📱\n\nSizning telefon raqamingizga 6 xonali tasdiqlash kodi yuborildi.`;
        if (otpRes.code) {
          text += `\n*(TEST REJIMIDA SMS KOD: \`${otpRes.code}\`)*`;
        }
        text += `\n\nIltimos, tasdiqlash kodini botga kiriting:`;
        
        sendTelegramMessage(botToken, chatId, text, JSON.stringify({ remove_keyboard: true }));
      } else {
        const text = `Xatolik yuz berdi: ${otpRes.message || 'SMS limitga duch keldingiz.'}\n\nIltimos birozdan so'ng qayta urinib ko'ring.`;
        sendTelegramMessage(botToken, chatId, text, makeShareContactKeyboard());
      }
    }
    return;
  }

  const rawText = (msg.text || '').trim();
  const text = rawText.toLowerCase();
  
  // Reset/cancel state if start command is typed
  if (text.startsWith('/start') || text.startsWith('start')) {
    delete userStates[chatId];
  }

  const state = userStates[chatId];

  // 2. Handle state machine (Awaiting OTP verification)
  if (state && state.step === 'AWAITING_OTP') {
    const verified = smsService.verifyOTP(state.phone, rawText);
    if (verified.success) {
      state.step = 'AWAITING_PASSWORD';
      const text = `Tasdiqlash kodi muvaffaqiyatli qabul qilindi! ✅\n\nEndi saytga va botga kirish uchun yangi parol yarating (kamida 8 ta belgi):`;
      sendTelegramMessage(botToken, chatId, text);
    } else {
      const text = `Xato: ${verified.message || 'Noto\'g\'ri tasdiqlash kodi.'}\n\nIltimos, kodni qaytadan kiritib ko'ring yoki /start orqali jarayonni bekor qiling:`;
      sendTelegramMessage(botToken, chatId, text);
    }
    return;
  }

  // 3. Handle state machine (Awaiting password during registration)
  if (state && state.step === 'AWAITING_PASSWORD') {
    if (rawText.length < 8) {
      const text = `Kiritilgan parol juda qisqa ⚠️\n\nIltimos, saytga va botga kirish uchun kamida 8 ta belgidan iborat parol yuboring:`;
      sendTelegramMessage(botToken, chatId, text);
    } else {
      const hashedPassword = bcrypt.hashSync(rawText, 10);
      const email = `tg_${state.phone}@smartshop.com`;
      
      const stmt = db.prepare('INSERT INTO users (name, email, phone, password, role, token, walletBalance, kycStatus) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      stmt.run(state.name, email, state.phone, hashedPassword, 'user', String(chatId), 0, 'none');
      
      delete userStates[chatId];
      
      const successText = `Tabriklaymiz! Ro'yxatdan o'tish muvaffaqiyatli yakunlandi! 🎉\n\n👤 Loginingiz (Telefon): \`+${state.phone}\`\n🔑 Parolingiz: _Siz kiritgan maxfiy parol_\n\nEndi ushbu ma'lumotlar bilan veb-saytga ham kira olasiz! Quyidagi menyu orqali do'kondan foydalanishingiz mumkin:`;
      sendTelegramMessage(botToken, chatId, successText, makeMainMenuKeyboard());
    }
    return;
  }

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
