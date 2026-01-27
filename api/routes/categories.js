import express from "express";

export default function createCategoriesRouter({ prisma, requireAuth, asyncHandler }) {
  const router = express.Router();

  // GET /api/categories
  router.get(
    "/",
    requireAuth,
    asyncHandler(async (req, res) => {
      const categories = await prisma.category.findMany({
        where: { userId: req.userId },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      });
      res.json(categories);
    })
  );

  // POST /api/categories { name, sortOrder? }
  router.post(
    "/",
    requireAuth,
    asyncHandler(async (req, res) => {
      const name = String(req.body?.name ?? "").trim();
      const sortOrderRaw = req.body?.sortOrder;

      if (!name) {
        return res.status(400).json({ ok: false, message: "name required" });
      }

      const dup = await prisma.category.findFirst({
        where: { userId: req.userId, name },
        select: { id: true },
      });
      if (dup) {
        return res.status(409).json({ ok: false, message: "duplicate name" });
      }

      let sortOrder = Number(sortOrderRaw);
      if (sortOrderRaw == null || !Number.isFinite(sortOrder)) {
        const last = await prisma.category.findFirst({
          where: { userId: req.userId },
          orderBy: [{ sortOrder: "desc" }, { id: "desc" }],
          select: { sortOrder: true },
        });
        sortOrder = (last?.sortOrder ?? 0) + 1;
      }

      const created = await prisma.category.create({
        data: { userId: req.userId, name, sortOrder },
      });

      res.status(201).json(created);
    })
  );

  // PATCH /api/categories/:id { name?, sortOrder? }
  router.patch(
    "/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ ok: false, message: "invalid id" });
      }

      const existing = await prisma.category.findFirst({
        where: { id, userId: req.userId },
        select: { id: true },
      });
      if (!existing) return res.status(404).json({ ok: false });

      const data = {};

      if (req.body?.name !== undefined) {
        const name = String(req.body.name ?? "").trim();
        if (!name) {
          return res.status(400).json({ ok: false, message: "name required" });
        }
        const dup = await prisma.category.findFirst({
          where: { userId: req.userId, name, NOT: { id } },
          select: { id: true },
        });
        if (dup) return res.status(409).json({ ok: false, message: "duplicate name" });
        data.name = name;
      }

      if (req.body?.sortOrder !== undefined) {
        const so = Number(req.body.sortOrder);
        if (!Number.isFinite(so)) {
          return res.status(400).json({ ok: false, message: "sortOrder invalid" });
        }
        data.sortOrder = so;
      }

      const updated = await prisma.category.update({ where: { id }, data });
      res.json(updated);
    })
  );

  // DELETE /api/categories/:id  (삭제 시 해당 아이템은 "미분류"로 이동)
  router.delete(
    "/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ ok: false, message: "invalid id" });
      }

      const target = await prisma.category.findFirst({
        where: { id, userId: req.userId },
        select: { id: true, name: true },
      });
      if (!target) return res.status(404).json({ ok: false });

      // "미분류" 확보
      const uncategorized =
        (await prisma.category.findFirst({
          where: { userId: req.userId, name: "미분류" },
          select: { id: true },
        })) ||
        (await prisma.category.create({
          data: { userId: req.userId, name: "미분류", sortOrder: 0 },
          select: { id: true },
        }));

      if (uncategorized.id === id) {
        return res.status(400).json({ ok: false, message: "미분류는 삭제할 수 없습니다." });
      }

      await prisma.item.updateMany({
        where: { userId: req.userId, categoryId: id },
        data: { categoryId: uncategorized.id },
      });

      await prisma.category.delete({ where: { id } });
      res.status(204).end();
    })
  );

  return router;
}
