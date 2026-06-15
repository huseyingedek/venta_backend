const axios = require('axios');
const xml2js = require('xml2js');
const prisma = require('../config/prisma');
const slugify = require('../utils/slugify');
const { logger } = require('../utils/logger');

const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true, trim: true });

/**
 * Kategori adına göre KDV oranı döndür (2026 güncel oranlar)
 * %10: giyim, ayakkabı, terlik, çanta, bavul
 * %1:  temel gıda
 * %20: diğer her şey (elektronik, kozmetik, mobilya, vb.)
 */
const getTaxRateByCategory = (categoryPath = '') => {
  const lower = categoryPath.toLowerCase();
  // %10 — giyim grubu
  if (/giyim|elbise|pantolon|gömlek|mont|ceket|kazak|tişört|t-shirt|ayakkabı|bot|sneaker|terlik|sandalet|çanta|bavul|çorap|iç çamaşır|sütyen|külot/.test(lower)) {
    return 10;
  }
  // %1 — temel gıda
  if (/gıda|bakliyat|tahıl|un|ekmek|pirinç|makarna/.test(lower)) {
    return 1;
  }
  // %20 — varsayılan
  return 20;
};

/**
 * XML'deki varyantları (beden/renk/vb.) ayrıştırır.
 * Desteklenen formatlar:
 *  1. item.options.option  → { name: "Beden", values: { value: "S" | ["S","M","L"] } }
 *  2. item.variants.variant → { name: "Kırmızı / XL", stock: 5 }
 *  3. item.option1, item.option2, ... → "Beden:S,M,L"  "Renk:Kırmızı"
 */
const parseVariants = (item) => {
  const variants = [];

  // Format 1: <options><option name="Beden"><values><value>S</value>...</values></option></options>
  if (item.options?.option) {
    const options = Array.isArray(item.options.option) ? item.options.option : [item.options.option];
    for (const opt of options) {
      const optName = opt.name || opt._ || 'Seçenek';
      // values.value tek string veya dizi olabilir
      let vals = opt.values?.value || opt.value || [];
      if (!Array.isArray(vals)) vals = [vals];
      for (const val of vals) {
        const v = typeof val === 'object' ? (val._ || val.name || JSON.stringify(val)) : String(val);
        if (v) variants.push({ name: `${optName}: ${v}`, stock: 99, isActive: true });
      }
    }
    if (variants.length > 0) return variants;
  }

  // Format 2 (xmltedarik.com): <variants><variant><name1>Beden</name1><value1>M</value1><name2>Renk</name2><value2>Kırmızı</value2><quantity>100</quantity></variant></variants>
  if (item.variants?.variant) {
    const variantList = Array.isArray(item.variants.variant) ? item.variants.variant : [item.variants.variant];
    for (const v of variantList) {
      const vStock = parseInt(v.quantity || v.stock || 99);

      // name1/value1 birincil varyant (ör: Beden: M)
      if (v.name1 && v.value1) {
        let label = `${v.name1}: ${v.value1}`;
        // name2/value2 ikincil varyant varsa birleştir (ör: Renk: Kırmızı)
        if (v.name2 && v.value2) label += ` / ${v.name2}: ${v.value2}`;
        variants.push({ name: label, stock: vStock, isActive: true });
      } else {
        // Fallback: optionName/optionValue veya name/value
        const optName  = v.optionName || v.name  || 'Seçenek';
        const optValue = v.optionValue || v.value || v._ || null;
        if (optValue) variants.push({ name: `${optName}: ${optValue}`, stock: vStock, isActive: true });
      }
    }
    if (variants.length > 0) return variants;
  }

  // Format 3: option1="Beden:S,M,L" option2="Renk:Kırmızı,Beyaz"
  for (let i = 1; i <= 5; i++) {
    const raw = item[`option${i}`] || item[`varyant${i}`];
    if (!raw) continue;
    const [label, valueStr] = String(raw).split(':');
    if (!valueStr) continue;
    const vals = valueStr.split(',').map(s => s.trim()).filter(Boolean);
    for (const val of vals) {
      variants.push({ name: `${label.trim()}: ${val}`, stock: 99, isActive: true });
    }
  }

  return variants;
};

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
    // Feed URL'sinden host al (Referer için)
    let feedHost = 'https://www.xmltedarik.com';
    try { feedHost = new URL(feed.url).origin; } catch {}

    const response = await axios.get(feed.url, {
      timeout: 120000,
      responseType: 'text',
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'Referer': feedHost,
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

        // XML'de tax varsa onu kullan (0.2 → %20), yoksa kategoriye göre hesapla
        const xmlTax = item.tax ? Math.round(parseFloat(item.tax) * 100) : null;
        const taxRate = xmlTax || getTaxRateByCategory(categoryPath);

        const existing = await prisma.product.findFirst({
          where: { externalId, supplierId: feed.supplierId },
        });

        // ── Varyantları parse et ────────────────────────────────────
        // xmltedarik.com formatı: item.options.option (tek veya dizi)
        // Her option: { name: "Beden", values: { value: "S" | ["S","M","L"] } }
        // veya item.variants.variant formatı
        const parsedVariants = parseVariants(item);

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
              taxRate,
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

          // Varyantları güncelle
          if (parsedVariants.length > 0) {
            await prisma.productVariant.deleteMany({ where: { productId: existing.id } });
            await prisma.productVariant.createMany({
              data: parsedVariants.map(v => ({ productId: existing.id, ...v })),
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
              taxRate,
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

          // Varyantları kaydet
          if (parsedVariants.length > 0) {
            await prisma.productVariant.createMany({
              data: parsedVariants.map(v => ({ productId: newProduct.id, ...v })),
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
