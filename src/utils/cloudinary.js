let cloudinaryLib = null;

const getCloudinary = () => {
  if (!cloudinaryLib) {
    try {
      cloudinaryLib = require('cloudinary').v2;
      cloudinaryLib.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
      });
    } catch (e) {
      throw new Error('Cloudinary paketi kurulu değil. "npm install" çalıştırın.');
    }
  }
  return cloudinaryLib;
};

const uploadToCloudinary = (buffer, folder = 'venta-premium/products') => {
  return new Promise((resolve, reject) => {
    const cloudinary = getCloudinary();
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        transformation: [
          { quality: 'auto', fetch_format: 'auto' },
          { width: 1200, height: 1200, crop: 'limit' },
        ],
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    stream.end(buffer);
  });
};

const deleteFromCloudinary = async (publicId) => {
  if (!publicId) return;
  try {
    const cloudinary = getCloudinary();
    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    console.error('Cloudinary silme hatası:', err.message);
  }
};

module.exports = { uploadToCloudinary, deleteFromCloudinary };
