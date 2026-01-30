import express from "express";
import { generateUniqueSku } from "../../utils/sku.js";
import {
  computeTargetQuantities,
  enqueueInventorySync,
  getCentralStock,
} from "../services/inventorySync.js";

const PROVIDERS = new Set(["NAVER", "COUPANG", "ELEVENST", "ETC"]);

export default function createItemsRouter({
  prisma,
  requireAuth,
  asyncHandler,
  normalizeRecordInput,
  calcStock,
  calcStockAndPending,
}) {
  const router = express.Router();

  // categoryId 필터 적용
  // GET /api/items?categoryId=123
  router.get(
    "/",
    requireAuth,
    asyncHandler(async (req, res) => {
      const categoryIdRaw = req.query.categoryId;
      const categoryId = categoryIdRaw ? Number(categoryIdRaw) : null;

      const where = { userId: req.userId };
      if (categoryId && Number.isFinite(categoryId)) {
        where.categoryId = categoryId;
      }

      const items = await prisma.item.findMany({
        where,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });

      res.json(items);
    })
  );

  // GET /api/items/lookup?barcode=xxxxx
  router.get(
    "/lookup",
    requireAuth,
    asyncHandler(async (req, res) => {
      const barcode = String(req.query.barcode || "").trim();
      if (!barcode) return res.status(400).json({ ok: false, message: "barcode required" });

      const item = await prisma.item.findFirst({
        where: { userId: req.userId, barcode },
        select: {
          id: true,
          name: true,
          size: true,
          imageUrl: true,
          barcode: true,
          sku: true,
          categoryId: true,
        },
      });

      if (!item) return res.json({ ok: false, message: "NOT_FOUND" });

      res.json({
        ok: true,
        item: {
          itemId: item.id,
          name: item.name,
          size: item.size,
          imageUrl: item.imageUrl,
          barcode: item.barcode,
          categoryId: item.categoryId,
          sku: item.sku,
        },
      });
    })
  );

  // POST /api/items  body: { name, size, categoryId, imageUrl?, barcode?, sku? }
  router.post(
    "/",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { name, size, categoryId, imageUrl, barcode, sku } = req.body;

      const n = String(name ?? "").trim();
      const s = String(size ?? "").trim();
      const cid = Number(categoryId);

      const bc = barcode && String(barcode).trim() !== "" ? String(barcode).trim() : null;
      const skuTrimmed = sku == null ? "" : String(sku).trim();

      if (!n || !s) {
        return res.status(400).json({ ok: false, message: "name/size required" });
      }
      if (!Number.isFinite(cid) || cid <= 0) {
        return res.status(400).json({ ok: false, message: "categoryId required" });
      }

      // categoryId가 내 것인지 검증
      const cat = await prisma.category.findFirst({
        where: { id: cid, userId: req.userId },
        select: { id: true },
      });
      if (!cat) {
        return res.status(400).json({ ok: false, message: "invalid categoryId" });
      }

      // barcode 중복 체크(있을 때만)
      if (bc) {
        const dup = await prisma.item.findFirst({
          where: { userId: req.userId, barcode: bc },
          select: { id: true },
        });
        if (dup) {
          return res.status(409).json({ ok: false, message: "이미 등록된 바코드입니다." });
        }
      }

      let skuValue = null;
      if (skuTrimmed) {
        const dup = await prisma.item.findFirst({
          where: { userId: req.userId, sku: skuTrimmed },
          select: { id: true },
        });
        if (dup) {
          return res.status(409).json({ ok: false, message: "이미 등록된 SKU입니다." });
        }
        skuValue = skuTrimmed;
      } else {
        skuValue = await generateUniqueSku({ prisma, userId: req.userId });
      }

      const created = await prisma.item.create({
        data: {
          userId: req.userId,
          name: n,
          size: s,
          categoryId: cid,
          imageUrl: imageUrl || null,
          barcode: bc,
          sku: skuValue,
        },
      });

      res.status(201).json(created);
    })
  );

  // PUT /api/items/:id
  router.put(
    "/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ ok: false, message: "invalid id" });
      }

      const existing = await prisma.item.findFirst({
        where: { id, userId: req.userId },
        select: { id: true },
      });
      if (!existing) return res.status(404).json({ ok: false, message: "item not found" });

      const { name, size, imageUrl, memo, categoryId, barcode, sku } = req.body;

      // barcode 정리
      const bc =
        barcode === undefined
          ? undefined
          : barcode === null
          ? null
          : String(barcode).trim() === ""
          ? null
          : String(barcode).trim();

      if (bc !== undefined && bc !== null) {
        const dup = await prisma.item.findFirst({
          where: { userId: req.userId, barcode: bc, NOT: { id } },
          select: { id: true },
        });
        if (dup) {
          return res.status(409).json({ ok: false, message: "이미 등록된 바코드입니다." });
        }
      }

      const hasSku = Object.prototype.hasOwnProperty.call(req.body, "sku");
      let nextSku = undefined;
      if (hasSku) {
        const trimmed = sku == null ? "" : String(sku).trim();
        if (!trimmed) {
          nextSku = await generateUniqueSku({ prisma, userId: req.userId });
        } else {
          nextSku = trimmed;
        }

        const dup = await prisma.item.findFirst({
          where: { userId: req.userId, sku: nextSku, NOT: { id } },
          select: { id: true },
        });
        if (dup) {
          return res.status(409).json({ ok: false, message: "이미 등록된 SKU입니다." });
        }
      }

      let nextCategoryId = undefined;
      if (categoryId !== undefined) {
        const cid = Number(categoryId);
        if (!Number.isFinite(cid) || cid <= 0) {
          return res.status(400).json({ ok: false, message: "categoryId invalid" });
        }
        const cat = await prisma.category.findFirst({
          where: { id: cid, userId: req.userId },
          select: { id: true },
        });
        if (!cat) return res.status(400).json({ ok: false, message: "invalid categoryId" });
        nextCategoryId = cid;
      }

      const updated = await prisma.item.update({
        where: { id },
        data: {
          ...(name !== undefined ? { name: String(name) } : {}),
          ...(size !== undefined ? { size: String(size) } : {}),
          ...(imageUrl !== undefined ? { imageUrl } : {}),
          ...(memo !== undefined ? { memo } : {}),
          ...(nextCategoryId !== undefined ? { categoryId: nextCategoryId } : {}),
          ...(bc !== undefined ? { barcode: bc } : {}),
          ...(nextSku !== undefined ? { sku: nextSku } : {}),
        },
      });

      res.json(updated);
    })
  );

  // DELETE /api/items/:id (해당 item records도 삭제)
  router.delete(
    "/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ ok: false, message: "invalid id" });
      }

      const existing = await prisma.item.findFirst({
        where: { id, userId: req.userId },
        select: { id: true },
      });
      if (!existing) return res.status(404).json({ ok: false, message: "item not found" });

      await prisma.record.deleteMany({ where: { userId: req.userId, itemId: id } });
      await prisma.item.delete({ where: { id } });

      res.status(204).end();
    })
  );

  // PUT /api/items/:itemId/policy
  router.put(
    "/:itemId/policy",
    requireAuth,
    asyncHandler(async (req, res) => {
      const itemId = Number(req.params.itemId);
      if (!Number.isFinite(itemId) || itemId <= 0) {
        return res.status(400).json({ ok: false, message: "invalid itemId" });
      }

      const item = await prisma.item.findFirst({
        where: { id: itemId, userId: req.userId },
        select: { id: true },
      });
      if (!item) return res.status(404).json({ ok: false, message: "item not found" });

      const mode = req.body?.mode === "EXCLUSIVE" ? "EXCLUSIVE" : "NORMAL";
      const buffer = Number.isFinite(Number(req.body?.buffer)) ? Number(req.body.buffer) : undefined;
      const minVisible = Number.isFinite(Number(req.body?.minVisible))
        ? Number(req.body.minVisible)
        : undefined;
      const exclusiveProvider = req.body?.exclusiveProvider || null;

      const policy = await prisma.itemInventoryPolicy.upsert({
        where: { itemId },
        create: {
          userId: req.userId,
          itemId,
          mode,
          ...(buffer !== undefined ? { buffer } : {}),
          ...(minVisible !== undefined ? { minVisible } : {}),
          ...(exclusiveProvider ? { exclusiveProvider } : {}),
        },
        update: {
          mode,
          ...(buffer !== undefined ? { buffer } : {}),
          ...(minVisible !== undefined ? { minVisible } : {}),
          exclusiveProvider: exclusiveProvider || null,
        },
      });

      res.json({ ok: true, policy });
    })
  );

  // POST /api/items/:itemId/listings
  router.post(
    "/:itemId/listings",
    requireAuth,
    asyncHandler(async (req, res) => {
      const itemId = Number(req.params.itemId);
      if (!Number.isFinite(itemId) || itemId <= 0) {
        return res.status(400).json({ ok: false, message: "invalid itemId" });
      }

      const item = await prisma.item.findFirst({
        where: { id: itemId, userId: req.userId },
        select: { id: true },
      });
      if (!item) return res.status(404).json({ ok: false, message: "item not found" });

      const provider = String(req.body?.provider || "").toUpperCase();
      if (!provider) {
        return res.status(400).json({ ok: false, message: "provider required" });
      }
      if (!PROVIDERS.has(provider)) {
        return res.status(400).json({ ok: false, message: "provider invalid" });
      }

      const listing = await prisma.channelListing.upsert({
        where: {
          userId_provider_itemId: {
            userId: req.userId,
            provider,
            itemId,
          },
        },
        create: {
          userId: req.userId,
          provider,
          itemId,
          channelProductId: req.body?.channelProductId ?? null,
          channelOptionId: req.body?.channelOptionId ?? null,
          externalSku: req.body?.externalSku ?? null,
          isActive: req.body?.isActive !== undefined ? Boolean(req.body.isActive) : true,
        },
        update: {
          channelProductId: req.body?.channelProductId ?? null,
          channelOptionId: req.body?.channelOptionId ?? null,
          externalSku: req.body?.externalSku ?? null,
          isActive: req.body?.isActive !== undefined ? Boolean(req.body.isActive) : true,
        },
      });

      res.json({ ok: true, listing });
    })
  );

  // POST /api/items/:itemId/sync-inventory
  router.post(
    "/:itemId/sync-inventory",
    requireAuth,
    asyncHandler(async (req, res) => {
      const itemId = Number(req.params.itemId);
      if (!Number.isFinite(itemId) || itemId <= 0) {
        return res.status(400).json({ ok: false, message: "invalid itemId" });
      }

      const item = await prisma.item.findFirst({
        where: { id: itemId, userId: req.userId },
        select: { id: true },
      });
      if (!item) return res.status(404).json({ ok: false, message: "item not found" });

      const targets = await computeTargetQuantities({
        prisma,
        userId: req.userId,
        itemId,
      });
      const centralStock = await getCentralStock({
        prisma,
        userId: req.userId,
        itemId,
      });
      const { enqueued } = await enqueueInventorySync({
        prisma,
        userId: req.userId,
        itemId,
        targets,
      });

      res.json({ ok: true, centralStock, targets, enqueued });
    })
  );

  /* ================= DETAIL (디테일 페이지) ================= */
  // GET /api/items/:itemId/records
  router.get(
    "/:itemId/records",
    requireAuth,
    asyncHandler(async (req, res) => {
      const itemId = Number(req.params.itemId);
      if (!Number.isFinite(itemId) || itemId <= 0) {
        return res.status(400).json({ ok: false, message: "invalid itemId" });
      }

      const item = await prisma.item.findFirst({
        where: { id: itemId, userId: req.userId },
        select: {
          id: true,
          name: true,
          size: true,
          imageUrl: true,
          categoryId: true,
          sku: true,
          barcode: true,
          records: {
            where: { userId: req.userId },
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
          },
        },
      });

      if (!item) return res.status(404).json({ ok: false, message: "item not found" });

      const { stock, pendingIn } = calcStockAndPending(item.records);

      res.json({
        ok: true,
        item: {
          id: item.id,
          name: item.name,
          size: item.size,
          imageUrl: item.imageUrl,
          categoryId: item.categoryId,
          sku: item.sku,
          barcode: item.barcode,
        },
        records: item.records,
        stock,
        pendingIn,
      });
    })
  );

  /* ================= RECORDS (디테일 CRUD) ================= */
  // POST /api/items/:itemId/records
  router.post(
    "/:itemId/records",
    requireAuth,
    asyncHandler(async (req, res) => {
      const itemId = Number(req.params.itemId);
      if (!Number.isFinite(itemId) || itemId <= 0) {
        return res.status(400).json({ ok: false, message: "invalid itemId" });
      }

      const item = await prisma.item.findFirst({
        where: { id: itemId, userId: req.userId },
        select: { id: true },
      });
      if (!item) return res.status(404).json({ ok: false, message: "item not found" });

      let normalized;
      try {
        normalized = normalizeRecordInput(req.body);
      } catch (e) {
        return res.status(400).json({ ok: false, message: String(e?.message || e) });
      }

      // OUT 재고 부족 체크
      if (normalized.type === "OUT") {
        const stockNow = await calcStock(prisma, req.userId, itemId);
        if (normalized.count > stockNow) {
          return res.status(400).json({
            ok: false,
            message: `재고 부족: 현재 재고(${stockNow})보다 많이 판매할 수 없습니다.`,
            stock: stockNow,
          });
        }
      }

      const { date, memo } = req.body;

      //  일반 create로 IN을 만들 때 purchaseId는 받지 않음(실수 방지)
      // 입고처리는 /api/purchases/:purchaseId/arrive 로만 처리하는게 안전
      const created = await prisma.record.create({
        data: {
          userId: req.userId,
          itemId,
          type: normalized.type,
          price: normalized.price,
          count: normalized.count,
          date: date ? new Date(date) : new Date(),
          memo: memo != null && String(memo).trim() !== "" ? String(memo) : null,
          purchaseId: null,
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

      const detail = await prisma.record.findMany({
        where: { userId: req.userId, itemId },
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
      res.status(201).json({ ok: true, record: created, stock, pendingIn, records: detail });
    })
  );

  // PUT /api/items/:itemId/records
  router.put(
    "/:itemId/records",
    requireAuth,
    asyncHandler(async (req, res) => {
      const itemId = Number(req.params.itemId);
      const id = Number(req.body?.id);

      if (!Number.isFinite(itemId) || itemId <= 0) {
        return res.status(400).json({ ok: false, message: "invalid itemId" });
      }
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ ok: false, message: "invalid record id" });
      }

      const existing = await prisma.record.findFirst({
        where: { id, itemId, userId: req.userId },
        select: { id: true, type: true, count: true, price: true, date: true, memo: true, purchaseId: true },
      });
      if (!existing) return res.status(404).json({ ok: false, message: "record not found" });

      const mergedBody = {
        type: req.body.type != null ? req.body.type : existing.type,
        count: req.body.count != null ? req.body.count : existing.count,
        price: req.body.price !== undefined ? req.body.price : existing.price,
      };

      let normalized;
      try {
        normalized = normalizeRecordInput(mergedBody);
      } catch (e) {
        return res.status(400).json({ ok: false, message: String(e?.message || e) });
      }

      // OUT 업데이트 재고 체크
      if (normalized.type === "OUT") {
        const stockNow = await calcStock(prisma, req.userId, itemId);
        const stockExcludingThis =
          String(existing.type).toUpperCase() === "OUT" ? stockNow + existing.count : stockNow;

        if (normalized.count > stockExcludingThis) {
          return res.status(400).json({
            ok: false,
            message: `재고 부족: 현재 재고(${stockExcludingThis})보다 많이 판매할 수 없습니다.`,
            stock: stockExcludingThis,
          });
        }
      }

      const nextPurchaseId = existing.purchaseId;

      const { date, memo } = req.body;

      const updated = await prisma.record.update({
        where: { id },
        data: {
          type: normalized.type,
          count: normalized.count,
          price: normalized.price,
          ...(date ? { date: new Date(date) } : {}),
          ...(memo !== undefined ? { memo: memo ? String(memo) : null } : {}),
          purchaseId: nextPurchaseId,
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

      const detail = await prisma.record.findMany({
        where: { userId: req.userId, itemId },
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
      res.json({ ok: true, record: updated, stock, pendingIn, records: detail });
    })
  );

  // DELETE /api/items/:itemId/records?id=123
  router.delete(
    "/:itemId/records",
    requireAuth,
    asyncHandler(async (req, res) => {
      const itemId = Number(req.params.itemId);
      const id = Number(req.query?.id);

      if (!Number.isFinite(itemId) || itemId <= 0) {
        return res.status(400).json({ ok: false, message: "invalid itemId" });
      }
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ ok: false, message: "invalid record id" });
      }

      const existing = await prisma.record.findFirst({
        where: { id, itemId, userId: req.userId },
        select: { id: true },
      });
      if (!existing) return res.status(404).json({ ok: false, message: "record not found" });

      await prisma.record.delete({ where: { id } });

      const detail = await prisma.record.findMany({
        where: { userId: req.userId, itemId },
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
      res.json({ ok: true, stock, pendingIn, records: detail });
    })
  );

  // PATCH /api/items/:itemId/low-stock-alert
  router.patch(
    "/:itemId/low-stock-alert",
    requireAuth,
    asyncHandler(async (req, res) => {
      const itemId = Number(req.params.itemId);
      if (!Number.isFinite(itemId) || itemId <= 0) {
        return res.status(400).json({ ok: false, message: "invalid itemId" });
      }

      const item = await prisma.item.findFirst({
        where: { id: itemId, userId: req.userId },
        select: { id: true },
      });
      if (!item) return res.status(404).json({ ok: false, message: "item not found" });

      const lowStockAlert = req.body.lowStockAlert === true;
      const lowStockThreshold = Number.isFinite(Number(req.body.lowStockThreshold))
        ? Number(req.body.lowStockThreshold)
        : undefined;

      const updated = await prisma.item.update({
        where: { id: itemId },
        data: {
          lowStockAlert,
          ...(lowStockThreshold !== undefined ? { lowStockThreshold } : {}),
        },
        select: {
          id: true,
          lowStockAlert: true,
          lowStockThreshold: true,
        },
      });

      res.json({ ok: true, item: updated });
    })
  );

  return router;
}
