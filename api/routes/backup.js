import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../utils/auth.js";
import { asyncHandler } from "../../utils/constants.js";

const router = Router();

// 전체 데이터 백업 (Export)
router.get(
  "/export",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId;

    // 모든 데이터 조회
    const [categories, items, records, warehouses, stockTransfers, stockAudits] =
      await Promise.all([
        prisma.category.findMany({ where: { userId } }),
        prisma.item.findMany({ where: { userId } }),
        prisma.record.findMany({ where: { userId } }),
        prisma.warehouse.findMany({ where: { userId } }),
        prisma.stockTransfer.findMany({ where: { userId } }),
        prisma.stockAudit.findMany({ where: { userId } }),
      ]);

    const backup = {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      userId,
      data: {
        categories,
        items,
        records,
        warehouses,
        stockTransfers,
        stockAudits,
      },
    };

    res.json({ ok: true, backup });
  })
);

// 데이터 복원 (Import)
router.post(
  "/import",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId;
    const { backup, mode = "merge" } = req.body; // mode: 'merge' or 'replace'

    if (!backup || !backup.data) {
      return res.status(400).json({
        ok: false,
        error: "유효하지 않은 백업 데이터입니다.",
      });
    }

    const { categories, items, records, warehouses, stockTransfers, stockAudits } =
      backup.data;

    try {
      await prisma.$transaction(async (tx) => {
        // Replace 모드: 기존 데이터 삭제
        if (mode === "replace") {
          await tx.stockAudit.deleteMany({ where: { userId } });
          await tx.stockTransfer.deleteMany({ where: { userId } });
          await tx.record.deleteMany({ where: { userId } });
          await tx.item.deleteMany({ where: { userId } });
          await tx.warehouse.deleteMany({ where: { userId } });
          await tx.category.deleteMany({ where: { userId } });
        }

        // 카테고리 복원
        if (categories && categories.length > 0) {
          for (const cat of categories) {
            await tx.category.upsert({
              where: {
                userId_name: {
                  userId,
                  name: cat.name,
                },
              },
              create: {
                userId,
                name: cat.name,
                sortOrder: cat.sortOrder || 0,
              },
              update: {
                sortOrder: cat.sortOrder || 0,
              },
            });
          }
        }

        // 창고 복원
        if (warehouses && warehouses.length > 0) {
          for (const warehouse of warehouses) {
            await tx.warehouse.upsert({
              where: {
                userId_name: {
                  userId,
                  name: warehouse.name,
                },
              },
              create: {
                userId,
                name: warehouse.name,
                location: warehouse.location,
                description: warehouse.description,
              },
              update: {
                location: warehouse.location,
                description: warehouse.description,
              },
            });
          }
        }

        // 품목 복원 (카테고리 매핑 필요)
        if (items && items.length > 0) {
          const categoryMap = {};
          const allCategories = await tx.category.findMany({ where: { userId } });
          allCategories.forEach((cat) => {
            categoryMap[cat.name] = cat.id;
          });

          for (const item of items) {
            const originalCategory = categories?.find((c) => c.id === item.categoryId);
            const newCategoryId = originalCategory
              ? categoryMap[originalCategory.name]
              : null;

            if (!newCategoryId) continue;

            await tx.item.create({
              data: {
                userId,
                name: item.name,
                size: item.size,
                imageUrl: item.imageUrl,
                sku: item.sku,
                barcode: item.barcode,
                memo: item.memo,
                lowStockAlert: item.lowStockAlert || false,
                lowStockThreshold: item.lowStockThreshold || 10,
                categoryId: newCategoryId,
              },
            });
          }
        }

        // 입출고 기록 복원
        if (records && records.length > 0) {
          const itemMap = {};
          const allItems = await tx.item.findMany({ where: { userId } });
          allItems.forEach((item) => {
            itemMap[`${item.name}_${item.size}`] = item.id;
          });

          for (const record of records) {
            const originalItem = items?.find((i) => i.id === record.itemId);
            const newItemId = originalItem
              ? itemMap[`${originalItem.name}_${originalItem.size}`]
              : null;

            if (!newItemId) continue;

            await tx.record.create({
              data: {
                userId,
                itemId: newItemId,
                type: record.type,
                price: record.price,
                count: record.count,
                date: new Date(record.date),
                memo: record.memo,
              },
            });
          }
        }

        // 재고 이동 복원
        if (stockTransfers && stockTransfers.length > 0) {
          const itemMap = {};
          const warehouseMap = {};
          const allItems = await tx.item.findMany({ where: { userId } });
          const allWarehouses = await tx.warehouse.findMany({ where: { userId } });

          allItems.forEach((item) => {
            itemMap[`${item.name}_${item.size}`] = item.id;
          });
          allWarehouses.forEach((wh) => {
            warehouseMap[wh.name] = wh.id;
          });

          for (const transfer of stockTransfers) {
            const originalItem = items?.find((i) => i.id === transfer.itemId);
            const originalFromWh = warehouses?.find(
              (w) => w.id === transfer.fromWarehouseId
            );
            const originalToWh = warehouses?.find(
              (w) => w.id === transfer.toWarehouseId
            );

            const newItemId = originalItem
              ? itemMap[`${originalItem.name}_${originalItem.size}`]
              : null;
            const newFromWhId = originalFromWh
              ? warehouseMap[originalFromWh.name]
              : null;
            const newToWhId = originalToWh ? warehouseMap[originalToWh.name] : null;

            if (!newItemId || !newFromWhId || !newToWhId) continue;

            await tx.stockTransfer.create({
              data: {
                userId,
                itemId: newItemId,
                fromWarehouseId: newFromWhId,
                toWarehouseId: newToWhId,
                quantity: transfer.quantity,
                reason: transfer.reason,
                status: transfer.status || "COMPLETED",
              },
            });
          }
        }

        // 재고 실사 복원
        if (stockAudits && stockAudits.length > 0) {
          const itemMap = {};
          const warehouseMap = {};
          const allItems = await tx.item.findMany({ where: { userId } });
          const allWarehouses = await tx.warehouse.findMany({ where: { userId } });

          allItems.forEach((item) => {
            itemMap[`${item.name}_${item.size}`] = item.id;
          });
          allWarehouses.forEach((wh) => {
            warehouseMap[wh.name] = wh.id;
          });

          for (const audit of stockAudits) {
            const originalItem = items?.find((i) => i.id === audit.itemId);
            const originalWh = warehouses?.find((w) => w.id === audit.warehouseId);

            const newItemId = originalItem
              ? itemMap[`${originalItem.name}_${originalItem.size}`]
              : null;
            const newWhId = originalWh ? warehouseMap[originalWh.name] : null;

            if (!newItemId || !newWhId) continue;

            await tx.stockAudit.create({
              data: {
                userId,
                itemId: newItemId,
                warehouseId: newWhId,
                expectedQuantity: audit.expectedQuantity,
                actualQuantity: audit.actualQuantity,
                difference: audit.difference,
                notes: audit.notes,
              },
            });
          }
        }
      });

      res.json({
        ok: true,
        message: "데이터 복원이 완료되었습니다.",
      });
    } catch (error) {
      console.error("Import error:", error);
      res.status(500).json({
        ok: false,
        error: "데이터 복원 중 오류가 발생했습니다.",
        details: error.message,
      });
    }
  })
);

export default router;
