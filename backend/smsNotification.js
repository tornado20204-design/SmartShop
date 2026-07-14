// ============================================================
// SmartShop SMS Xabarnoma Tizimi
// Buyurtma holati o'zgarganda SMS yuborish
// ============================================================

/**
 * SMS xabarnoma yuborish
 * Real loyihada: PlayMobile, Eskiz, SMS.uz kabi provayderlar
 */
async function sendSMSNotification(phone, message) {
  const SMS_API_URL = process.env.SMS_API_URL;
  const normalizedPhone = String(phone || '').replace(/\D/g, '');

  if (!normalizedPhone) {
    return { success: false, message: 'Telefon raqam kiritilmagan' };
  }

  if (!SMS_API_URL) {
    console.log(`[SMS MOCK] ${normalizedPhone}: ${message}`);
    return { success: true, mock: true };
  }

  // Real SMS API ga so'rov yuborish
  try {
    const http = require('http');
    const https = require('https');

    const body = JSON.stringify({
      phone: normalizedPhone,
      message: message,
      // Provayderga qarab qo'shimcha parametrlar
    });

    const options = {
      hostname: new URL(SMS_API_URL).hostname,
      path: new URL(SMS_API_URL).pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    return new Promise((resolve, reject) => {
      const client = SMS_API_URL.startsWith('https') ? https : http;
      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true });
          } else {
            resolve({ success: false, message: `SMS API xatosi: ${res.statusCode}` });
          }
        });
      });
      req.on('error', (err) => reject(err));
      req.write(body);
      req.end();
    });
  } catch (err) {
    console.error(`[SMS ERROR] ${err.message}`);
    return { success: false, message: err.message };
  }
}

/**
 * Buyurtma holati o'zgarganda SMS
 */
async function sendOrderStatusSMS(phone, orderId, status) {
  const messages = {
    'Tayyorlanmoqda': `SmartShop: Buyurtmangiz #${orderId} qabul qilindi va tayyorlanmoqda.`,
    'Tayinlandi': `SmartShop: Buyurtmangiz #${orderId} uchun kuryer tayinlandi. Tez orada bog'lanamiz.`,
    'Yo\'lda': `SmartShop: Kuryer buyurtmangiz #${orderId} bilan yo'lda! Yetkazish vaqti: ~30 daqiqa.`,
    'Yetkazildi': `SmartShop: Buyurtmangiz #${orderId} yetkazildi! Xaridingiz uchun rahmat! ⚡`,
    'Bekor qilindi': `SmartShop: Buyurtmangiz #${orderId} bekor qilindi.`
  };

  const message = messages[status] || `SmartShop: Buyurtmangiz #${orderId} holati o'zgardi: ${status}`;
  return sendSMSNotification(phone, message);
}

module.exports = { sendSMSNotification, sendOrderStatusSMS };