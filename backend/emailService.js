// ============================================================
// SmartShop Email Xabarnoma Tizimi
// ============================================================
const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
  const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
  const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
  const SMTP_USER = process.env.SMTP_USER || '';
  const SMTP_PASS = process.env.SMTP_PASS || '';

  if (!SMTP_USER || !SMTP_PASS) {
    return null; // SMTP sozlanmagan
  }

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });

  return transporter;
}

/**
 * Buyurtma tasdiqlash emaili
 */
async function sendOrderEmail(userEmail, userName, orderDetails) {
  const transport = getTransporter();
  if (!transport) {
    console.log(`[EMAIL MOCK] Buyurtma emaili yuborildi: ${userEmail}`);
    return { success: true, mock: true };
  }

  const EMAIL_FROM = process.env.EMAIL_FROM || process.env.SMTP_USER;

  const itemsHtml = (orderDetails.items || [])
    .map(item => `<tr><td style="padding:8px;border-bottom:1px solid #eee;">${item.name}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${item.quantity || 1}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">$${((item.price || 0) * (item.quantity || 1)).toFixed(2)}</td></tr>`)
    .join('');

  const mailOptions = {
    from: `"SmartShop" <${EMAIL_FROM}>`,
    to: userEmail,
    subject: `✅ Buyurtma tasdiqlandi! #${orderDetails.id}`,
    html: `
      <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;">
        <div style="background:linear-gradient(135deg,#6366f1,#4f46e5);padding:30px;text-align:center;border-radius:12px 12px 0;">
          <h1 style="color:white;margin:0;font-size:24px;">⚡ SmartShop</h1>
          <p style="color:rgba(255,255,0.8);margin:8px 0 0;">Buyurtma tasdiqlandi!</p>
        </div>
        <div style="background:#f9fafb;padding:30px;border-radius:0 0 12px 12px;">
          <p>Salom, <strong>${userName}</strong>! 👋</p>
          <p>Buyurtmangiz qabul qilindi va tayyorlanmoqda.</p>
          
          <div style="background:white;border-radius:8px;padding:20px;margin:20px 0;border:1px solid #e5e7eb;">
            <h3 style="margin:0 0 15px;color:#111;font-size:16px;">📋 Buyurtma #${orderDetails.id}</h3>
            <table style="width:100%;border-collapse:collapse;font-size:14px;">
              <thead>
                <tr style="background:#f3f4f6;">
                  <th style="padding:8px;text-align:left;">Mahsulot</th>
                  <th style="padding:8px;text-align:center;">Soni</th>
                  <th style="padding:8px;text-align:right;">Summa</th>
                </tr>
              </thead>
              <tbody>${itemsHtml}</tbody>
            </table>
            <div style="border-top:2px solid #111;padding:12px 0 0;margin-top:12px;text-align:right;font-size:16px;font-weight:bold;">
              Jami: $${(orderDetails.total || 0).toFixed(2)}
            </div>
          </div>

          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:15px;margin:15px 0;">
            <p style="margin:0;color:#166534;font-size:14px;">
              💰 Keshbek: <strong>$${(orderDetails.cashbackEarned || 0).toFixed(2)}</strong> hamyoningizga qo'shildi!
            </p>
          </div>

          ${orderDetails.deliveryMethod === 'courier' ? `
            <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:15px;margin:15px 0;">
              <p style="margin:0;color:#1e40af;font-size:14px;">
                🚚 Yetkazib berish: <strong>${orderDetails.courierName || 'Kuryer tayinlanmoqda'}</strong><br>
                📞 Telefon: ${orderDetails.courierPhone || '—'}<br>
                📍 Manzil: ${orderDetails.customerAddress || '—'}
              </p>
            </div>
          ` : `
            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:15px;margin:15px 0;">
              <p style="margin:0;color:#92400e;font-size:14px;">
                📦 Olib ketish punkti: <strong>${orderDetails.pickupPoint || 'Bosh tarqatish punkti'}</strong>
              </p>
            </div>
          `}

          <p style="color:#6b7280;font-size:13px;margin-top:20px;">
            Buyurtmangizni kuzatish: <a href="http://localhost:3000/delivery.html?orderId=${orderDetails.id}" style="color:#6366f1;">http://localhost:3000/delivery.html?orderId=${orderDetails.id}</a>
          </p>
        </div>
      </div>
    `
  };

  try {
    await transport.sendMail(mailOptions);
    return { success: true };
  } catch (err) {
    console.error(`[EMAIL ERROR] ${err.message}`);
    return { success: false, message: err.message };
  }
}

/**
 * Parolni tiklash emaili
 */
async function sendPasswordResetEmail(userEmail, resetCode) {
  const transport = getTransporter();
  if (!transport) {
    console.log(`[EMAIL MOCK] Parol tiklash kodi ${userEmail}: ${resetCode}`);
    return { success: true, mock: true };
  }

  const EMAIL_FROM = process.env.EMAIL_FROM || process.env.SMTP_USER;

  const mailOptions = {
    from: `"SmartShop" <${EMAIL_FROM}>`,
    to: userEmail,
    subject: '🔐 Parolni tiklash kodi',
    html: `
      <div style="max-width:500px;margin:0 auto;font-family:Arial,sans-serif;">
        <div style="background:linear-gradient(135deg,#6366f1,#4f46e5);padding:25px;text-align:center;border-radius:12px 12px 0;">
          <h2 style="color:white;margin:0;">🔐 Parolni Tiklash</h2>
        </div>
        <div style="background:#f9fafb;padding:25px;border-radius:0 0 12px 12px;">
          <p>Parolingizni tiklash uchun quyidagi kodni kiriting:</p>
          <div style="background:white;border-radius:8px;padding:20px;text-align:center;margin:20px 0;border:1px solid #e5e7eb;">
            <div style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#6366f1;">${resetCode}</div>
            <p style="color:#6b7280;font-size:13px;margin:10px 0 0;">Kod 10 daqiqa amal qiladi</p>
          </div>
          <p style="color:#6b7280;font-size:13px;">Agar parolni tiklashni so'ramagan bo'lsangiz, ushbu xabarni e'tiborsiz qoldiring.</p>
        </div>
      </div>
    `
  };

  try {
    await transport.sendMail(mailOptions);
    return { success: true };
  } catch (err) {
    console.error(`[EMAIL ERROR] ${err.message}`);
    return { success: false, message: err.message };
  }
}

module.exports = { sendOrderEmail, sendPasswordResetEmail };