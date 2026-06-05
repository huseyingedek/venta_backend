const prisma = require('../config/prisma');
const slugify = require('../utils/slugify');

// GET /api/v1/products
const getProducts = async (req, res, next) => {
  try {
    const {
      page = 1, limit = 20, category, search,
      minPrice, maxPrice, sort = 'createdAt', order = 'desc',
      featured, isNew, status = 'ACTIVE',
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = { status };

    if (category) where.category = { slug: category };
    if (featured === 'true') where.isFeatured = true;
    if (isNew === 'true') where.isNew = true;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (minPrice || maxPrice) {
      where.price = {};
      if (minPrice) where.price.gte = parseFloat(minPrice);
      if (maxPrice) where.price.lte = parseFloat(maxPrice);
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { [sort]: order },
        select: {
          id: true, name: true, slug: true, sku: true, price: true,
          comparePrice: true, stock: true, thumbnail: true, status: true,
          isFeatured: true, isNew: true, createdAt: true,
          category: { select: { id: true, name: true, slug: true } },
          images: { take: 1, orderBy: { sortOrder: 'asc' }, select: { url: true } },
          _count: { select: { reviews: true } },
        },
      }),
      prisma.product.count({ where }),
    ]);

    res.json({
      success: true,
      data: products,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/products/:slug
const getProduct = async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({
      where: { slug: req.params.slug },
      include: {
        category: { select: { id: true, name: true, slug: true, parent: { select: { name: true, slug: true } } } },
        images: { orderBy: { sortOrder: 'asc' } },
        attributes: true,
        variants: { where: { isActive: true } },
        supplier: { select: { name: true } },
        reviews: {
          where: { isApproved: true },
          include: { user: { select: { firstName: true, lastName: true } } },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        _count: { select: { reviews: true } },
      },
    });

    if (!product) {
      return res.status(404).json({ success: false, message: 'Ürün bulunamadı.' });
    }

    res.json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/products (Admin)
const createProduct = async (req, res, next) => {
  try {
    const {
      name, categoryId, price,
      attributes, variants,
      // Şemada olmayan / ayrı handle edilen alanlar
      lowStockAlert, trackStock,
      comparePrice, costPrice, stock, taxRate,
      sku, description, shortDesc, status, source,
      isFeatured, isNew, metaTitle, metaDesc, thumbnail,
    } = req.body;

    if (!name?.trim()) return res.status(400).json({ success: false, message: 'Ürün adı gereklidir.' });
    if (!categoryId) return res.status(400).json({ success: false, message: 'Kategori seçilmedi.' });

    const slug = await generateUniqueSlug(name);

    const product = await prisma.product.create({
      data: {
        name: name.trim(),
        slug,
        categoryId,
        price:        parseFloat(price) || 0,
        comparePrice: comparePrice ? parseFloat(comparePrice) : null,
        costPrice:    costPrice    ? parseFloat(costPrice)    : null,
        stock:        parseInt(stock)  || 0,
        taxRate:      parseFloat(taxRate) || 18,
        sku:          sku?.trim()   || null,
        description:  description  || null,
        shortDesc:    shortDesc    || null,
        status:       status       || 'ACTIVE',
        source:       source       || 'MANUAL',
        isFeatured:   isFeatured   === true || isFeatured === 'true',
        isNew:        isNew        === true || isNew        === 'true',
        metaTitle:    metaTitle    || null,
        metaDesc:     metaDesc     || null,
        thumbnail:    thumbnail    || null,
        ...(attributes?.length > 0 && {
          attributes: { create: attributes.map(a => ({ name: a.name, value: a.value })) },
        }),
        ...(variants?.length > 0 && {
          variants: { create: variants.map(v => ({ name: v.name, price: parseFloat(v.price || 0), stock: parseInt(v.stock || 0) })) },
        }),
      },
      include: { category: true, images: true, attributes: true },
    });

    res.status(201).json({ success: true, data: product });
  } catch (err) {
    if (err.code === 'P2002' && err.meta?.target?.includes('sku')) {
      return res.status(409).json({ success: false, message: 'Bu SKU kodu zaten kullanılıyor. Farklı bir SKU girin veya boş bırakın.' });
    }
    next(err);
  }
};

// PUT /api/v1/products/:id (Admin)
const updateProduct = async (req, res, next) => {
  try {
    const {
      name, attributes, variants,
      lowStockAlert, trackStock,
      price, comparePrice, costPrice, stock, taxRate,
      sku, description, shortDesc, status, source,
      isFeatured, isNew, metaTitle, metaDesc, thumbnail, categoryId,
    } = req.body;

    const updateData = {
      ...(categoryId   !== undefined && { categoryId }),
      ...(price        !== undefined && { price:        parseFloat(price) || 0 }),
      ...(comparePrice !== undefined && { comparePrice: comparePrice ? parseFloat(comparePrice) : null }),
      ...(costPrice    !== undefined && { costPrice:    costPrice    ? parseFloat(costPrice)    : null }),
      ...(stock        !== undefined && { stock:        parseInt(stock) || 0 }),
      ...(taxRate      !== undefined && { taxRate:      parseFloat(taxRate) || 18 }),
      ...(sku          !== undefined && { sku:          sku?.trim() || null }),
      ...(description  !== undefined && { description:  description || null }),
      ...(shortDesc    !== undefined && { shortDesc:    shortDesc   || null }),
      ...(status       !== undefined && { status }),
      ...(source       !== undefined && { source }),
      ...(isFeatured   !== undefined && { isFeatured:   isFeatured === true || isFeatured === 'true' }),
      ...(isNew        !== undefined && { isNew:        isNew === true || isNew === 'true' }),
      ...(metaTitle    !== undefined && { metaTitle:    metaTitle || null }),
      ...(metaDesc     !== undefined && { metaDesc:     metaDesc  || null }),
      ...(thumbnail    !== undefined && { thumbnail:    thumbnail || null }),
    };

    if (name) {
      updateData.name = name;
      updateData.slug = await generateUniqueSlug(name, req.params.id);
    }

    // Attributes: mevcut sil, yenileri ekle
    if (attributes !== undefined) {
      await prisma.productAttribute.deleteMany({ where: { productId: req.params.id } });
      if (attributes.length > 0) {
        updateData.attributes = { create: attributes.map(a => ({ name: a.name, value: a.value })) };
      }
    }

    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: updateData,
      include: { category: true, images: true, attributes: true },
    });

    res.json({ success: true, data: product });
  } catch (err) {
    if (err.code === 'P2002' && err.meta?.target?.includes('sku')) {
      return res.status(409).json({ success: false, message: 'Bu SKU kodu zaten kullanılıyor. Farklı bir SKU girin veya boş bırakın.' });
    }
    next(err);
  }
};

// DELETE /api/v1/products/:id (Admin)
const deleteProduct = async (req, res, next) => {
  try {
    await prisma.product.update({
      where: { id: req.params.id },
      data: { status: 'INACTIVE' },
    });
    res.json({ success: true, message: 'Ürün devre dışı bırakıldı.' });
  } catch (err) {
    next(err);
  }
};

const generateUniqueSlug = async (name, excludeId = null) => {
  let slug = slugify(name);
  let counter = 0;
  while (true) {
    const candidate = counter === 0 ? slug : `${slug}-${counter}`;
    const existing = await prisma.product.findUnique({ where: { slug: candidate } });
    if (!existing || existing.id === excludeId) return candidate;
    counter++;
  }
};

// GET /api/v1/products/by-id/:id (Admin)
const getProductById = async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: {
        category: true,
        images: { orderBy: { sortOrder: 'asc' } },
        attributes: true,
        variants: true,
        supplier: { select: { name: true } },
        _count: { select: { reviews: true } },
      },
    });
    if (!product) return res.status(404).json({ success: false, message: 'Ürün bulunamadı.' });
    res.json({ success: true, data: product });
  } catch (err) { next(err); }
};

module.exports = { getProducts, getProduct, getProductById, createProduct, updateProduct, deleteProduct };
