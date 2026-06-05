const cron = require('node-cron');
const prisma = require('../config/prisma');
const { syncXmlFeed } = require('./xml.service');
const { logger } = require('../utils/logger');

const activeTasks = new Map();

/**
 * Tüm aktif XML feed'leri için cron job'ları başlat
 */
const initCronJobs = async () => {
  logger.info('🕐 Cron servisi başlatılıyor...');

  try {
    const feeds = await prisma.xmlFeed.findMany({
      where: { isActive: true },
      include: { supplier: { select: { name: true } } },
    });

    for (const feed of feeds) {
      scheduleFeed(feed);
    }

    logger.info(`✅ ${feeds.length} XML feed için cron job başlatıldı.`);
  } catch (err) {
    logger.error('Cron başlatma hatası:', err.message);
  }
};

/**
 * Tek bir feed için cron job zamanla
 */
const scheduleFeed = (feed) => {
  // Varsa mevcut job'u durdur
  if (activeTasks.has(feed.id)) {
    activeTasks.get(feed.id).destroy();
  }

  if (!cron.validate(feed.cronSchedule)) {
    logger.warn(`Geçersiz cron ifadesi: ${feed.cronSchedule} (feed: ${feed.name})`);
    return;
  }

  const task = cron.schedule(feed.cronSchedule, async () => {
    logger.info(`⏱ Cron tetiklendi: ${feed.name} (${feed.supplier?.name})`);
    try {
      await syncXmlFeed(feed.id);
    } catch (err) {
      logger.error(`Cron sync hatası (${feed.name}): ${err.message}`);
    }
  }, {
    timezone: 'Europe/Istanbul',
  });

  activeTasks.set(feed.id, task);
  logger.info(`📅 Zamanlandı: "${feed.name}" → ${feed.cronSchedule}`);
};

/**
 * Feed'in cron'unu yeniden yükle (feed güncellendiğinde çağır)
 */
const reloadFeed = async (feedId) => {
  const feed = await prisma.xmlFeed.findUnique({
    where: { id: feedId },
    include: { supplier: { select: { name: true } } },
  });

  if (!feed || !feed.isActive) {
    // Pasif feed'in job'unu durdur
    if (activeTasks.has(feedId)) {
      activeTasks.get(feedId).destroy();
      activeTasks.delete(feedId);
      logger.info(`⏹ Cron durduruldu: ${feedId}`);
    }
    return;
  }

  scheduleFeed(feed);
};

/**
 * Temizlik: eski refresh token'ları sil (her gece 03:00)
 */
const cleanupTokens = () => {
  cron.schedule('0 3 * * *', async () => {
    try {
      const { count } = await prisma.refreshToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (count > 0) logger.info(`🧹 ${count} süresi dolmuş token temizlendi.`);
    } catch (err) {
      logger.error('Token temizleme hatası:', err.message);
    }
  }, { timezone: 'Europe/Istanbul' });
};

module.exports = { initCronJobs, scheduleFeed, reloadFeed, cleanupTokens };
