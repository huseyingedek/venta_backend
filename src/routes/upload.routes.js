const router = require('express').Router();
const multer = require('multer');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { uploadToCloudinary } = require('../utils/cloudinary');

// Diske değil memory'e al — Cloudinary'e stream edeceğiz
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Sadece JPEG, PNG ve WebP dosyaları kabul edilir.'), false);
  },
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 },
});

// POST /api/v1/upload/product-image
router.post('/product-image',
  authenticate,
  authorize('ADMIN', 'SUPER_ADMIN'),
  (req, res, next) => upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });
    next();
  }),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'Dosya alınamadı. Lütfen JPEG, PNG veya WebP gönderin.' });
      }
      const { url, publicId } = await uploadToCloudinary(req.file.buffer);
      res.json({ success: true, data: { url, publicId } });
    } catch (err) {
      res.status(500).json({ success: false, message: `Cloudinary hatası: ${err.message}` });
    }
  }
);

// POST /api/v1/upload/product-images (çoklu)
router.post('/product-images',
  authenticate,
  authorize('ADMIN', 'SUPER_ADMIN'),
  upload.array('images', 10),
  async (req, res, next) => {
    try {
      if (!req.files?.length) return res.status(400).json({ success: false, message: 'Dosya yüklenemedi.' });
      const results = await Promise.all(
        req.files.map(f => uploadToCloudinary(f.buffer))
      );
      res.json({ success: true, data: results });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
