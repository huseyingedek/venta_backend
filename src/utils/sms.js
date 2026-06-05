const axios = require('axios');
const { logger } = require('./logger');

/**
 * İletiBilgi SMS gönder
 * @param {string} phone - Alıcı telefon (05xxxxxxxxx veya +905xxxxxxxxx)
 * @param {string} message - SMS metni
 */
const sendSms = async (phone, message) => {
  if (process.env.SMS_ENABLED !== 'true') {
    logger.info(`[SMS-MOCK] ${phone}: ${message}`);
    return { success: true, mock: true };
  }

  // Telefon numarasını normalize et (başındaki 0'ı at, 90 ekle)
  const normalized = phone.replace(/\s/g, '').replace(/^0/, '90').replace(/^\+/, '');

  try {
    const response = await axios.post(
      process.env.ILETIBILGI_API_URL,
      {
        username: process.env.ILETIBILGI_USERNAME,
        password: process.env.ILETIBILGI_PASSWORD,
        sender: process.env.ILETIBILGI_SENDER,
        message,
        numbers: [normalized],
      },
      { timeout: 10000 }
    );

    logger.info(`SMS gönderildi: ${normalized}`);
    return { success: true, data: response.data };
  } catch (err) {
    logger.error(`SMS gönderme hatası: ${err.message}`);
    return { success: false, error: err.message };
  }
};

// ─── Hazır SMS şablonları ────────────────────────────────────────────────────

const smsTemplates = {
  orderConfirmed: (orderNumber, total) =>
    `Venta Premium: #${orderNumber} numaralı siparişiniz onaylandı. Tutar: ${Number(total).toLocaleString('tr-TR')} TL. Teşekkürler!`,

  orderShipped: (orderNumber, cargoCompany, trackingNo) =>
    `Venta Premium: #${orderNumber} siparişiniz kargoya verildi. ${cargoCompany}${trackingNo ? ` Takip No: ${trackingNo}` : ''}`,

  orderDelivered: (orderNumber) =>
    `Venta Premium: #${orderNumber} siparişiniz teslim edildi. İyi günler dileriz!`,

  passwordReset: (name) =>
    `Venta Premium: Merhaba ${name}, şifre sıfırlama talebiniz alındı. E-postanızı kontrol edin.`,

  welcomeSms: (name) =>
    `Venta Premium: Hoş geldiniz ${name}! Üyeliğiniz oluşturuldu. İyi alışverişler!`,
};

module.exports = { sendSms, smsTemplates };
