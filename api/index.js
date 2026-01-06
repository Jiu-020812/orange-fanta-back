import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

import itemsBatchHandler from "./migrate/items-batch.js";
import recordsBatchHandler from "./migrate/records-batch.js";
import meRouter from "../routes/me.js";

const app = express();
const prisma = new PrismaClient();

/* ================= ENV ================= */
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-key";
const allowedOrigins = [
  "https://orange-fanta-one.vercel.app",
  "http://localhost:5173",
  "http://localhost:5175",
];

/* ================= UTILS ================= */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function normRecordType(t) {
  const v = String(t ?? "").trim().toUpperCase();
  if (v === "IN" || v === "OUT" || v === "PURCHASE") return v;
  return null;
}

function normalizeRecordInput(body) {
  const type = normRecordType(body?.type);
  if (!type) throw new Error("Invalid record type");

  const countNum = Number(body?.count);
  if (!Number.isFinite(countNum) || countNum <= 0) {
    throw new Error("count must be positive");
  }
  const count = Math.floor(countNum);

  const rawPrice = body?.price;
  const price =
    rawPrice === null || rawPrice === undefined || rawPrice === ""
      ? null
      : Number(rawPrice);

  if (type === "IN") {
    if (price !== null) throw new Error("IN cannot have price");
    return { type, count, price: null };
  }

  if (type === "PURCHASE") {
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error("PURCHASE requires price");
    }
    return { type, count, price: Math.floor(price) };
  }

  if (price === null) return { type, count, price: null };
  if (!Number.isFinite(price) || price < 0) throw new Error("Invalid price");
  return { type, count, price: Math.floor(price) };
}

/* ================= CORS ================= */
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS"
  );
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(cookieParser());
app.use(express.json({ limit: "20mb" }));

app.use("/api/me", meRouter);
app.use("/api/migrate/items-batch", itemsBatchHandler);
app.use("/api/migrate/records-batch", recordsBatchHandler);

/* ================= AUTH ================= */
function createToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
}
function getTokenFromReq(req) {
  return (
    req.cookies?.token ||
    (req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : null)
  );
}
function requireAuth(req, res, next) {
  const token = getTokenFromReq(req);
  if (!token) return res.status(401).json({ ok: false });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ ok: false });
  }
}

/* ================= RECORD CALC ================= */
function calcStockAndPending(records) {
  let stock = 0;
  let inSum = 0;
  let purchaseSum = 0;

  for (const r of records) {
    const c = r.count ?? 0;
    if (r.type === "IN") {
      stock += c;
      inSum += c;
    } else if (r.type === "OUT") {
      stock -= c;
    } else if (r.type === "PURCHASE") {
      purchaseSum += c;
    }
  }

  return {
    stock,
    pendingIn: Math.max(0, purchaseSum - inSum),
  };
}

/* ================= ITEMS DETAIL ================= */
app.get(
  "/api/items/:itemId/records",
  requireAuth,
  asyncHandler(async (req, res) => {
    const itemId = Number(req.params.itemId);
    if (!Number.isFinite(itemId) || itemId <= 0)
      return res.status(400).json({ ok: false });

    const item = await prisma.item.findFirst({
      where: { id: itemId, userId: req.userId },
      include: {
        records: {
          orderBy: [{ date: "asc" }, { id: "asc" }],
        },
      },
    });

    if (!item) return res.status(404).json({ ok: false });

    const { stock, pendingIn } = calcStockAndPending(item.records);

    res.json({
      ok: true,
      item: {
        id: item.id,
        name: item.name,
        size: item.size,
        imageUrl: item.imageUrl,
        categoryId: item.categoryId,
      },
      records: item.records,
      stock,
      pendingIn,
    });
  })
);

/* ================= RECORD CREATE ================= */
app.post(
  "/api/items/:itemId/records",
  requireAuth,
  asyncHandler(async (req, res) => {
    const itemId = Number(req.params.itemId);
    if (!Number.isFinite(itemId) || itemId <= 0)
      return res.status(400).json({ ok: false });

    const normalized = normalizeRecordInput(req.body);

    const records = await prisma.record.findMany({
      where: { userId: req.userId, itemId },
    });

    const { stock } = calcStockAndPending(records);

    if (normalized.type === "OUT" && normalized.count > stock) {
      return res.status(400).json({
        ok: false,
        message: `재고 부족 (${stock})`,
      });
    }

    await prisma.record.create({
      data: {
        userId: req.userId,
        itemId,
        ...normalized,
        date: req.body.date ? new Date(req.body.date) : new Date(),
        memo: req.body.memo || null,
      },
    });

    const after = await prisma.record.findMany({
      where: { userId: req.userId, itemId },
    });

    const result = calcStockAndPending(after);

    res.status(201).json({ ok: true, ...result });
  })
);

/* ================= RECORD UPDATE ================= */
app.put(
  "/api/items/:itemId/records",
  requireAuth,
  asyncHandler(async (req, res) => {
    const itemId = Number(req.params.itemId);
    const id = Number(req.body.id);
    if (!itemId || !id) return res.status(400).json({ ok: false });

    const existing = await prisma.record.findFirst({
      where: { id, itemId, userId: req.userId },
    });
    if (!existing) return res.status(404).json({ ok: false });

    const merged = {
      type: req.body.type ?? existing.type,
      count: req.body.count ?? existing.count,
      price: req.body.price !== undefined ? req.body.price : existing.price,
    };

    const normalized = normalizeRecordInput(merged);

    const others = await prisma.record.findMany({
      where: { userId: req.userId, itemId, NOT: { id } },
    });

    const { stock } = calcStockAndPending(others);

    if (normalized.type === "OUT" && normalized.count > stock) {
      return res.status(400).json({ ok: false, message: "재고 부족" });
    }

    await prisma.record.update({
      where: { id },
      data: {
        ...normalized,
        ...(req.body.date ? { date: new Date(req.body.date) } : {}),
        ...(req.body.memo !== undefined ? { memo: req.body.memo } : {}),
      },
    });

    const after = await prisma.record.findMany({
      where: { userId: req.userId, itemId },
    });

    res.json({ ok: true, ...calcStockAndPending(after) });
  })
);

/* ================= RECORD DELETE ================= */
app.delete(
  "/api/items/:itemId/records",
  requireAuth,
  asyncHandler(async (req, res) => {
    const itemId = Number(req.params.itemId);
    const id = Number(req.query.id);
    if (!itemId || !id) return res.status(400).json({ ok: false });

    await prisma.record.delete({ where: { id } });

    const after = await prisma.record.findMany({
      where: { userId: req.userId, itemId },
    });

    res.json({ ok: true, ...calcStockAndPending(after) });
  })
);

/* ================= ERROR ================= */
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ ok: false, message: err.message });
});

export default app;
