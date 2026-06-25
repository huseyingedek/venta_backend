const router = require('express').Router();
const multer = require('multer');
const prisma = require('../config/prisma');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { syncXmlFeed, syncAllFeeds, syncXmlContent } = require('../services/xml.service');
const slugify = require('../utils/slugify');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

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

// POST /api/v1/suppliers/feeds/:feedId/sync-file  - XML dosyası yükleyerek sync
router.post('/feeds/:feedId/sync-file', ...adminOnly, upload.single('xml'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'XML dosyası gerekli.' });
    const xmlContent = req.file.buffer.toString('utf-8');
    const result = await syncXmlContent(req.params.feedId, xmlContent);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// POST /api/v1/suppliers/backfill-variants  - Mevcut ürünlerin xmlData'sından varyantları doldur
router.post('/backfill-variants', ...adminOnly, async (req, res, next) => {
  try {
    const { parseVariants } = require('../services/xml.service');

    // xmlData'sı olan ama hiç varyantı olmayan ürünleri bul
    const products = await prisma.product.findMany({
      where: { source: 'XML', xmlData: { not: null } },
      include: { variants: { select: { id: true } } },
    });

    let filled = 0, skipped = 0;

    for (const product of products) {
      if (product.variants.length > 0) { skipped++; continue; }

      const xmlData = product.xmlData;
      const variants = parseVariants(xmlData);
      if (!variants.length) { skipped++; continue; }

      await prisma.productVariant.createMany({
        data: variants.map(v => ({ productId: product.id, ...v })),
      });
      filled++;
    }

    res.json({ success: true, data: { filled, skipped, total: products.length } });
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
