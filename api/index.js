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

const normRecordType = (t) => {
  const v = String(t ?? "").trim().toUpperCase();
  if (v === "IN" || v === "OUT" || v === "PURCHASE") return v;
  return null;
};

function normalizeRecordInput(body) {
  const type = normRecordType(body?.type);
  if (!type) throw new Error("Invalid record type");

  const count = Math.max(1, Math.abs(Number(body?.count) || 1));

  const rawPrice = body?.price;
  const price =
    rawPrice === "" || rawPrice == null ? null : Number(rawPrice);

  if (type === "IN") return { type, count, price: null };

  if (type === "PURCHASE") {
    if (!Number.isFinite(price) || price <= 0)
      throw new Error("PURCHASE requires price");
    return { type, count, price: Math.floor(price) };
  }

  if (price === null) return { type, count, price: null };
  if (!Number.isFinite(price) || price < 0)
    throw new Error("Invalid price");

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

/* ================= AUTH ================= */
const createToken = (userId) =>
  jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });

const getTokenFromReq = (req) =>
  req.cookies?.token ||
  (req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : null);

const requireAuth = (req, res, next) => {
  const token = getTokenFromReq(req);
  if (!token) return res.status(401).json({ ok: false });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ ok: false });
  }
};

/* ================= AUTH API ================= */
app.post("/api/auth/signup", asyncHandler(async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ ok: false });

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return res.status(409).json({ ok: false });

  const hashed = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, password: hashed, name: name || null },
  });

  res.cookie("token", createToken(user.id), {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
  }).json({ ok: true, user });
}));

app.post("/api/auth/login", asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.password)))
    return res.status(401).json({ ok: false });

  res.cookie("token", createToken(user.id), {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
  }).json({ ok: true, user });
}));

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token", { path: "/", secure: true, sameSite: "none" });
  res.json({ ok: true });
});

app.get("/api/auth/me", requireAuth, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, email: true, name: true },
  });
  res.json({ ok: true, user });
}));

/* ================= CATEGORIES ================= */
app.get("/api/categories", requireAuth, asyncHandler(async (req, res) => {
  const categories = await prisma.category.findMany({
    where: { userId: req.userId },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  res.json(categories);
}));

app.post("/api/categories", requireAuth, asyncHandler(async (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ ok: false });

  const last = await prisma.category.findFirst({
    where: { userId: req.userId },
    orderBy: { sortOrder: "desc" },
  });

  const created = await prisma.category.create({
    data: {
      userId: req.userId,
      name,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    },
  });
  res.status(201).json(created);
}));

app.patch("/api/categories/:id", requireAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const name = String(req.body.name || "").trim();
  const updated = await prisma.category.update({
    where: { id },
    data: { name },
  });
  res.json(updated);
}));

app.delete("/api/categories/:id", requireAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  await prisma.item.updateMany({
    where: { userId: req.userId, categoryId: id },
    data: { categoryId: null },
  });
  await prisma.category.delete({ where: { id } });
  res.status(204).end();
}));

/* ================= ITEMS ================= */
app.get("/api/items", requireAuth, asyncHandler(async (req, res) => {
  const items = await prisma.item.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: "asc" },
  });
  res.json(items);
}));

app.post("/api/items", requireAuth, asyncHandler(async (req, res) => {
  const { name, size, categoryId, imageUrl, barcode } = req.body;
  const item = await prisma.item.create({
    data: {
      userId: req.userId,
      name,
      size,
      categoryId,
      imageUrl: imageUrl || null,
      barcode: barcode || null,
    },
  });
  res.status(201).json(item);
}));

app.put("/api/items/:id", requireAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const updated = await prisma.item.update({
    where: { id },
    data: req.body,
  });
  res.json(updated);
}));

app.delete("/api/items/:id", requireAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  await prisma.record.deleteMany({ where: { itemId: id } });
  await prisma.item.delete({ where: { id } });
  res.status(204).end();
}));

/* ================= DETAIL / RECORDS ================= */
const calcStockAndPending = (records) => {
  let stock = 0, inSum = 0, purchaseSum = 0;
  for (const r of records) {
    if (r.type === "IN") { stock += r.count; inSum += r.count; }
    else if (r.type === "OUT") stock -= r.count;
    else if (r.type === "PURCHASE") purchaseSum += r.count;
  }
  return { stock, pendingIn: Math.max(0, purchaseSum - inSum) };
};

app.get("/api/items/:itemId/records", requireAuth, asyncHandler(async (req, res) => {
  const itemId = Number(req.params.itemId);
  const item = await prisma.item.findFirst({
    where: { id: itemId, userId: req.userId },
    include: { records: { orderBy: [{ date: "asc" }, { id: "asc" }] } },
  });
  const { stock, pendingIn } = calcStockAndPending(item.records);
  res.json({ ok: true, item, records: item.records, stock, pendingIn });
}));

app.post("/api/items/:itemId/records", requireAuth, asyncHandler(async (req, res) => {
  const itemId = Number(req.params.itemId);
  const normalized = normalizeRecordInput(req.body);
  await prisma.record.create({
    data: {
      userId: req.userId,
      itemId,
      ...normalized,
      date: req.body.date ? new Date(req.body.date) : new Date(),
      memo: req.body.memo || null,
    },
  });
  res.status(201).json({ ok: true });
}));

/* ================= MIGRATE ================= */
app.use("/api/me", meRouter);
app.use("/api/migrate/items-batch", itemsBatchHandler);
app.use("/api/migrate/records-batch", recordsBatchHandler);

/* ================= ERROR ================= */
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ ok: false, message: err.message });
});

export default app;
