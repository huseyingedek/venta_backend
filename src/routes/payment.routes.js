const router = require('express').Router();
const Iyzipay = require('iyzipay');
const prisma = require('../config/prisma');
const { authenticate } = require('../middleware/auth.middleware');

// Lazy init — .env yüklendikten sonra kullanılır
const getIyzipay = () => new Iyzipay({
  apiKey: process.env.IYZICO_API_KEY || '',
  secretKey: process.env.IYZICO_SECRET_KEY || '',
  uri: process.env.IYZICO_BASE_URL || 'https://sandbox-api.iyzipay.com',
});

// POST /api/v1/payment/initiate
router.post('/initiate', authenticate, async (req, res, next) => {
  try {
    const { orderId, cardNumber, cardHolderName, expireMonth, expireYear, cvc, installment = 1 } = req.body;

    const order = await prisma.order.findFirst({
      where: { id: orderId, userId: req.user.id },
      include: { items: { include: { product: true } }, address: true, user: true },
    });

    if (!order) return res.status(404).json({ success: false, message: 'Sipariş bulunamadı.' });

    const request = {
      locale: Iyzipay.LOCALE.TR,
      conversationId: order.orderNumber,
      price: order.subtotal.toString(),
      paidPrice: order.total.toString(),
      currency: Iyzipay.CURRENCY.TRY,
      installment,
      basketId: order.orderNumber,
      paymentChannel: Iyzipay.PAYMENT_CHANNEL.WEB,
      paymentGroup: Iyzipay.PAYMENT_GROUP.PRODUCT,
      paymentCard: { cardHolderName, cardNumber, expireMonth, expireYear, cvc, registerCard: '0' },
      buyer: {
        id: order.userId,
        name: order.user.firstName,
        surname: order.user.lastName,
        email: order.user.email,
        identityNumber: '11111111111',
        registrationAddress: order.address.fullAddress,
        ip: req.ip,
        city: order.address.city,
        country: 'Turkey',
      },
      shippingAddress: {
        contactName: `${order.address.firstName} ${order.address.lastName}`,
        city: order.address.city,
        country: 'Turkey',
        address: order.address.fullAddress,
      },
      billingAddress: {
        contactName: `${order.address.firstName} ${order.address.lastName}`,
        city: order.address.city,
        country: 'Turkey',
        address: order.address.fullAddress,
      },
      basketItems: order.items.map(item => ({
        id: item.productId,
        name: item.productName,
        category1: 'Genel',
        itemType: Iyzipay.BASKET_ITEM_TYPE.PHYSICAL,
        price: (Number(item.unitPrice) * item.quantity).toFixed(2).toString(),
      })),
    };

    const iyzipay = getIyzipay();
    iyzipay.payment.create(request, async (err, result) => {
      if (err || result.status !== 'success') {
        await prisma.order.update({
          where: { id: orderId },
          data: { status: 'PAYMENT_FAILED', paymentStatus: 'failed' },
        });
        return res.status(400).json({ success: false, message: result?.errorMessage || 'Ödeme başarısız.' });
      }

      await prisma.order.update({
        where: { id: orderId },
        data: {
          status: 'CONFIRMED',
          paymentStatus: 'paid',
          iyzicoPaymentId: result.paymentId,
        },
      });

      res.json({ success: true, message: 'Ödeme başarılı.', data: { paymentId: result.paymentId } });
    });
  } catch (err) { next(err); }
});

module.exports = router;
