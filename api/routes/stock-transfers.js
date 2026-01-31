import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../utils/auth.js";
import { asyncHandler } from "../../utils/constants.js";

const router = Router();

// 재고 이동 목록 조회
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const transfers = await prisma.stockTransfer.findMany({
      where: { userId: req.userId },
      include: {
        item: {
          select: { id: true, name: true, size: true, imageUrl: true },
        },
        fromWarehouse: {
          select: { id: true, name: true },
        },
        toWarehouse: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ ok: true, transfers });
  })
);

// 재고 이동 생성
router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { itemId, fromWarehouseId, toWarehouseId, quantity, reason } = req.body;

    if (!itemId || !fromWarehouseId || !toWarehouseId || !quantity) {
      return res.status(400).json({
        ok: false,
        error: "품목, 출발 창고, 도착 창고, 수량은 필수입니다.",
      });
    }

    if (fromWarehouseId === toWarehouseId) {
      return res.status(400).json({
        ok: false,
        error: "출발 창고와 도착 창고는 달라야 합니다.",
      });
    }

    if (quantity <= 0) {
      return res.status(400).json({
        ok: false,
        error: "수량은 0보다 커야 합니다.",
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
    const [fromWarehouse, toWarehouse] = await Promise.all([
      prisma.warehouse.findFirst({
        where: { id: fromWarehouseId, userId: req.userId },
      }),
      prisma.warehouse.findFirst({
        where: { id: toWarehouseId, userId: req.userId },
      }),
    ]);

    if (!fromWarehouse || !toWarehouse) {
      return res.status(404).json({ ok: false, error: "창고를 찾을 수 없습니다." });
    }

    const transfer = await prisma.stockTransfer.create({
      data: {
        userId: req.userId,
        itemId,
        fromWarehouseId,
        toWarehouseId,
        quantity,
        reason: reason?.trim(),
        status: "COMPLETED",
      },
      include: {
        item: {
          select: { id: true, name: true, size: true, imageUrl: true },
        },
        fromWarehouse: {
          select: { id: true, name: true },
        },
        toWarehouse: {
          select: { id: true, name: true },
        },
      },
    });

    res.json({ ok: true, transfer });
  })
);

// 품목별 재고 이동 이력 조회
router.get(
  "/item/:itemId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const itemId = parseInt(req.params.itemId, 10);

    const transfers = await prisma.stockTransfer.findMany({
      where: { itemId, userId: req.userId },
      include: {
        fromWarehouse: {
          select: { id: true, name: true },
        },
        toWarehouse: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ ok: true, transfers });
  })
);

export default router;
