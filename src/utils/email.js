const { Resend } = require('resend');

const getResend = () => {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
};

const FROM_NAME_VAL = process.env.FROM_NAME || 'Venta Premium';
const FROM_EMAIL_VAL = process.env.FROM_EMAIL || 'onboarding@resend.dev';
const FROM = '"' + FROM_NAME_VAL + '" <' + FROM_EMAIL_VAL + '>';

const sendMail = async ({ to, subject, html }) => {
  const resend = getResend();
  if (!resend) {
    console.log(`\n[EMAIL-MOCK] To: ${to} | Subject: ${subject}`);
    return;
  }
  const { error } = await resend.emails.send({ from: FROM, to, subject, html });
  if (error) throw new Error(error.message);
};

const sendPasswordResetEmail = async ({ to, firstName, resetUrl }) => {
  const html = `
    <!DOCTYPE html><html lang="tr">
    <body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:20px;">
      <div style="max-width:500px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;">
        <div style="background:#0f172a;padding:24px;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:22px;">venta<span style="color:#f97316;">premium</span></h1>
        </div>
        <div style="padding:32px;">
          <h2 style="color:#1e293b;margin:0 0 12px;">Şifre Sıfırlama</h2>
          <p style="color:#64748b;margin:0 0 8px;">Merhaba <strong>${firstName}</strong>,</p>
          <p style="color:#64748b;margin:0 0 24px;">Şifre sıfırlama talebinde bulundunuz. Aşağıdaki butona tıklayarak şifrenizi sıfırlayabilirsiniz.</p>
          <div style="text-align:center;margin:0 0 24px;">
            <a href="${resetUrl}" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:bold;font-size:15px;">
              Şifremi Sıfırla
            </a>
          </div>
          <p style="color:#94a3b8;font-size:13px;margin:0 0 8px;">Bu link <strong>1 saat</strong> geçerlidir.</p>
          <p style="color:#94a3b8;font-size:13px;margin:0;">Bu talebi siz yapmadıysanız bu e-postayı görmezden gelin.</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
          <p style="color:#cbd5e1;font-size:12px;text-align:center;margin:0;">© 2025 Venta Premium. Tüm hakları saklıdır.</p>
        </div>
      </div>
    </body></html>
  `;
  await sendMail({ to, subject: 'Şifre Sıfırlama — Venta Premium', html });
};

const sendVerificationEmail = async ({ to, firstName, verifyUrl }) => {
  const html = `
    <!DOCTYPE html><html lang="tr">
    <body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:20px;">
    <div style="max-width:500px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;">
      <div style="background:#0f172a;padding:24px;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:22px;">venta<span style="color:#f97316;">premium</span></h1>
      </div>
      <div style="padding:32px;">
        <div style="text-align:center;margin-bottom:24px;">
          <div style="font-size:48px;margin-bottom:12px;">✉️</div>
          <h2 style="color:#1e293b;margin:0 0 8px;">E-posta Adresinizi Doğrulayın</h2>
          <p style="color:#64748b;margin:0;">Merhaba <strong>${firstName}</strong>, hesabınızı aktifleştirmek için aşağıdaki butona tıklayın.</p>
        </div>
        <div style="text-align:center;margin:0 0 24px;">
          <a href="${verifyUrl}" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:bold;font-size:15px;">
            E-postamı Doğrula
          </a>
        </div>
        <p style="color:#94a3b8;font-size:13px;text-align:center;margin:0;">Bu link <strong>24 saat</strong> geçerlidir. Hesap oluşturmadıysanız görmezden gelin.</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
        <p style="color:#cbd5e1;font-size:12px;text-align:center;margin:0;">© 2025 Venta Premium</p>
      </div>
    </div>
    </body></html>
  `;
  await sendMail({ to, subject: 'E-posta Adresinizi Doğrulayın — Venta Premium', html });
};

