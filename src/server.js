require('dotenv').config(); // EN BAŞTA OLMALI — process.env'i diğer require'lardan önce yükler

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const path = require('path');

const { logger } = require('./utils/logger');
const { initCronJobs, cleanupTokens } = require('./services/cron.service');

// Routes
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const productRoutes = require('./routes/product.routes');
const categoryRoutes = require('./routes/category.routes');
const orderRoutes = require('./routes/order.routes');
const cartRoutes = require('./routes/cart.routes');
const supplierRoutes = require('./routes/supplier.routes');
const uploadRoutes = require('./routes/upload.routes');
const paymentRoutes = require('./routes/payment.routes');
const adminRoutes = require('./routes/admin.routes');
const homepageRoutes = require('./routes/homepage.routes');

const app = express();

// Security
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// CORS
const allowedOrigins = [
  'http://localhost:3000',
  'http://cud2v4q6o5tb22yimtcoldav.94.130.109.190.sslip.io/api/v1',
  'https://ventapremium.com.tr',
  'https://www.ventapremium.com.tr',
  process.env.CLIENT_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Postman / server-to-server (origin yok)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: ${origin} izin verilmiyor.`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting

// Body parsing
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));
}

// Static files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString(), service: 'Venta Premium API' });
});

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/categories', categoryRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/cart', cartRoutes);
app.use('/api/v1/suppliers', supplierRoutes);
app.use('/api/v1/upload', uploadRoutes);
app.use('/api/v1/payment', paymentRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/homepage', homepageRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint bulunamadı.' });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error(err.stack);
  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    success: false,
    message: err.message || 'Sunucu hatası oluştu.',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  logger.info(`🚀 Venta Premium API çalışıyor: http://localhost:${PORT}`);
  logger.info(`📦 Ortam: ${process.env.NODE_ENV}`);

  // Cron job'ları başlat
  await initCronJobs();
  cleanupTokens();
});

module.exports = app;
