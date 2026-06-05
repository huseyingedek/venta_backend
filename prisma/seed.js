const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seed başladı...');

  // Admin kullanıcı
  const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'Admin123!', 12);
  const admin = await prisma.user.upsert({
    where: { email: process.env.ADMIN_EMAIL || 'admin@ventapremium.com' },
    update: {},
    create: {
      email: process.env.ADMIN_EMAIL || 'admin@ventapremium.com',
      password: hashedPassword,
      firstName: 'Venta',
      lastName: 'Admin',
      role: 'SUPER_ADMIN',
      isActive: true,
      emailVerified: true,
    },
  });
  console.log('✅ Admin oluşturuldu:', admin.email);

  // Ana kategoriler
  const categories = [
    { name: 'Elektronik', slug: 'elektronik', sortOrder: 1 },
    { name: 'Giyim & Moda', slug: 'giyim-moda', sortOrder: 2 },
    { name: 'Ev & Yaşam', slug: 'ev-yasam', sortOrder: 3 },
    { name: 'Spor & Outdoor', slug: 'spor-outdoor', sortOrder: 4 },
    { name: 'Kozmetik & Kişisel Bakım', slug: 'kozmetik-kisisel-bakim', sortOrder: 5 },
    { name: 'Kitap & Müzik & Film', slug: 'kitap-muzik-film', sortOrder: 6 },
    { name: 'Oyuncak & Hobi', slug: 'oyuncak-hobi', sortOrder: 7 },
    { name: 'Otomotiv', slug: 'otomotiv', sortOrder: 8 },
  ];

  for (const cat of categories) {
    await prisma.category.upsert({
      where: { slug: cat.slug },
      update: {},
      create: cat,
    });
  }
  console.log(`✅ ${categories.length} kategori oluşturuldu.`);

  console.log('🎉 Seed tamamlandı!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
