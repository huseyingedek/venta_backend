const router = require('express').Router();
const prisma = require('../config/prisma');
const { authenticate, authorize } = require('../middleware/auth.middleware');

const adminOnly = [authenticate, authorize('ADMIN', 'SUPER_ADMIN')];

const PRODUCT_SELECT = {
  id: true, name: true, slug: true, price: true,
  comparePrice: true, stock: true, thumbnail: true,
  isFeatured: true, isNew: true,
  category: { select: { id: true, name: true, slug: true } },
  _count: { select: { reviews: true } },
};

// ── PUBLIC: GET /api/v1/homepage/sections ────────────────────────────────
router.get('/sections', async (req, res, next) => {
  try {
    const sections = await prisma.homepageSection.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        products: {
          orderBy: { sortOrder: 'asc' },
          include: { product: { select: PRODUCT_SELECT } },
        },
      },
    });

    const data = sections.map(s => ({
      ...s,
      products: s.products.map(p => p.product),
    }));

    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// ── ADMIN: GET /api/v1/homepage/sections/all ─────────────────────────────
router.get('/sections/all', ...adminOnly, async (req, res, next) => {
  try {
    const sections = await prisma.homepageSection.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        products: {
          orderBy: { sortOrder: 'asc' },
          include: {
            product: {
              select: { id: true, name: true, slug: true, price: true, thumbnail: true },
            },
          },
        },
      },
    });
    res.json({ success: true, data: sections });
  } catch (err) { next(err); }
});

// ── ADMIN: POST /api/v1/homepage/sections ────────────────────────────────
router.post('/sections', ...adminOnly, async (req, res, next) => {
  try {
    const { title, subtitle } = req.body;
    if (!title?.trim()) return res.status(400).json({ success: false, message: 'Başlık gerekli' });
    const last = await prisma.homepageSection.findFirst({ orderBy: { sortOrder: 'desc' } });
    const section = await prisma.homepageSection.create({
      data: { title: title.trim(), subtitle: subtitle?.trim() || null, sortOrder: (last?.sortOrder ?? -1) + 1 },
    });
    res.status(201).json({ success: true, data: section });
  } catch (err) { next(err); }
});

// ── ADMIN: PUT /api/v1/homepage/sections/:id ─────────────────────────────
router.put('/sections/:id', ...adminOnly, async (req, res, next) => {
  try {
    const { title, subtitle, linkUrl, isActive, sortOrder } = req.body;
    const section = await prisma.homepageSection.update({
      where: { id: req.params.id },
      data: {
        ...(title !== undefined && { title: title.trim() }),
        ...(subtitle !== undefined && { subtitle: subtitle?.trim() || null }),
        ...(linkUrl !== undefined && { linkUrl: linkUrl?.trim() || null }),
        ...(isActive !== undefined && { isActive }),
        ...(sortOrder !== undefined && { sortOrder }),
      },
      include: { products: { include: { product: { select: { id: true, name: true, thumbnail: true, price: true } } } } },
    });
    res.json({ success: true, data: section });
  } catch (err) { next(err); }
});

// ── ADMIN: DELETE /api/v1/homepage/sections/:id ──────────────────────────
router.delete('/sections/:id', ...adminOnly, async (req, res, next) => {
  try {
    await prisma.homepageSection.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── ADMIN: POST /api/v1/homepage/sections/:id/products ───────────────────
// Bölüme ürün ekle
router.post('/sections/:id/products', ...adminOnly, async (req, res, next) => {
  try {
    const { productId } = req.body;
    if (!productId) return res.status(400).json({ success: false, message: 'productId gerekli' });

    const last = await prisma.homepageSectionProduct.findFirst({
      where: { sectionId: req.params.id },
      orderBy: { sortOrder: 'desc' },
    });

    await prisma.homepageSectionProduct.upsert({
      where: { sectionId_productId: { sectionId: req.params.id, productId } },
      create: { sectionId: req.params.id, productId, sortOrder: (last?.sortOrder ?? -1) + 1 },
      update: {},
    });

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── ADMIN: DELETE /api/v1/homepage/sections/:id/products/:productId ──────
router.delete('/sections/:id/products/:productId', ...adminOnly, async (req, res, next) => {
  try {
    await prisma.homepageSectionProduct.deleteMany({
      where: { sectionId: req.params.id, productId: req.params.productId },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── ADMIN: PATCH /api/v1/homepage/sections/reorder ───────────────────────
router.patch('/sections/reorder', ...adminOnly, async (req, res, next) => {
  try {
    const { ids } = req.body;
    await Promise.all(ids.map((id, i) => prisma.homepageSection.update({ where: { id }, data: { sortOrder: i } })));
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
