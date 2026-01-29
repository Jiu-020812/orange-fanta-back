import express from "express";

const PROVIDERS = new Set(["NAVER", "COUPANG", "ELEVENST", "KREAM", "ETC"]);

export default function createIntegrationsRouter({ prisma, requireAuth, asyncHandler }) {
  const router = express.Router();

  // GET /api/integrations
  router.get(
    "/",
    requireAuth,
    asyncHandler(async (req, res) => {
      const connections = await prisma.channelConnection.findMany({
        where: { userId: req.userId },
        orderBy: [{ provider: "asc" }],
      });
      res.json({ ok: true, connections });
    })
  );

  // POST /api/integrations
  router.post(
    "/",
    requireAuth,
    asyncHandler(async (req, res) => {
      const provider = String(req.body?.provider || "").toUpperCase();
      if (!PROVIDERS.has(provider)) {
        return res.status(400).json({ ok: false, message: "provider invalid" });
      }

      const credentials = req.body?.credentials;
      if (!credentials || typeof credentials !== "object") {
        return res.status(400).json({ ok: false, message: "credentials required" });
      }

      const isActive = req.body?.isActive !== undefined ? Boolean(req.body.isActive) : true;

      const connection = await prisma.channelConnection.upsert({
        where: {
          userId_provider: {
            userId: req.userId,
            provider,
          },
        },
        create: {
          userId: req.userId,
          provider,
          credentials,
          isActive,
        },
        update: {
          credentials,
          isActive,
        },
      });

      res.json({ ok: true, connection });
    })
  );

  // DELETE /api/integrations/:provider
  router.delete(
    "/:provider",
    requireAuth,
    asyncHandler(async (req, res) => {
      const provider = String(req.params.provider || "").toUpperCase();
      if (!PROVIDERS.has(provider)) {
        return res.status(400).json({ ok: false, message: "provider invalid" });
      }

      await prisma.channelConnection.delete({
        where: {
          userId_provider: {
            userId: req.userId,
            provider,
          },
        },
      });

      res.status(204).end();
    })
  );

  return router;
}
