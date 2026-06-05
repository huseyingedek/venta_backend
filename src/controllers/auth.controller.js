const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../config/prisma');
const { sendVerificationEmail } = require('../utils/email');

// E-posta doğrulama token'ı üret (JWT, 24 saat)
const generateVerifyToken = (userId, createdAt) =>
  jwt.sign({ userId }, process.env.JWT_SECRET + 'email-verify' + createdAt, { expiresIn: '24h' });

const generateTokens = (userId) => {
  const accessToken = jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
  });
  const refreshToken = jwt.sign({ userId, jti: uuidv4() }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  });
  return { accessToken, refreshToken };
};

// POST /api/v1/auth/register
const register = async (req, res, next) => {
  try {
    const { email, password, firstName, lastName, phone } = req.body;

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      return res.status(409).json({ success: false, message: 'Bu e-posta zaten kayıtlı.' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const newUser = await prisma.user.create({
      data: { email, password: hashedPassword, firstName, lastName, phone, emailVerified: false },
    });

    // Doğrulama maili gönder (async)
    const verifyToken = generateVerifyToken(newUser.id, newUser.createdAt.toISOString());
    const verifyUrl = `${process.env.CLIENT_URL}/auth/verify-email?token=${verifyToken}&id=${newUser.id}`;
    sendVerificationEmail({ to: email, firstName, verifyUrl }).catch(() => {});

    const user = { id: newUser.id, email: newUser.email, firstName: newUser.firstName, lastName: newUser.lastName, role: newUser.role, emailVerified: false };
    const { accessToken, refreshToken } = generateTokens(user.id);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({ data: { token: refreshToken, userId: user.id, expiresAt } });

    res.status(201).json({ success: true, data: { user, accessToken, refreshToken } });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/auth/login
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'E-posta veya şifre hatalı.' });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ success: false, message: 'E-posta veya şifre hatalı.' });
    }

    const { accessToken, refreshToken } = generateTokens(user.id);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({ data: { token: refreshToken, userId: user.id, expiresAt } });

    const userData = { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, emailVerified: user.emailVerified };
    res.json({ success: true, data: { user: userData, accessToken, refreshToken } });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/auth/refresh
const refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ success: false, message: 'Refresh token gerekli.' });
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken } });

    if (!stored || stored.expiresAt < new Date()) {
      return res.status(401).json({ success: false, message: 'Geçersiz veya süresi dolmuş token.' });
    }

    await prisma.refreshToken.delete({ where: { token: refreshToken } });

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(decoded.userId);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({ data: { token: newRefreshToken, userId: decoded.userId, expiresAt } });

    res.json({ success: true, data: { accessToken, refreshToken: newRefreshToken } });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Geçersiz token.' });
    }
    next(err);
  }
};

// POST /api/v1/auth/logout
const logout = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
    }
    res.json({ success: true, message: 'Başarıyla çıkış yapıldı.' });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/auth/me
const me = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, role: true, emailVerified: true, createdAt: true },
    });
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
};

module.exports = { register, login, refresh, logout, me };
