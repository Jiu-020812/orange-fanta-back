import express from "express";
import { generateUniqueSku } from "../../utils/sku.js";

export default function createAdminRouter({ prisma, requireAuth, asyncHandler }) {
  const router = express.Router();

  // POST /api/admin/backfill-sku
  router.post(
    "/backfill-sku",
    requireAuth,
    asyncHandler(async (req, res) => {
      const items = await prisma.item.findMany({
        where: { userId: req.userId, sku: null },
        select: { id: true },
      });

      let updated = 0;
      for (const item of items) {
        const sku = await generateUniqueSku({ prisma, userId: req.userId });
        await prisma.item.update({
          where: { id: item.id },
          data: { sku },
        });
        updated += 1;
      }

      res.json({ ok: true, updated });
    })
  );

  return router;
}
