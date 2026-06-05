const axios = require('axios');
const xml2js = require('xml2js');
const prisma = require('../config/prisma');
const slugify = require('../utils/slugify');
const { logger } = require('../utils/logger');

const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true, trim: true });

/**
 * xmltedarik.com XML yapısını parse et
 * <products><product>...</product></products>
 */
const parseXmlTedarik = (parsed) => {
  const root = parsed?.products?.product;
  if (!root) return null;
  return Array.isArray(root) ? root : [root];
};

/**
 * Kategori yolundan (ör: "Spor & Outdoor >>> Kamp >>> Elektronik") kategori bul/oluştur
 */
const findOrCreateCategory = async (categoryPath) => {
  if (!categoryPath) return null;

  // "Aksesuar >>> Diğer Aksesuar >>> Tesbih" → ["Aksesuar", "Diğer Aksesuar", "Tesbih"]
  const parts = categoryPath.split('>>>').map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  let parentId = null;

  for (const part of parts) {
    const slug = slugify(part);
    let category = await prisma.category.findFirst({
      where: { slug, parentId: parentId || null },
    });

    if (!category) {
      // slug çakışması ihtimaline karşı suffix ekle
      const slugFinal = parentId
        ? `${slug}-${String(parentId).slice(-4)}`
        : slug;

      category = await prisma.category.upsert({
        where: { slug: slugFinal },
        update: {},
        create: { name: part, slug: slugFinal, parentId: parentId || null },
      });
    }

    parentId = category.id;
  }

  return parentId;
};

/**
 * Benzersiz slug üret
 */
const generateUniqueSlug = async (name, externalId) => {
  const base = slugify(name);
  const existing = await prisma.product.findFirst({ where: { slug: base } });
  if (!existing) return base;
  return `${base}-${String(externalId).slice(-6)}`;
};

/**
 * Tek XML feed senkronize et
 */
const syncXmlFeed = async (feedId) => {
  const feed = await prisma.xmlFeed.findUnique({
    where: { id: feedId },
    include: { supplier: true },
  });

  if (!feed || !feed.isActive) {
    logger.warn(`XML Feed ${feedId} aktif değil veya bulunamadı.`);
    return { created: 0, updated: 0, skipped: 0 };
  }

  logger.info(`XML sync başladı: ${feed.name}`);

  try {
    const response = await axios.get(feed.url, {
      timeout: 60000,
      responseType: 'text',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
      },
    });

    const parsed = await parser.parseStringPromise(response.data);
    const products = parseXmlTedarik(parsed);
    if (!products) throw new Error('XML yapısı tanınamadı (products.product bulunamadı).');

    let created = 0, updated = 0, skipped = 0;

    for (const item of products) {
      try {
        // Aktif olmayan ürünleri atla
        if (item.active === '0' || item.active === 0) { skipped++; continue; }

        const externalId = String(item.id || '').trim();
        const sku        = String(item.productCode || '').trim() || null;
        const name       = String(item.name || '').trim();
        const price      = parseFloat(item.listPrice || item.price || 0);
        const stock      = parseInt(item.quantity || 0);
        const description = item.detail ? String(item.detail).trim() : null;
        const thumbnail  = item.image1 || null;

        if (!name || !externalId) { skipped++; continue; }

        // Çoklu resimler
        const imageUrls = ['image1','image2','image3','image4','image5']
          .map(k => item[k])
          .filter(Boolean);

        // Kategori
        const categoryPath = String(item.category || item.main_category || '').trim();
        const categoryId = await findOrCreateCategory(categoryPath);

        // Varsayılan kategori yoksa oluştur
        let finalCategoryId = categoryId;
        if (!finalCategoryId) {
          const def = await prisma.category.upsert({
            where: { slug: 'genel' },
            update: {},
            create: { name: 'Genel', slug: 'genel' },
          });
          finalCategoryId = def.id;
        }

        const existing = await prisma.product.findFirst({
          where: { externalId, supplierId: feed.supplierId },
        });

        if (existing) {
          // Güncelle — slug ve sku değiştirme
          await prisma.product.update({
            where: { id: existing.id },
            data: {
              name,
              price,
              stock,
              description,
              thumbnail,
              categoryId: finalCategoryId,
              status: stock > 0 ? 'ACTIVE' : 'OUT_OF_STOCK',
              xmlData: item,
            },
          });

          // Görselleri güncelle
          await prisma.productImage.deleteMany({ where: { productId: existing.id } });
          if (imageUrls.length > 0) {
            await prisma.productImage.createMany({
              data: imageUrls.map((url, i) => ({ productId: existing.id, url, sortOrder: i })),
            });
          }
          updated++;
        } else {
          const slug = await generateUniqueSlug(name, externalId);

          // SKU çakışma kontrolü
          let finalSku = sku;
          if (finalSku) {
            const skuExists = await prisma.product.findUnique({ where: { sku: finalSku } });
            if (skuExists) finalSku = `${finalSku}-${externalId.slice(-4)}`;
          }

          const newProduct = await prisma.product.create({
            data: {
              name,
              slug,
              price,
              stock,
              description,
              thumbnail,
              sku: finalSku,
              externalId,
              supplierId: feed.supplierId,
              categoryId: finalCategoryId,
              source: 'XML',
              status: stock > 0 ? 'ACTIVE' : 'OUT_OF_STOCK',
              xmlData: item,
            },
          });

          if (imageUrls.length > 0) {
            await prisma.productImage.createMany({
              data: imageUrls.map((url, i) => ({ productId: newProduct.id, url, sortOrder: i })),
            });
          }
          created++;
        }
      } catch (itemErr) {
        logger.error(`Ürün işlenirken hata [${item?.id}]: ${itemErr.message}`);
        skipped++;
      }
    }

    await prisma.xmlFeed.update({
      where: { id: feedId },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: 'success',
        lastSyncMessage: `Oluşturuldu: ${created}, Güncellendi: ${updated}, Atlandı: ${skipped}`,
      },
    });

    logger.info(`XML sync tamamlandı — Oluşturuldu: ${created}, Güncellendi: ${updated}, Atlandı: ${skipped}`);
    return { created, updated, skipped };

  } catch (err) {
    logger.error(`XML sync hatası (${feed.name}): ${err.message}`);
    await prisma.xmlFeed.update({
      where: { id: feedId },
      data: { lastSyncAt: new Date(), lastSyncStatus: 'error', lastSyncMessage: err.message },
    });
    throw err;
  }
};

/**
 * Tüm aktif XML feed'lerini senkronize et
 */
const syncAllFeeds = async () => {
  const feeds = await prisma.xmlFeed.findMany({ where: { isActive: true } });
  const results = [];
  for (const feed of feeds) {
    try {
      const result = await syncXmlFeed(feed.id);
      results.push({ feedId: feed.id, name: feed.name, ...result });
    } catch (err) {
      results.push({ feedId: feed.id, name: feed.name, error: err.message });
    }
  }
  return results;
};

module.exports = { syncXmlFeed, syncAllFeeds };
