import { Router } from "express";

export default function createReportsRouter({
  prisma,
  requireAuth,
  asyncHandler,
  calcStock,
}) {
  const router = Router();

  // GET /api/reports/sales-analysis
  // 매출 분석 데이터 (일별 매출 및 수익)
  router.get(
    "/sales-analysis",
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = req.userId;
      const { dateRange = "7days" } = req.query;

      // 날짜 범위 계산
      const now = new Date();
      let startDate = new Date();

      switch (dateRange) {
        case "7days":
          startDate.setDate(now.getDate() - 7);
          break;
        case "30days":
          startDate.setDate(now.getDate() - 30);
          break;
        case "90days":
          startDate.setDate(now.getDate() - 90);
          break;
        case "1year":
          startDate.setFullYear(now.getFullYear() - 1);
          break;
        default:
          startDate.setDate(now.getDate() - 7);
      }

      // 출고(판매) 데이터 가져오기
      const outRecords = await prisma.record.findMany({
        where: {
          userId,
          type: "OUT",
          date: {
            gte: startDate,
          },
        },
        select: {
          date: true,
          count: true,
          price: true,
        },
        orderBy: {
          date: "asc",
        },
      });

      // 입고(매입) 데이터 가져오기
      const purchaseRecords = await prisma.record.findMany({
        where: {
          userId,
          type: "PURCHASE",
          date: {
            gte: startDate,
          },
        },
        select: {
          date: true,
          count: true,
          price: true,
        },
      });

      // 일별로 데이터 집계
      const salesByDate = {};

      outRecords.forEach((record) => {
        const dateKey = record.date.toISOString().split("T")[0];
        if (!salesByDate[dateKey]) {
          salesByDate[dateKey] = { sales: 0, cost: 0, profit: 0 };
        }
        const revenue = (record.price || 0) * Math.abs(record.count || 0);
        salesByDate[dateKey].sales += revenue;
      });

      // 비용 계산 (간단화: 매입가 기준)
      purchaseRecords.forEach((record) => {
        const dateKey = record.date.toISOString().split("T")[0];
        if (!salesByDate[dateKey]) {
          salesByDate[dateKey] = { sales: 0, cost: 0, profit: 0 };
        }
        const cost = (record.price || 0) * (record.count || 0);
        salesByDate[dateKey].cost += cost;
      });

      // 수익 = 매출 - 비용
      Object.keys(salesByDate).forEach((date) => {
        salesByDate[date].profit = salesByDate[date].sales - salesByDate[date].cost;
      });

      // 배열로 변환
      const salesAnalysis = Object.entries(salesByDate)
        .map(([date, data]) => ({
          date,
          sales: data.sales,
          profit: data.profit,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      res.json({
        ok: true,
        data: salesAnalysis,
      });
    })
  );

  // GET /api/reports/inventory-turnover
  // 재고 회전율 계산
  router.get(
    "/inventory-turnover",
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = req.userId;
      const { dateRange = "7days" } = req.query;

      const now = new Date();
      let startDate = new Date();

      switch (dateRange) {
        case "7days":
          startDate.setDate(now.getDate() - 7);
          break;
        case "30days":
          startDate.setDate(now.getDate() - 30);
          break;
        case "90days":
          startDate.setDate(now.getDate() - 90);
          break;
        case "1year":
          startDate.setFullYear(now.getFullYear() - 1);
          break;
        default:
          startDate.setDate(now.getDate() - 7);
      }

      // 모든 품목 가져오기
      const items = await prisma.item.findMany({
        where: { userId },
        select: {
          id: true,
          name: true,
          records: {
            select: {
              type: true,
              count: true,
              date: true,
            },
          },
        },
      });

      // 각 품목별 재고 회전율 계산
      const turnoverData = items.map((item) => {
        // 현재 재고
        const currentStock = calcStock(item.records);

        // 기간 내 판매량
        const soldInPeriod = item.records
          .filter((r) => r.type === "OUT" && r.date >= startDate)
          .reduce((sum, r) => sum + Math.abs(r.count || 0), 0);

        // 재고 회전율 = 판매량 / 평균 재고
        // 평균 재고를 현재 재고로 간단히 계산
        const turnover = currentStock > 0 ? (soldInPeriod / currentStock).toFixed(2) : 0;

        return {
          name: item.name,
          turnover: parseFloat(turnover),
          currentStock,
          soldInPeriod,
        };
      });

      // 회전율이 높은 순으로 정렬하여 상위 10개만
      const topTurnover = turnoverData
        .filter((item) => item.turnover > 0)
        .sort((a, b) => b.turnover - a.turnover)
        .slice(0, 10);

      res.json({
        ok: true,
        data: topTurnover,
      });
    })
  );

  // GET /api/reports/profit-analysis
  // 수익률 분석
  router.get(
    "/profit-analysis",
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = req.userId;
      const { dateRange = "7days" } = req.query;

      const now = new Date();
      let startDate = new Date();

      switch (dateRange) {
        case "7days":
          startDate.setDate(now.getDate() - 7);
          break;
        case "30days":
          startDate.setDate(now.getDate() - 30);
          break;
        case "90days":
          startDate.setDate(now.getDate() - 90);
          break;
        case "1year":
          startDate.setFullYear(now.getFullYear() - 1);
          break;
        default:
          startDate.setDate(now.getDate() - 7);
      }

      // 매출 (판매)
      const outRecords = await prisma.record.findMany({
        where: {
          userId,
          type: "OUT",
          date: { gte: startDate },
        },
        select: {
          count: true,
          price: true,
        },
      });

      const totalRevenue = outRecords.reduce((sum, r) => {
        return sum + (r.price || 0) * Math.abs(r.count || 0);
      }, 0);

      // 비용 (매입)
      const purchaseRecords = await prisma.record.findMany({
        where: {
          userId,
          type: "PURCHASE",
          date: { gte: startDate },
        },
        select: {
          count: true,
          price: true,
        },
      });

      const totalCost = purchaseRecords.reduce((sum, r) => {
        return sum + (r.price || 0) * (r.count || 0);
      }, 0);

      const totalProfit = totalRevenue - totalCost;
      const profitMargin = totalRevenue > 0
        ? ((totalProfit / totalRevenue) * 100).toFixed(2)
        : 0;

      res.json({
        ok: true,
        data: {
          totalRevenue,
          totalCost,
          totalProfit,
          profitMargin: parseFloat(profitMargin),
        },
      });
    })
  );

  // GET /api/reports/top-products
  // TOP 제품 (판매량 기준)
  router.get(
    "/top-products",
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = req.userId;
      const { dateRange = "7days" } = req.query;

      const now = new Date();
      let startDate = new Date();

      switch (dateRange) {
        case "7days":
          startDate.setDate(now.getDate() - 7);
          break;
        case "30days":
          startDate.setDate(now.getDate() - 30);
          break;
        case "90days":
          startDate.setDate(now.getDate() - 90);
          break;
        case "1year":
          startDate.setFullYear(now.getFullYear() - 1);
          break;
        default:
          startDate.setDate(now.getDate() - 7);
      }

      const outRecords = await prisma.record.findMany({
        where: {
          userId,
          type: "OUT",
          date: { gte: startDate },
        },
        include: {
          item: {
            select: {
              name: true,
            },
          },
        },
      });

      // 품목별 판매량 집계
      const salesByItem = {};
      outRecords.forEach((record) => {
        const itemName = record.item?.name || "알 수 없음";
        if (!salesByItem[itemName]) {
          salesByItem[itemName] = 0;
        }
        salesByItem[itemName] += Math.abs(record.count || 0);
      });

      // TOP 5 추출
      const topProducts = Object.entries(salesByItem)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5);

      res.json({
        ok: true,
        data: topProducts,
      });
    })
  );

  // GET /api/reports/category-breakdown
  // 카테고리별 판매 분포
  router.get(
    "/category-breakdown",
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = req.userId;
      const { dateRange = "7days" } = req.query;

      const now = new Date();
      let startDate = new Date();

      switch (dateRange) {
        case "7days":
          startDate.setDate(now.getDate() - 7);
          break;
        case "30days":
          startDate.setDate(now.getDate() - 30);
          break;
        case "90days":
          startDate.setDate(now.getDate() - 90);
          break;
        case "1year":
          startDate.setFullYear(now.getFullYear() - 1);
          break;
        default:
          startDate.setDate(now.getDate() - 7);
      }

      const outRecords = await prisma.record.findMany({
        where: {
          userId,
          type: "OUT",
          date: { gte: startDate },
        },
        include: {
          item: {
            include: {
              category: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      });

      // 카테고리별 판매량 집계
      const salesByCategory = {};
      let totalSales = 0;

      outRecords.forEach((record) => {
        const categoryName = record.item?.category?.name || "미분류";
        const quantity = Math.abs(record.count || 0);

        if (!salesByCategory[categoryName]) {
          salesByCategory[categoryName] = 0;
        }
        salesByCategory[categoryName] += quantity;
        totalSales += quantity;
      });

      // 퍼센트로 변환
      const categoryBreakdown = Object.entries(salesByCategory)
        .map(([name, count]) => ({
          name,
          value: totalSales > 0 ? ((count / totalSales) * 100).toFixed(1) : 0,
          count,
        }))
        .sort((a, b) => b.count - a.count);

      res.json({
        ok: true,
        data: categoryBreakdown.map(({ name, value }) => ({
          name,
          value: parseFloat(value),
        })),
      });
    })
  );

  return router;
}
