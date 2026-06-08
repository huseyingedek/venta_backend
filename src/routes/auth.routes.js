const router = require('express').Router();
const { register, login, refresh, logout, me } = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const { sendPasswordResetEmail, sendVerificationEmail } = require('../utils/email');

const generateVerifyToken = (userId, createdAt) =>
  jwt.sign({ userId }, process.env.JWT_SECRET + 'email-verify' + createdAt, { expiresIn: '24h' });

router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.get('/me', authenticate, me);

// GET /api/v1/auth/verify-email?token=...&id=...
router.get('/verify-email', async (req, res, next) => {
  try {
    const { token, id } = req.query;
    if (!token || !id) return res.status(400).json({ success: false, message: 'Geçersiz istek.' });

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(400).json({ success: false, message: 'Kullanıcı bulunamadı.' });
    if (user.emailVerified) return res.json({ success: true, message: 'E-posta zaten doğrulanmış.' });

    try {
      jwt.verify(token, process.env.JWT_SECRET + 'email-verify' + user.createdAt.toISOString());
    } catch {
      return res.status(400).json({ success: false, message: 'Link geçersiz veya süresi dolmuş.' });
    }

    await prisma.user.update({ where: { id }, data: { emailVerified: true } });
    res.json({ success: true, message: 'E-posta başarıyla doğrulandı.' });
  } catch (err) { next(err); }
});

// POST /api/v1/auth/resend-verification
router.post('/resend-verification', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ success: false, message: 'Kullanıcı bulunamadı.' });
    if (user.emailVerified) return res.json({ success: true, message: 'E-posta zaten doğrulanmış.' });

    const token = generateVerifyToken(user.id, user.createdAt.toISOString());
    // CLIENT_URL virgüllü CORS listesi olabilir — ilk değeri al
    const clientBase = (process.env.FRONTEND_URL || process.env.CLIENT_URL || 'https://ventapremium.com.tr').split(',')[0].trim();
    const verifyUrl = `${clientBase}/auth/verify-email?token=${token}&id=${user.id}`;
    await sendVerificationEmail({ to: user.email, firstName: user.firstName, verifyUrl });

    res.json({ success: true, message: 'Doğrulama maili tekrar gönderildi.' });
  } catch (err) { next(err); }
});

// POST /api/v1/auth/forgot-password
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'E-posta gereklidir.' });

    const user = await prisma.user.findUnique({ where: { email } });

    // Güvenlik: kullanıcı bulunsun ya da bulunmasın aynı cevabı ver
    if (!user || !user.isActive) {
      return res.json({ success: true, message: 'E-posta adresinize sıfırlama linki gönderdik.' });
    }

    // Token: kullanıcının mevcut şifre hash'iyle imzala → şifre değişince geçersiz olur
    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET + user.password,
      { expiresIn: '1h' }
    );

    const clientBase = (process.env.FRONTEND_URL || process.env.CLIENT_URL || 'https://ventapremium.com.tr').split(',')[0].trim();
    const resetUrl = `${clientBase}/auth/reset-password?token=${token}&id=${user.id}`;

    await sendPasswordResetEmail({
      to: user.email,
      firstName: user.firstName,
      resetUrl,
    });

    res.json({ success: true, message: 'E-posta adresinize sıfırlama linki gönderdik.' });
  } catch (err) { next(err); }
});

// POST /api/v1/auth/reset-password
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, userId, password } = req.body;

    if (!token || !userId || !password) {
      return res.status(400).json({ success: false, message: 'Geçersiz istek.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Şifre en az 6 karakter olmalıdır.' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(400).json({ success: false, message: 'Geçersiz veya süresi dolmuş link.' });

    // Token'ı kullanıcının şifre hash'iyle doğrula
    try {
      jwt.verify(token, process.env.JWT_SECRET + user.password);
    } catch {
      return res.status(400).json({ success: false, message: 'Link geçersiz veya süresi dolmuş.' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    // Tüm refresh token'ları iptal et
    await prisma.refreshToken.deleteMany({ where: { userId } });

    res.json({ success: true, message: 'Şifreniz başarıyla güncellendi.' });
  } catch (err) { next(err); }
});

module.exports = router;
