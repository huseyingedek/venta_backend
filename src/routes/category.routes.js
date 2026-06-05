const router = require('express').Router();
const prisma = require('../config/prisma');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const slugify = require('../utils/slugify');

const adminOnly = [authenticate, authorize('ADMIN', 'SUPER_ADMIN')];

// Benzersiz slug üret
const generateUniqueSlug = async (name, excludeId = null) => {
  const base = slugify(name);
  let slug = base;
  let counter = 1;
  while (true) {
    const existing = await prisma.category.findUnique({ where: { slug } });
    if (!existing || existing.id === excludeId) return slug;
    slug = `${base}-${counter++}`;
  }
};

// GET /api/v1/categories
// ?all=true  → admin için tüm kategoriler (pasif dahil)
router.get('/', async (req, res, next) => {
  try {
    const showAll = req.query.all === 'true';
    const categories = await prisma.category.findMany({
      where: { parentId: null, ...(!showAll && { isActive: true }) },
      include: {
        children: {
          where: showAll ? {} : { isActive: true },
          orderBy: { sortOrder: 'asc' },
          include: { _count: { select: { products: true } } },
        },
        _count: { select: { products: true } },
      },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ success: true, data: categories });
  } catch (err) { next(err); }
});

// POST /api/v1/categories (Admin)
router.post('/', ...adminOnly, async (req, res, next) => {
  try {
    const { name, description, parentId, sortOrder, isActive, image, metaTitle, metaDesc } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: 'Kategori adı gereklidir.' });
    }

    const slug = await generateUniqueSlug(name);

    const category = await prisma.category.create({
      data: {
        name: name.trim(),
        slug,
        description: description || null,
        image: image || null,
        parentId: parentId || null,
        sortOrder: sortOrder ? parseInt(sortOrder) : 0,
        isActive: isActive !== false,
        metaTitle: metaTitle || null,
        metaDesc: metaDesc || null,
      },
    });
    res.status(201).json({ success: true, data: category });
  } catch (err) { next(err); }
});

// PUT /api/v1/categories/:id (Admin)
router.put('/:id', ...adminOnly, async (req, res, next) => {
  try {
    const { name, description, parentId, sortOrder, isActive, image, metaTitle, metaDesc } = req.body;

    const updateData = {
      ...(description !== undefined && { description: description || null }),
      ...(parentId !== undefined && { parentId: parentId || null }),
      ...(sortOrder !== undefined && { sortOrder: parseInt(sortOrder) }),
      ...(isActive !== undefined && { isActive }),
      ...(image !== undefined && { image: image || null }),
      ...(metaTitle !== undefined && { metaTitle: metaTitle || null }),
      ...(metaDesc !== undefined && { metaDesc: metaDesc || null }),
    };

    if (name?.trim()) {
      updateData.name = name.trim();
      updateData.slug = await generateUniqueSlug(name, req.params.id);
    }

    const category = await prisma.category.update({
      where: { id: req.params.id },
      data: updateData,
    });
    res.json({ success: true, data: category });
  } catch (err) { next(err); }
});

// DELETE /api/v1/categories/:id (Admin)
router.delete('/:id', ...adminOnly, async (req, res, next) => {
  try {
    const count = await prisma.product.count({ where: { categoryId: req.params.id } });
    if (count > 0) {
      return res.status(400).json({ success: false, message: `Bu kategoride ${count} ürün var. Önce ürünleri başka kategoriye taşıyın.` });
    }
    await prisma.category.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
