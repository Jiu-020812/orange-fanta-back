import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";

import itemsBatchHandler from "./migrate/items-batch.js";
import recordsBatchHandler from "./migrate/records-batch.js";
import meRouter from "../routes/me.js";
import createAuthRouter from "./routes/auth.js";
import createCategoriesRouter from "./routes/categories.js";
import createItemsRouter from "./routes/items.js";
import createRecordsRouter from "./routes/records.js";
import createAdminRouter from "./routes/admin.js";
import {
  normalizeRecordInput,
  toYmd,
  calcStockAndPending,
  calcStock,
} from "./utils/records.js";
import { requireAuth } from "../utils/auth.js";
import { allowedOrigins, asyncHandler } from "../utils/constants.js";

const app = express();

/* ================= CORS ================= */
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/* ================= COMMON ================= */
app.use(cookieParser());
app.use(express.json({ limit: "20mb" }));

/* ================= HELLO ================= */
app.get("/", (req, res) => {
  res.json({ ok: true, message: "Backend running" });
});

/* ================= AUTH ================= */
app.use("/api/auth", createAuthRouter({ asyncHandler }));

/* ================= USER ================= */
app.use("/api/me", meRouter);

/* ================= MIGRATE ================= */
app.use("/api/migrate/items-batch", itemsBatchHandler);
app.use("/api/migrate/records-batch", recordsBatchHandler);

/* ================= RESOURCES ================= */
app.use(
  "/api/categories",
  createCategoriesRouter({
    prisma,
    requireAuth,
    asyncHandler,
  })
);

app.use(
  "/api/items",
  createItemsRouter({
    prisma,
    requireAuth,
    asyncHandler,
    normalizeRecordInput,
    calcStock,
    calcStockAndPending,
  })
);

app.use(
  "/api",
  createRecordsRouter({
    prisma,
    requireAuth,
    asyncHandler,
    toYmd,
    calcStockAndPending,
  })
);

app.use(
  "/api/admin",
  createAdminRouter({
    prisma,
    requireAuth,
    asyncHandler,
  })
);

/* ================= USER DELETION ================= */
app.delete(
  "/api/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId;
    const password = String(req.body?.password ?? "");

    if (!password) {
      return res.status(400).json({ ok: false, message: "password required" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true },
    });

    if (!user)
      return res.status(404).json({ ok: false, message: "user not found" });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res
        .status(401)
        .json({ ok: false, message: "비밀번호가 올바르지 않습니다." });
    }

    await prisma.$transaction(async (tx) => {
      await tx.record.deleteMany({ where: { userId } });
      await tx.item.deleteMany({ where: { userId } });
      await tx.category.deleteMany({ where: { userId } });
      await tx.user.delete({ where: { id: userId } });
    });

    res.clearCookie("token", { path: "/", secure: true, sameSite: "none" });
    res.json({ ok: true });
  })
);

/* ================= ERROR ================= */
app.use((err, req, res, next) => {
  console.error("ERROR:", err);
  res.status(500).json({
    ok: false,
    message: "server error",
    error: String(err?.message || err),
  });
});

export default app;
