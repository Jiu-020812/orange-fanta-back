import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../utils/auth.js";
import { asyncHandler } from "../../utils/constants.js";

const router = Router();

// 창고 목록 조회
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const warehouses = await prisma.warehouse.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: "desc" },
    });

    res.json({ ok: true, warehouses });
  })
);

// 창고 생성
router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { name, location, description } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ ok: false, error: "창고 이름은 필수입니다." });
    }

    const warehouse = await prisma.warehouse.create({
      data: {
        userId: req.userId,
        name: name.trim(),
        location: location?.trim(),
        description: description?.trim(),
      },
    });

    res.json({ ok: true, warehouse });
  })
);

// 창고 상세 조회
router.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);

    const warehouse = await prisma.warehouse.findFirst({
      where: { id, userId: req.userId },
    });

    if (!warehouse) {
      return res.status(404).json({ ok: false, error: "창고를 찾을 수 없습니다." });
    }

    res.json({ ok: true, warehouse });
  })
);

// 창고 수정
router.put(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { name, location, description } = req.body;

    const existing = await prisma.warehouse.findFirst({
      where: { id, userId: req.userId },
    });

    if (!existing) {
      return res.status(404).json({ ok: false, error: "창고를 찾을 수 없습니다." });
    }

    if (!name?.trim()) {
      return res.status(400).json({ ok: false, error: "창고 이름은 필수입니다." });
    }

    const warehouse = await prisma.warehouse.update({
      where: { id },
      data: {
        name: name.trim(),
        location: location?.trim(),
        description: description?.trim(),
      },
    });

    res.json({ ok: true, warehouse });
  })
);

// 창고 삭제
router.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);

    const existing = await prisma.warehouse.findFirst({
      where: { id, userId: req.userId },
    });

    if (!existing) {
      return res.status(404).json({ ok: false, error: "창고를 찾을 수 없습니다." });
    }

    // 재고 이동이나 실사 기록이 있는지 확인
    const hasTransfers = await prisma.stockTransfer.count({
      where: {
        OR: [{ fromWarehouseId: id }, { toWarehouseId: id }],
      },
    });

    const hasAudits = await prisma.stockAudit.count({
      where: { warehouseId: id },
    });

    if (hasTransfers > 0 || hasAudits > 0) {
      return res.status(400).json({
        ok: false,
        error: "재고 이동 또는 실사 기록이 있는 창고는 삭제할 수 없습니다.",
      });
    }

    await prisma.warehouse.delete({ where: { id } });

    res.json({ ok: true });
  })
);

export default router;
