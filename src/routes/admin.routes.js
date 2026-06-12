const router = require('express').Router();
const prisma = require('../config/prisma');
const { authenticate, authorize } = require('../middleware/auth.middleware');

const adminOnly = [authenticate, authorize('ADMIN', 'SUPER_ADMIN')];

// GET /api/v1/admin/dashboard
router.get('/dashboard', ...adminOnly, async (req, res, next) => {
  try {
    const [totalProducts, totalOrders, totalUsers, recentOrders, topProducts] = await Promise.all([
      prisma.product.count({ where: { status: 'ACTIVE' } }),
      prisma.order.count(),
      prisma.user.count({ where: { role: 'CUSTOMER' } }),
      prisma.order.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { firstName: true, lastName: true, email: true } } },
      }),
      prisma.orderItem.groupBy({
        by: ['productId'],
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 5,
      }),
    ]);

    const revenue = await prisma.order.aggregate({
      where: { status: { in: ['CONFIRMED', 'PREPARING', 'SHIPPED', 'DELIVERED'] } },
      _sum: { total: true },
    });

    // Son 7 günlük günlük gelir (grafik için)
    const now = new Date();
    const weeklyRevenue = await Promise.all(
      Array.from({ length: 7 }, (_, i) => {
        const date = new Date(now);
        date.setDate(date.getDate() - (6 - i));
        const start = new Date(date.setHours(0, 0, 0, 0));
        const end = new Date(date.setHours(23, 59, 59, 999));
        return prisma.order.aggregate({
          where: {
            createdAt: { gte: start, lte: end },
            status: { in: ['CONFIRMED', 'PREPARING', 'SHIPPED', 'DELIVERED'] },
          },
          _sum: { total: true },
          _count: true,
        }).then(r => ({
          date: start.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' }),
          gelir: Number(r._sum.total || 0),
          siparis: r._count,
        }));
      })
    );

    res.json({
      success: true,
      data: {
        stats: {
          totalProducts,
          totalOrders,
          totalUsers,
          totalRevenue: revenue._sum.total || 0,
        },
        recentOrders,
        topProducts,
        weeklyRevenue,
      },
    });
  } catch (err) { next(err); }
});

// GET /api/v1/admin/orders
router.get('/orders', ...adminOnly, async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const where = status ? { status } : {};
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        include: { user: { select: { firstName: true, lastName: true, email: true, phone: true } }, items: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.order.count({ where }),
    ]);
    res.json({ success: true, data: orders, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
  } catch (err) { next(err); }
});

// GET /api/v1/admin/users
router.get('/users', ...adminOnly, async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true, createdAt: true, _count: { select: { orders: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: users });
  } catch (err) { next(err); }
});

// GET /api/v1/admin/reviews
router.get('/reviews', ...adminOnly, async (req, res, next) => {
  try {
    const { approved } = req.query;
    const where = approved !== undefined ? { isApproved: approved === 'true' } : {};
    const reviews = await prisma.review.findMany({
      where,
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        product: { select: { name: true, slug: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: reviews });
  } catch (err) { next(err); }
});

// PATCH /api/v1/admin/reviews/:id
router.patch('/reviews/:id', ...adminOnly, async (req, res, next) => {
  try {
    const review = await prisma.review.update({
      where: { id: req.params.id },
      data: { isApproved: req.body.isApproved },
    });
    res.json({ success: true, data: review });
  } catch (err) { next(err); }
});

// DELETE /api/v1/admin/reviews/:id
router.delete('/reviews/:id', ...adminOnly, async (req, res, next) => {
  try {
    await prisma.review.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// PATCH /api/v1/admin/users/:id
router.patch('/users/:id', ...adminOnly, async (req, res, next) => {
  try {
    const { role, isActive } = req.body;
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { ...(role && { role }), ...(isActive !== undefined && { isActive }) },
      select: { id: true, email: true, role: true, isActive: true },
    });
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
});

// GET /api/v1/orders/admin/:id — Sipariş detayı (admin)
// Not: order.routes.js'e eklemek yerine burada admin route olarak tutuyoruz
router.get('/orders/:id', ...adminOnly, async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        address: true,
        items: {
          include: {
            product: { select: { name: true, thumbnail: true, slug: true } },
          },
        },
      },
    });
    if (!order) return res.status(404).json({ success: false, message: 'Sipariş bulunamadı.' });
    res.json({ success: true, data: order });
  } catch (err) { next(err); }
});

// GET /api/v1/admin/users/:id/details — Sepet + Favori + Son siparişler
router.get('/users/:id/details', ...adminOnly, async (req, res, next) => {
  try {
    const userId = req.params.id;

    const [cart, wishlist, orders] = await Promise.all([
      prisma.cart.findUnique({
        where: { userId },
        include: {
          items: {
            include: {
              product: { select: { id: true, name: true, thumbnail: true, price: true, slug: true } },
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      }),
      prisma.wishlist.findMany({
        where: { userId },
        include: {
          product: { select: { id: true, name: true, thumbnail: true, price: true, slug: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.order.findMany({
        where: { userId },
        select: {
          id: true, orderNumber: true, total: true, status: true, createdAt: true,
          items: { select: { quantity: true }, take: 1 },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    res.json({
      success: true,
      data: {
        cart: cart?.items ?? [],
        wishlist,
        recentOrders: orders,
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
