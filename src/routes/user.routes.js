const router = require('express').Router();
const prisma = require('../config/prisma');
const bcrypt = require('bcryptjs');
const { authenticate } = require('../middleware/auth.middleware');

// GET /api/v1/users/profile
router.get('/profile', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, createdAt: true },
    });
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
});

// PUT /api/v1/users/profile
router.put('/profile', authenticate, async (req, res, next) => {
  try {
    const { firstName, lastName, phone } = req.body;
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { firstName, lastName, phone },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true },
    });
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
});

// PUT /api/v1/users/password
router.put('/password', authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) return res.status(400).json({ success: false, message: 'Mevcut şifre hatalı.' });
    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: req.user.id }, data: { password: hashed } });
    res.json({ success: true, message: 'Şifre güncellendi.' });
  } catch (err) { next(err); }
});

// GET /api/v1/users/addresses
router.get('/addresses', authenticate, async (req, res, next) => {
  try {
    const addresses = await prisma.address.findMany({ where: { userId: req.user.id }, orderBy: { isDefault: 'desc' } });
    res.json({ success: true, data: addresses });
  } catch (err) { next(err); }
});

// POST /api/v1/users/addresses
router.post('/addresses', authenticate, async (req, res, next) => {
  try {
    const data = { ...req.body, userId: req.user.id };
    if (data.isDefault) {
      await prisma.address.updateMany({ where: { userId: req.user.id }, data: { isDefault: false } });
    }
    const address = await prisma.address.create({ data });
    res.status(201).json({ success: true, data: address });
  } catch (err) { next(err); }
});

// DELETE /api/v1/users/addresses/:id
router.delete('/addresses/:id', authenticate, async (req, res, next) => {
  try {
    await prisma.address.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
    res.json({ success: true, message: 'Adres silindi.' });
  } catch (err) { next(err); }
});

// GET /api/v1/users/wishlist
router.get('/wishlist', authenticate, async (req, res, next) => {
  try {
    const items = await prisma.wishlist.findMany({
      where: { userId: req.user.id },
      include: {
        product: {
          select: {
            id: true, name: true, slug: true, price: true, comparePrice: true,
            thumbnail: true, stock: true, status: true,
            images: { take: 1, select: { url: true } },
          }
        }
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: items });
  } catch (err) { next(err); }
});

// POST /api/v1/users/wishlist
router.post('/wishlist', authenticate, async (req, res, next) => {
  try {
    const { productId } = req.body;
    const existing = await prisma.wishlist.findUnique({
      where: { userId_productId: { userId: req.user.id, productId } },
    });
    if (existing) {
      await prisma.wishlist.delete({ where: { id: existing.id } });
      return res.json({ success: true, action: 'removed' });
    }
    await prisma.wishlist.create({ data: { userId: req.user.id, productId } });
    res.json({ success: true, action: 'added' });
  } catch (err) { next(err); }
});

// DELETE /api/v1/users/wishlist/:productId
router.delete('/wishlist/:productId', authenticate, async (req, res, next) => {
  try {
    await prisma.wishlist.deleteMany({
      where: { userId: req.user.id, productId: req.params.productId },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /api/v1/users/reviews
router.post('/reviews', authenticate, async (req, res, next) => {
  try {
    const { productId, rating, title, comment } = req.body;
    const review = await prisma.review.upsert({
      where: { productId_userId: { productId, userId: req.user.id } },
      update: { rating, title, comment, isApproved: false },
      create: { productId, userId: req.user.id, rating, title, comment },
    });
    res.json({ success: true, data: review, message: 'Yorumunuz incelemeye alındı.' });
  } catch (err) { next(err); }
});

module.exports = router;
