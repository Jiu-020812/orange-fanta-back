import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../utils/auth.js";
import { asyncHandler } from "../../utils/constants.js";

const router = Router();

// 재고 실사 목록 조회
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const audits = await prisma.stockAudit.findMany({
      where: { userId: req.userId },
      include: {
        item: {
          select: { id: true, name: true, size: true, imageUrl: true },
        },
        warehouse: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ ok: true, audits });
  })
);

// 재고 실사 생성
router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { itemId, warehouseId, expectedQuantity, actualQuantity, notes } =
      req.body;

    if (
      itemId == null ||
      warehouseId == null ||
      expectedQuantity == null ||
      actualQuantity == null
    ) {
      return res.status(400).json({
        ok: false,
        error: "품목, 창고, 예상 수량, 실제 수량은 필수입니다.",
      });
    }

    if (expectedQuantity < 0 || actualQuantity < 0) {
      return res.status(400).json({
        ok: false,
        error: "수량은 0 이상이어야 합니다.",
      });
    }

    // 품목 확인
    const item = await prisma.item.findFirst({
      where: { id: itemId, userId: req.userId },
    });

    if (!item) {
      return res.status(404).json({ ok: false, error: "품목을 찾을 수 없습니다." });
    }

    // 창고 확인
    const warehouse = await prisma.warehouse.findFirst({
      where: { id: warehouseId, userId: req.userId },
    });

    if (!warehouse) {
      return res.status(404).json({ ok: false, error: "창고를 찾을 수 없습니다." });
    }

    const difference = actualQuantity - expectedQuantity;

    const audit = await prisma.stockAudit.create({
      data: {
        userId: req.userId,
        itemId,
        warehouseId,
        expectedQuantity,
        actualQuantity,
        difference,
        notes: notes?.trim(),
      },
      include: {
        item: {
          select: { id: true, name: true, size: true, imageUrl: true },
        },
        warehouse: {
          select: { id: true, name: true },
        },
      },
    });

    res.json({ ok: true, audit });
  })
);

// 창고별 재고 실사 이력 조회
router.get(
  "/warehouse/:warehouseId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const warehouseId = parseInt(req.params.warehouseId, 10);

    const audits = await prisma.stockAudit.findMany({
      where: { warehouseId, userId: req.userId },
      include: {
        item: {
          select: { id: true, name: true, size: true, imageUrl: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ ok: true, audits });
  })
);

// 품목별 재고 실사 이력 조회
router.get(
  "/item/:itemId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const itemId = parseInt(req.params.itemId, 10);

    const audits = await prisma.stockAudit.findMany({
      where: { itemId, userId: req.userId },
      include: {
        warehouse: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ ok: true, audits });
  })
);

export default router;
