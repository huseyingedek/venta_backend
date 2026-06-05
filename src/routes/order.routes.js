const router = require('express').Router();
const prisma = require('../config/prisma');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { sendSms, smsTemplates } = require('../utils/sms');
const { sendOrderConfirmationEmail, sendShippingEmail } = require('../utils/email');

const generateOrderNumber = () => `VP${Date.now()}${Math.floor(Math.random() * 1000)}`;

// GET /api/v1/orders
router.get('/', authenticate, async (req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      where: { userId: req.user.id },
      include: { items: { include: { product: { select: { name: true, thumbnail: true } } } }, address: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: orders });
  } catch (err) { next(err); }
});

// GET /api/v1/orders/:id
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: { items: { include: { product: true } }, address: true },
    });
    if (!order) return res.status(404).json({ success: false, message: 'Sipariş bulunamadı.' });
    res.json({ success: true, data: order });
  } catch (err) { next(err); }
});

// POST /api/v1/orders
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { addressId, paymentMethod = 'CREDIT_CARD', notes } = req.body;

    // E-posta doğrulama kontrolü
    const currentUser = await prisma.user.findUnique({ where: { id: req.user.id }, select: { emailVerified: true } });
    if (!currentUser?.emailVerified) {
      return res.status(403).json({ success: false, message: 'Sipariş vermek için e-posta adresinizi doğrulamanız gerekiyor.', code: 'EMAIL_NOT_VERIFIED' });
    }

    const cart = await prisma.cart.findUnique({
      where: { userId: req.user.id },
      include: { items: { include: { product: true } } },
    });

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ success: false, message: 'Sepet boş.' });
    }

    let subtotal = 0;
    const orderItems = cart.items.map(item => {
      const price = Number(item.product.price);
      subtotal += price * item.quantity;
      return {
        productId: item.productId,
        variantId: item.variantId,
        productName: item.product.name,
        productSku: item.product.sku,
        quantity: item.quantity,
        unitPrice: price,
        total: price * item.quantity,
      };
    });

    const taxRate = 0.18;
    const tax = subtotal * taxRate;
    const shippingCost = subtotal >= 500 ? 0 : 29.99;
    const total = subtotal + tax + shippingCost;

    const order = await prisma.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        userId: req.user.id,
        addressId,
        paymentMethod,
        notes,
        subtotal,
        tax,
        shippingCost,
        total,
        items: { create: orderItems },
      },
      include: { items: true, address: true },
    });

    // Sepeti temizle
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });

    // Bildirimler (async — cevabı bekletmez)
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { firstName: true, lastName: true, email: true, phone: true },
    });

    if (user) {
      // SMS
      if (user.phone) {
        sendSms(user.phone, smsTemplates.orderConfirmed(order.orderNumber, total)).catch(() => {});
      }
      // E-posta
      sendOrderConfirmationEmail({
        to: user.email,
        firstName: user.firstName,
        orderNumber: order.orderNumber,
        items: orderItems,
        total,
        shippingCost,
        tax,
      }).catch(() => {});
    }

    res.status(201).json({ success: true, data: order });
  } catch (err) { next(err); }
});

// PATCH /api/v1/orders/:id/status (Admin)
router.patch('/:id/status', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { status, cargoTrackingNo, cargoCompany } = req.body;

    const order = await prisma.order.update({
      where: { id: req.params.id },
      data: { status, cargoTrackingNo, cargoCompany },
      include: { user: { select: { firstName: true, email: true, phone: true } } },
    });

    // Kargo bildirimi
    if (status === 'SHIPPED' && order.user) {
      if (order.user.phone) {
        sendSms(order.user.phone, smsTemplates.orderShipped(order.orderNumber, cargoCompany, cargoTrackingNo)).catch(() => {});
      }
      sendShippingEmail({
        to: order.user.email,
        firstName: order.user.firstName,
        orderNumber: order.orderNumber,
        cargoCompany,
        cargoTrackingNo,
      }).catch(() => {});
    }

    // Teslim bildirimi
    if (status === 'DELIVERED' && order.user?.phone) {
      sendSms(order.user.phone, smsTemplates.orderDelivered(order.orderNumber)).catch(() => {});
    }

    res.json({ success: true, data: order });
  } catch (err) { next(err); }
});

module.exports = router;
