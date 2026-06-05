const router = require('express').Router();
const prisma = require('../config/prisma');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { syncXmlFeed, syncAllFeeds } = require('../services/xml.service');
const slugify = require('../utils/slugify');

const adminOnly = [authenticate, authorize('ADMIN', 'SUPER_ADMIN')];

// GET /api/v1/suppliers
router.get('/', ...adminOnly, async (req, res, next) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      include: { xmlFeeds: true, _count: { select: { products: true } } },
    });
    res.json({ success: true, data: suppliers });
  } catch (err) { next(err); }
});

// POST /api/v1/suppliers
router.post('/', ...adminOnly, async (req, res, next) => {
  try {
    const { name, contactEmail, contactName, phone, website, isActive } = req.body;
    const supplier = await prisma.supplier.create({
      data: {
        name,
        slug: slugify(name),
        email: contactEmail || undefined,   // frontend contactEmail → şema email
        contactName: contactName || undefined,
        phone: phone || undefined,
        website: website || undefined,
        isActive: isActive !== false,
      },
    });
    res.status(201).json({ success: true, data: supplier });
  } catch (err) { next(err); }
});

// POST /api/v1/suppliers/:id/feeds  - XML feed ekle
router.post('/:id/feeds', ...adminOnly, async (req, res, next) => {
  try {
    const feed = await prisma.xmlFeed.create({
      data: { ...req.body, supplierId: req.params.id },
    });
    res.status(201).json({ success: true, data: feed });
  } catch (err) { next(err); }
});

// POST /api/v1/suppliers/feeds/:feedId/sync  - Manuel senkronize
router.post('/feeds/:feedId/sync', ...adminOnly, async (req, res, next) => {
  try {
    const result = await syncXmlFeed(req.params.feedId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// POST /api/v1/suppliers/sync-all
router.post('/sync-all', ...adminOnly, async (req, res, next) => {
  try {
    const results = await syncAllFeeds();
    res.json({ success: true, data: results });
  } catch (err) { next(err); }
});

module.exports = router;
