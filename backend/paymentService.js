// ============================================================
// SmartShop Payment Service — Xavfsiz to'lov tizimi
// Karta ma'lumotlari FRONTENDGA KELMAYDI!
// ============================================================

/**
 * REAL LOYIHADA:
 * - Payme, Click, Uzcard, Apelsin kabi provayderlar bilan integratsiya
 * - Karta ma'lumotlari to'g'ridan-to'g'ri provayder serveriga boradi
 * - Sizning serveringiz faqat transaction ID va statusni oladi
 * 
 * BU MOCK: Rivojlanish uchun mo'ljallangan
 */

// Mock to'lov provayderlari
const { getDb } = require('./db');

// Mock to'lov provayderlari
const PAYMENT_PROVIDERS = {
  payme: {
    name: 'Payme',
    logo: '💳',
    color: '#22c55e',
    apiUrl: 'https://api.payme.uz/transaction',
    merchantId: 'PAYME_MERCHANT_ID'
  },
  click: {
    name: 'Click',
    logo: '🟢',
    color: '#10b981',
    apiUrl: 'https://api.click.uz/transaction',
    merchantId: 'CLICK_MERCHANT_ID'
  },
  uzcard: {
    name: 'Uzcard',
    logo: '💳',
    color: '#3b82f6',
    apiUrl: 'https://api.uzcard.uz/transaction',
    merchantId: 'UZCARD_MERCHANT_ID'
  },
  apelsin: {
    name: 'Apelsin',
    logo: '🍊',
    color: '#f97316',
    apiUrl: 'https://api.apelsin.uz/transaction',
    merchantId: 'APELSIN_MERCHANT_ID'
  }
};

/**
 * To'lovni boshlash — faqat transaction ID qaytariladi
 * Karta ma'lumotlari hech qachon serverga kelmaydi
 */
function initiatePayment({ amount, currency = 'UZS', description, provider = 'payme', userId, orderId }) {
  const transactionId = 'txn_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
  const providerConfig = PAYMENT_PROVIDERS[provider] || PAYMENT_PROVIDERS.payme;

  // Real Click va Payme redirect URLlarini generatsiya qilish
  const payUrl = provider === 'click'
    ? `https://my.click.uz/services/pay?service_id=${providerConfig.merchantId}&amount=${amount}&transaction_id=${transactionId}`
    : `https://checkout.payme.uz/${Buffer.from(`m=${providerConfig.merchantId};ac.order_id=${orderId};a=${amount * 100}`).toString('base64')}`;

  const transaction = {
    id: transactionId,
    amount,
    currency,
    description,
    provider: providerConfig.name,
    providerLogo: providerConfig.logo,
    providerColor: providerConfig.color,
    status: 'pending',
    userId,
    orderId,
    createdAt: new Date().toISOString(),
    payUrl
  };

  const db = getDb();
  db.prepare(`
    INSERT INTO transactions (id, amount, currency, description, provider, status, userId, orderId, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(transactionId, amount, currency, description, providerConfig.name, 'pending', userId, orderId, transaction.createdAt);

  return transaction;
}

/**
 * To'lov statusini tekshirish
 */
function checkPaymentStatus(transactionId) {
  const db = getDb();
  const txn = db.prepare('SELECT * FROM transactions WHERE id = ?').get(transactionId);
  if (!txn) return null;

  // Map fields to match provider logo/color
  const providerKey = txn.provider.toLowerCase();
  const providerConfig = PAYMENT_PROVIDERS[providerKey] || PAYMENT_PROVIDERS.payme;
  
  return {
    ...txn,
    providerLogo: providerConfig.logo,
    providerColor: providerConfig.color
  };
}

/**
 * To'lovni tasdiqlash (provayder webhook orqali)
 */
function confirmPayment(transactionId, providerData = {}) {
  const db = getDb();
  const txn = db.prepare('SELECT * FROM transactions WHERE id = ?').get(transactionId);
  if (!txn) return null;

  const confirmedAt = new Date().toISOString();
  db.prepare("UPDATE transactions SET status = 'completed', confirmedAt = ? WHERE id = ?")
    .run(confirmedAt, transactionId);

  return db.prepare('SELECT * FROM transactions WHERE id = ?').get(transactionId);
}

/**
 * To'lovni bekor qilish
 */
function cancelPayment(transactionId) {
  const db = getDb();
  const txn = db.prepare('SELECT * FROM transactions WHERE id = ?').get(transactionId);
  if (!txn) return null;

  db.prepare("UPDATE transactions SET status = 'cancelled' WHERE id = ?")
    .run(transactionId);

  return db.prepare('SELECT * FROM transactions WHERE id = ?').get(transactionId);
}

/**
 * To'lov provayderlari ro'yxati
 */
function getPaymentProviders() {
  return Object.values(PAYMENT_PROVIDERS).map(p => ({
    id: p.name.toLowerCase(),
    name: p.name,
    logo: p.logo,
    color: p.color
  }));
}

/**
 * Muddatli to'lov (Nasiya) hisoblash
 */
function calculateInstallment(amount, months) {
  const rates = {
    3: 0,    // 3 oy — 0% ustama
    6: 5,    // 6 oy — 5% ustama
    12: 12   // 12 oy — 12% ustama
  };

  const rate = rates[months] || 0;
  const totalWithInterest = amount * (1 + rate / 100);
  const monthlyPayment = totalWithInterest / months;

  return {
    totalAmount: Math.round(totalWithInterest * 100) / 100,
    monthlyPayment: Math.round(monthlyPayment * 100) / 100,
    interestRate: rate,
    months
  };
}

module.exports = {
  initiatePayment,
  checkPaymentStatus,
  confirmPayment,
  cancelPayment,
  getPaymentProviders,
  calculateInstallment,
  PAYMENT_PROVIDERS
};