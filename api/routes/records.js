import express from "express";

export default function createRecordsRouter({
  prisma,
  requireAuth,
  asyncHandler,
  toYmd,
  calcStockAndPending,
}) {
  const router = express.Router();

  /* ================= PURCHASE ARRIVE ================= */
  /**
   *  구매(PURCHASE) 기준 "입고 처리" API
   *
   * POST /api/purchases/:purchaseId/arrive
   * body: { count?: number, date?: "YYYY-MM-DD", memo?: string }
   *
   * - count 없으면: 남은 수량 전부(=일괄입고)
   * - count 있으면: 그만큼만(=부분입고)
   * - IN record 생성(type=IN, price=null, purchaseId=해당 구매 id)
   */
  router.post(
    "/purchases/:purchaseId/arrive",
    requireAuth,
    asyncHandler(async (req, res) => {
      const purchaseId = Number(req.params.purchaseId);
      if (!Number.isFinite(purchaseId) || purchaseId <= 0) {
        return res.status(400).json({ ok: false, message: "invalid purchaseId" });
      }

      const purchase = await prisma.record.findFirst({
        where: { id: purchaseId, userId: req.userId },
        select: { id: true, type: true, itemId: true, count: true, date: true },
      });
      if (!purchase) return res.status(404).json({ ok: false, message: "purchase not found" });
      if (String(purchase.type).toUpperCase() !== "PURCHASE") {
        return res.status(400).json({ ok: false, message: "record is not PURCHASE" });
      }

      // 이미 이 PURCHASE로 입고된 수량 합
      const arrived = await prisma.record.aggregate({
        where: { userId: req.userId, itemId: purchase.itemId, type: "IN", purchaseId },
        _sum: { count: true },
      });
      const arrivedSum = arrived?._sum?.count ?? 0;
      const remaining = Math.max(0, (purchase.count ?? 0) - arrivedSum);

      if (remaining <= 0) {
        return res.json({ ok: true, message: "already fully arrived", remaining: 0 });
      }

      const reqCountRaw = req.body?.count;
      const reqCountNum = reqCountRaw === "" || reqCountRaw == null ? null : Number(reqCountRaw);

      const count =
        reqCountNum == null
          ? remaining // 일괄입고
          : Math.max(1, Math.min(remaining, Math.floor(reqCountNum))); // 부분입고

      const dateStr = req.body?.date;
      const dateOnly = toYmd(dateStr) || toYmd(new Date());
      const date = new Date(dateOnly + "T00:00:00");

      const memo =
        req.body?.memo != null && String(req.body.memo).trim() !== ""
          ? String(req.body.memo)
          : null;

      const createdIn = await prisma.record.create({
        data: {
          userId: req.userId,
          itemId: purchase.itemId,
          type: "IN",
          price: null,
          count,
          date,
          memo,
          purchaseId,
        },
        select: {
          id: true,
          itemId: true,
          type: true,
          price: true,
          count: true,
          date: true,
          memo: true,
          purchaseId: true,
        },
      });

      // 디테일 다시 계산해서 돌려줌(프론트 편하게)
      const detail = await prisma.record.findMany({
        where: { userId: req.userId, itemId: purchase.itemId },
        orderBy: [{ date: "asc" }, { id: "asc" }],
        select: {
          id: true,
          itemId: true,
          type: true,
          price: true,
          count: true,
          date: true,
          memo: true,
          purchaseId: true,
        },
      });

      const { stock, pendingIn } = calcStockAndPending(detail);

      const arrived2 = await prisma.record.aggregate({
        where: { userId: req.userId, itemId: purchase.itemId, type: "IN", purchaseId },
        _sum: { count: true },
      });
      const arrivedSum2 = arrived2?._sum?.count ?? 0;
      const remaining2 = Math.max(0, (purchase.count ?? 0) - arrivedSum2);

      res.status(201).json({
        ok: true,
        inRecord: createdIn,
        remaining: remaining2,
        stock,
        pendingIn,
        records: detail,
      });
    })
  );

  /* ================= RECORDS LIST (입출고 페이지용) ================= */
  // GET /api/records?type=IN|OUT|PURCHASE&priceMissing=1
  router.get(
    "/records",
    requireAuth,
    asyncHandler(async (req, res) => {
      const type = String(req.query.type || "").toUpperCase();
      const priceMissing = String(req.query.priceMissing || "") === "1";

      const where = { userId: req.userId };

      if (type === "IN" || type === "OUT" || type === "PURCHASE") {
        where.type = type;
      }

      if (priceMissing) {
        where.price = null;
      }

      const records = await prisma.record.findMany({
        where,
        orderBy: [{ date: "desc" }, { id: "desc" }],
        include: {
          item: {
            select: { id: true, name: true, size: true, imageUrl: true, categoryId: true, barcode: true },
          },
        },
      });

      res.json({ ok: true, records });
    })
  );

  return router;
}
