const router = require('express').Router();
const prisma = require('../config/prisma');
const { authenticate } = require('../middleware/auth.middleware');

const getOrCreateCart = async (userId) => {
  let cart = await prisma.cart.findUnique({ where: { userId }, include: { items: { include: { product: { select: { id: true, name: true, price: true, thumbnail: true, stock: true, status: true } } } } } });
  if (!cart) cart = await prisma.cart.create({ data: { userId }, include: { items: { include: { product: true } } } });
  return cart;
};

// GET /api/v1/cart
router.get('/', authenticate, async (req, res, next) => {
  try {
    const cart = await getOrCreateCart(req.user.id);
    res.json({ success: true, data: cart });
  } catch (err) { next(err); }
});

// POST /api/v1/cart/items
router.post('/items', authenticate, async (req, res, next) => {
  try {
    const { productId, quantity = 1, variantId } = req.body;
    const cart = await getOrCreateCart(req.user.id);

    const existing = await prisma.cartItem.findFirst({ where: { cartId: cart.id, productId, variantId: variantId || null } });
    if (existing) {
      await prisma.cartItem.update({ where: { id: existing.id }, data: { quantity: existing.quantity + quantity } });
    } else {
      await prisma.cartItem.create({ data: { cartId: cart.id, productId, quantity, variantId: variantId || null } });
    }

    const updated = await getOrCreateCart(req.user.id);
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});

// PUT /api/v1/cart/items/:id
router.put('/items/:id', authenticate, async (req, res, next) => {
  try {
    const item = await prisma.cartItem.findFirst({
      where: { id: req.params.id, cart: { userId: req.user.id } },
    });
    if (!item) return res.status(404).json({ success: false, message: 'Sepet öğesi bulunamadı.' });

    const { quantity } = req.body;
    if (quantity <= 0) {
      await prisma.cartItem.delete({ where: { id: req.params.id } });
    } else {
      await prisma.cartItem.update({ where: { id: req.params.id }, data: { quantity } });
    }
    const cart = await getOrCreateCart(req.user.id);
    res.json({ success: true, data: cart });
  } catch (err) { next(err); }
});

// DELETE /api/v1/cart/items/:id
router.delete('/items/:id', authenticate, async (req, res, next) => {
  try {
    const item = await prisma.cartItem.findFirst({
      where: { id: req.params.id, cart: { userId: req.user.id } },
    });
    if (!item) return res.status(404).json({ success: false, message: 'Sepet öğesi bulunamadı.' });

    await prisma.cartItem.delete({ where: { id: req.params.id } });
    const cart = await getOrCreateCart(req.user.id);
    res.json({ success: true, data: cart });
  } catch (err) { next(err); }
});

// DELETE /api/v1/cart
router.delete('/', authenticate, async (req, res, next) => {
  try {
    const cart = await prisma.cart.findUnique({ where: { userId: req.user.id } });
    if (cart) await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    res.json({ success: true, message: 'Sepet temizlendi.' });
  } catch (err) { next(err); }
});

module.exports = router;