const sendOrderConfirmationEmail = async ({ to, firstName, orderNumber, items, total, shippingCost }) => {
  const itemRows = items.map(i =>
    `<tr><td style="padding:8px 0;color:#374151;border-bottom:1px solid #f1f5f9;">${i.productName}</td>
     <td style="padding:8px 0;text-align:center;color:#6b7280;border-bottom:1px solid #f1f5f9;">x${i.quantity}</td>
     <td style="padding:8px 0;text-align:right;font-weight:bold;border-bottom:1px solid #f1f5f9;">${Number(i.total).toLocaleString('tr-TR')} ₺</td></tr>`
  ).join('');

  const html = `
    <!DOCTYPE html><html lang="tr">
    <body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:20px;">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;">
      <div style="background:#0f172a;padding:24px;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:22px;">venta<span style="color:#f97316;">premium</span></h1>
      </div>
      <div style="padding:32px;">
        <h2 style="color:#1e293b;margin:0 0 8px;">Siparişiniz Alındı! 🎉</h2>
        <p style="color:#64748b;margin:0 0 24px;">Merhaba <strong>${firstName}</strong>, <strong>#${orderNumber}</strong> numaralı siparişiniz başarıyla oluşturuldu.</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px;">
          <thead><tr>
            <th style="text-align:left;padding-bottom:8px;color:#94a3b8;font-weight:normal;border-bottom:2px solid #f1f5f9;">Ürün</th>
            <th style="text-align:center;padding-bottom:8px;color:#94a3b8;font-weight:normal;border-bottom:2px solid #f1f5f9;">Adet</th>
            <th style="text-align:right;padding-bottom:8px;color:#94a3b8;font-weight:normal;border-bottom:2px solid #f1f5f9;">Tutar</th>
          </tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
        <div style="background:#f8fafc;border-radius:8px;padding:16px;font-size:14px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;color:#64748b;">
            <span>Kargo</span><span>${shippingCost > 0 ? Number(shippingCost).toLocaleString('tr-TR') + ' ₺' : 'Ücretsiz'}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:16px;font-weight:bold;color:#0f172a;border-top:1px solid #e2e8f0;padding-top:8px;margin-top:6px;">
            <span>Toplam</span><span style="color:#f97316;">${Number(total).toLocaleString('tr-TR')} ₺</span>
          </div>
        </div>
        <p style="color:#94a3b8;font-size:13px;margin:16px 0 0;">Siparişinizi hesabınızdan takip edebilirsiniz.</p>
      </div>
    </div>
    </body></html>
  `;
  await sendMail({ to, subject: `Siparişiniz Alındı — #${orderNumber} | Venta Premium`, html });
};

const sendShippingEmail = async ({ to, firstName, orderNumber, cargoCompany, cargoTrackingNo }) => {
  const html = `
    <!DOCTYPE html><html lang="tr">
    <body style="font-family:Arial,sans-serif;background:#f4f4f4;padding:20px;">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;">
      <div style="background:#0f172a;padding:24px;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:22px;">venta<span style="color:#f97316;">premium</span></h1>
      </div>
      <div style="padding:32px;">
        <div style="text-align:center;margin-bottom:24px;">
          <div style="font-size:48px;margin-bottom:12px;">🚚</div>
          <h2 style="color:#1e293b;margin:0 0 8px;">Siparişiniz Kargoya Verildi!</h2>
          <p style="color:#64748b;margin:0;">Merhaba <strong>${firstName}</strong>, <strong>#${orderNumber}</strong> siparişiniz yola çıktı.</p>
        </div>
        ${cargoCompany || cargoTrackingNo ? `
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px;text-align:center;">
          ${cargoCompany ? `<p style="margin:0 0 4px;color:#15803d;font-weight:bold;">${cargoCompany}</p>` : ''}
          ${cargoTrackingNo ? `<p style="margin:0;color:#166534;font-size:18px;font-weight:bold;letter-spacing:1px;">${cargoTrackingNo}</p>` : ''}
          <p style="margin:6px 0 0;color:#4ade80;font-size:12px;">Takip numaranız</p>
        </div>` : ''}
      </div>
    </div>
    </body></html>
  `;
  await sendMail({ to, subject: `Siparişiniz Kargoya Verildi — #${orderNumber} | Venta Premium`, html });
};

module.exports = { sendPasswordResetEmail, sendVerificationEmail, sendOrderConfirmationEmail, sendShippingEmail };
