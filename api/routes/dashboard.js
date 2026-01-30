import { Router } from "express";

export default function createDashboardRouter({
  prisma,
  requireAuth,
  asyncHandler,
  calcStock,
}) {
  const router = Router();

  // GET /api/dashboard/stats
  router.get(
    "/stats",
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = req.userId;
      const lowStockThreshold = Number(req.query.lowStockThreshold) || 10;

      // 전체 품목 수
      const totalItems = await prisma.item.count({
        where: { userId },
      });

      // 모든 품목과 레코드를 가져와서 재고 계산
      const items = await prisma.item.findMany({
        where: { userId },
        select: {
          id: true,
          records: {
            select: {
              type: true,
              count: true,
            },
          },
        },
      });

      // 재고 부족 품목 수 계산
      let lowStockItems = 0;
      for (const item of items) {
        const stock = calcStock(item.records);
        if (stock <= lowStockThreshold) {
          lowStockItems++;
        }
      }

      // 최근 7일 입고/출고 건수
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const recentInCount = await prisma.record.count({
        where: {
          userId,
          type: "IN",
          date: {
            gte: sevenDaysAgo,
          },
        },
      });

      const recentOutCount = await prisma.record.count({
        where: {
          userId,
          type: "OUT",
          date: {
            gte: sevenDaysAgo,
          },
        },
      });

      res.json({
        ok: true,
        totalItems,
        lowStockItems,
        recentInCount,
        recentOutCount,
      });
    })
  );

  return router;
}
