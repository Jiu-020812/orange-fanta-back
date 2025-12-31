import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({ select: { id: true } });

  for (const u of users) {
    // 유저별 카테고리 생성 (없으면 만들고, 있으면 유지)
    const shoe = await prisma.category.upsert({
      where: { userId_name: { userId: u.id, name: "신발" } },
      update: {},
      create: { userId: u.id, name: "신발", sortOrder: 1 },
    });

    const food = await prisma.category.upsert({
      where: { userId_name: { userId: u.id, name: "음식" } },
      update: {},
      create: { userId: u.id, name: "음식", sortOrder: 2 },
    });

    const uncategorized = await prisma.category.upsert({
      where: { userId_name: { userId: u.id, name: "미분류" } },
      update: {},
      create: { userId: u.id, name: "미분류", sortOrder: 0 },
    });

    // 기존 enum(SHOE/FOOD) → categoryId 채우기
    await prisma.item.updateMany({
      where: { userId: u.id, category: "SHOE" },
      data: { categoryId: shoe.id },
    });

    await prisma.item.updateMany({
      where: { userId: u.id, category: "FOOD" },
      data: { categoryId: food.id },
    });

    // 혹시 남은 건 미분류로
    await prisma.item.updateMany({
      where: { userId: u.id, categoryId: null },
      data: { categoryId: uncategorized.id },
    });
  }

  console.log("categoryId 데이터 이관 완료");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error("❌ 데이터 이관 실패:", e);
    prisma.$disconnect();
    process.exit(1);
  });
