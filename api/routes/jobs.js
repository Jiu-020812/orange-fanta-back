import express from "express";
import { runInventorySyncJobs } from "../services/inventorySync.js";

export default function createJobsRouter({ prisma, requireAuth, asyncHandler }) {
  const router = express.Router();

  // POST /api/jobs/inventory-sync/run
  router.post(
    "/inventory-sync/run",
    requireAuth,
    asyncHandler(async (req, res) => {
      const limit = Number(req.body?.limit ?? 20);
      const result = await runInventorySyncJobs({
        prisma,
        userId: req.userId,
        limit: Number.isFinite(limit) ? limit : 20,
      });
      res.json({ ok: true, ...result });
    })
  );

  return router;
}
