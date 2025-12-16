import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

import itemsBatchHandler from "./migrate/items-batch.js";
import recordsBatchHandler from "./migrate/records-batch.js";

const app = express();
const prisma = new PrismaClient();

// ================== 환경 변수 ==================
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-key";

const allowedOrigins = [
  "https://orange-fanta-one.vercel.app",
  "http://localhost:5173",
  "http://localhost:5175",
];

// ================== CORS ==================
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

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

// ================== 공통 미들웨어 ==================
app.use(cookieParser());
app.use(express.json({ limit: "20mb" }));

// ================== MIGRATE (batch) ==================
app.use("/api/migrate/items-batch", itemsBatchHandler);
app.use("/api/migrate/records-batch", recordsBatchHandler);

// ================== JWT / AUTH UTIL ==================
function createToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
}

function getTokenFromReq(req) {
  let token = req.cookies?.token;

  const authHeader = req.headers.authorization;
  if (!token && authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  }

  return token;
}

function requireAuth(req, res, next) {
  const token = getTokenFromReq(req);

  if (!token) {
    return res.status(401).json({
      ok: false,
      reason: "NO_TOKEN",
      message: "로그인이 필요합니다.",
    });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (err) {
    return res.status(401).json({
      ok: false,
      reason: "INVALID_TOKEN",
      message: "세션이 만료되었거나 잘못된 토큰입니다.",
    });
  }
}

// ================== HELLO ==================
app.get("/", (req, res) => {
  res.json({ ok: true, message: "Backend running (api/index.js)" });
});

// ================== AUTH ==================
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ ok: false });
    }

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      return res.status(409).json({ ok: false, reason: "DUPLICATE_EMAIL" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, password: hashed, name: name || null },
    });

    const token = createToken(user.id);

    res
      .cookie("token", token, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/",
      })
      .json({
        ok: true,
        user: { id: user.id, email: user.email, name: user.name },
        token,
      });
  } catch {
    res.status(500).json({ ok: false });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ ok: false });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ ok: false });

    const token = createToken(user.id);

    res
      .cookie("token", token, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/",
      })
      .json({
        ok: true,
        user: { id: user.id, email: user.email, name: user.name },
        token,
      });
  } catch {
    res.status(500).json({ ok: false });
  }
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, email: true, name: true },
  });
  res.json({ ok: true, user });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token", { path: "/", secure: true, sameSite: "none" });
  res.json({ ok: true });
});

// ================== ITEMS ==================

// GET /api/items
app.get("/api/items", requireAuth, async (req, res) => {
  const items = await prisma.item.findMany({
    where: { userId: req.userId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  res.json(items);
});

// POST /api/items
app.post("/api/items", requireAuth, async (req, res) => {
  const { name, size, imageUrl, category } = req.body;
  if (!name || !size) {
    return res.status(400).json({ ok: false });
  }

  const item = await prisma.item.create({
    data: {
      userId: req.userId,
      name,
      size,
      imageUrl: imageUrl || null,
      category: category || undefined,
    },
  });

  res.status(201).json(item);
});

// PUT /api/items/:id
app.put("/api/items/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { name, size, imageUrl, memo, category } = req.body;

  const existing = await prisma.item.findFirst({
    where: { id, userId: req.userId },
  });
  if (!existing) return res.status(404).json({ ok: false });

  const updated = await prisma.item.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(size !== undefined ? { size } : {}),
      ...(imageUrl !== undefined ? { imageUrl } : {}),
      ...(memo !== undefined ? { memo } : {}),
      ...(category !== undefined ? { category } : {}),
    },
  });

  res.json(updated);
});

// DELETE /api/items/:id
app.delete("/api/items/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);

  const existing = await prisma.item.findFirst({
    where: { id, userId: req.userId },
  });
  if (!existing) return res.status(404).json({ ok: false });

  await prisma.record.deleteMany({
    where: { itemId: id, userId: req.userId },
  });
  await prisma.item.delete({ where: { id } });

  res.status(204).end();
});

// ================== RECORDS ==================

// GET
app.get("/api/items/:itemId/records", requireAuth, async (req, res) => {
  const itemId = Number(req.params.itemId);
  const records = await prisma.record.findMany({
    where: { itemId, userId: req.userId },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });
  res.json(records);
});

// POST
app.post("/api/items/:itemId/records", requireAuth, async (req, res) => {
  const itemId = Number(req.params.itemId);
  const { price, count, date } = req.body;

  const record = await prisma.record.create({
    data: {
      itemId,
      userId: req.userId,
      price: Number(price),
      count: count == null ? 1 : Number(count),
      date: date ? new Date(date) : new Date(),
    },
  });

  res.status(201).json(record);
});

// PUT
app.put("/api/items/:itemId/records", requireAuth, async (req, res) => {
  const itemId = Number(req.params.itemId);
  const { id, price, count, date } = req.body;

  const existing = await prisma.record.findFirst({
    where: { id, itemId, userId: req.userId },
  });
  if (!existing) return res.status(404).json({ ok: false });

  const updated = await prisma.record.update({
    where: { id },
    data: {
      ...(price != null ? { price: Number(price) } : {}),
      ...(count != null ? { count: Number(count) } : {}),
      ...(date ? { date: new Date(date) } : {}),
    },
  });

  res.json(updated);
});

// DELETE
app.delete("/api/items/:itemId/records", requireAuth, async (req, res) => {
  const itemId = Number(req.params.itemId);
  const id = Number(req.query.id);

  const existing = await prisma.record.findFirst({
    where: { id, itemId, userId: req.userId },
  });
  if (!existing) return res.status(404).json({ ok: false });

  await prisma.record.delete({ where: { id } });
  res.status(204).end();
});

// ================== EXPORT ==================
export default app;