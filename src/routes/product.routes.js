const router = require('express').Router();
const { getProducts, getProduct, getProductById, createProduct, updateProduct, deleteProduct } = require('../controllers/product.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const prisma = require('../config/prisma');

router.get('/', getProducts);
router.get('/by-id/:id', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), getProductById);

// GET /api/v1/products/:slug/related
router.get('/:slug/related', async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({
      where: { slug: req.params.slug },
      select: { id: true, categoryId: true },
    });
    if (!product) return res.json({ success: true, data: [] });

    const related = await prisma.product.findMany({
      where: { categoryId: product.categoryId, id: { not: product.id }, status: 'ACTIVE' },
      take: 4,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, slug: true, price: true, comparePrice: true,
        thumbnail: true, stock: true, isNew: true, isFeatured: true,
        category: { select: { id: true, name: true, slug: true } },
        _count: { select: { reviews: true } },
      },
    });
    res.json({ success: true, data: related });
  } catch (err) { next(err); }
});

router.get('/:slug', getProduct);
router.post('/', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), createProduct);
router.put('/:id', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), updateProduct);
router.delete('/:id', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), deleteProduct);

// Ürün görseli kaydet
router.post('/:id/images', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { url, alt, sortOrder = 0 } = req.body;
    const prisma = require('../config/prisma');
    const image = await prisma.productImage.create({
      data: { productId: req.params.id, url, alt, sortOrder },
    });
    res.status(201).json({ success: true, data: image });
  } catch (err) { next(err); }
});

// Ürün görselini sil
router.delete('/:id/images/:imageId', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const prisma = require('../config/prisma');
    await prisma.productImage.deleteMany({
      where: { id: req.params.imageId, productId: req.params.id },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
