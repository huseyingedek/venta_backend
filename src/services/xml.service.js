const axios = require('axios');
const xml2js = require('xml2js');
const prisma = require('../config/prisma');
const slugify = require('../utils/slugify');
const { logger } = require('../utils/logger');

const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });

/**
 * XML feed'i çekip ürünleri güncelle/oluştur
 */
const syncXmlFeed = async (feedId) => {
  const feed = await prisma.xmlFeed.findUnique({
    where: { id: feedId },
    include: { supplier: true },
  });

  if (!feed || !feed.isActive) {
    logger.warn(`XML Feed ${feedId} aktif değil veya bulunamadı.`);
    return;
  }

  logger.info(`XML senkronizasyonu başladı: ${feed.name} (${feed.url})`);

  try {
    const response = await axios.get(feed.url, { timeout: 30000, responseType: 'text' });
    const parsed = await parser.parseStringPromise(response.data);

    // Field mapping - tedarikçiye göre özelleştirilebilir
    const mapping = feed.fieldMapping || {
      root: 'products.product',   // XML'deki ürün listesi yolu
      name: 'name',
      sku: 'code',
      price: 'price',
      stock: 'stock',
      description: 'description',
      image: 'image',
      category: 'category',
    };

    const products = getNestedValue(parsed, mapping.root);
    if (!products) throw new Error('XML yapısı tanınamadı.');

    const productArray = Array.isArray(products) ? products : [products];
    let created = 0, updated = 0, skipped = 0;

    for (const item of productArray) {
      try {
        const externalId = getNestedValue(item, mapping.sku || 'code') || getNestedValue(item, 'id');
        const name = getNestedValue(item, mapping.name || 'name');
        const price = parseFloat(getNestedValue(item, mapping.price || 'price')) || 0;
        const stock = parseInt(getNestedValue(item, mapping.stock || 'stock')) || 0;
        const description = getNestedValue(item, mapping.description || 'description');
        const imageUrl = getNestedValue(item, mapping.image || 'image');

        if (!name || !externalId) { skipped++; continue; }

        const slug = await generateUniqueSlug(name, externalId);

        const existing = await prisma.product.findFirst({
          where: { externalId, supplierId: feed.supplierId },
        });

        const productData = {
          name,
          price,
          stock,
          description: description || null,
          thumbnail: imageUrl || null,
          supplierId: feed.supplierId,
          source: 'XML',
          xmlData: item,
          status: stock > 0 ? 'ACTIVE' : 'OUT_OF_STOCK',
        };

        if (existing) {
          await prisma.product.update({ where: { id: existing.id }, data: productData });
          updated++;
        } else {
          // XML ile gelen ürün için kategori gerekliyse otomatik ata ya da varsayılan kullan
          const defaultCategory = await prisma.category.findFirst({ where: { parentId: null } });
          await prisma.product.create({
            data: {
              ...productData,
              slug,
              externalId: String(externalId),
              sku: String(externalId),
              categoryId: defaultCategory?.id || (await createDefaultCategory()),
            },
          });
          created++;
        }
      } catch (itemErr) {
        logger.error(`Ürün işlenirken hata: ${itemErr.message}`);
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

// Yardımcı: nesne içinde nokta-notasyonlu yol
const getNestedValue = (obj, path) => {
  return path.split('.').reduce((acc, key) => acc?.[key], obj);
};

const generateUniqueSlug = async (name, externalId) => {
  const base = slugify(name);
  const existing = await prisma.product.findFirst({ where: { slug: base } });
  if (!existing) return base;
  return `${base}-${String(externalId).slice(-6)}`;
};

const createDefaultCategory = async () => {
  const cat = await prisma.category.create({
    data: { name: 'Genel', slug: 'genel' },
  });
  return cat.id;
};

module.exports = { syncXmlFeed, syncAllFeeds };
