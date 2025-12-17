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

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ================== 공통 미들웨어 ==================
app.use(cookieParser());
app.use(express.json({ limit: "20mb" }));
app.use("/api/me", meRouter);

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
    if (!email || !password) return res.status(400).json({ ok: false });

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists)
      return res
        .status(409)
        .json({ ok: false, reason: "DUPLICATE_EMAIL" });

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
app.get("/api/items", requireAuth, async (req, res) => {
  const items = await prisma.item.findMany({
    where: { userId: req.userId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  res.json(items);
});

app.post("/api/items", requireAuth, async (req, res) => {
  const { name, size, imageUrl, category } = req.body;
  if (!name || !size) return res.status(400).json({ ok: false });

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

app.put("/api/items/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false });

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

app.delete("/api/items/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false });

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

// ================== RECORDS (출고 완성) ==================

function normType(t) {
  return t === "OUT" ? "OUT" : "IN";
}

async function calcStock(userId, itemId) {
  const rows = await prisma.record.groupBy({
    by: ["type"],
    where: { userId, itemId },
    _sum: { count: true },
  });

  const inSum = rows.find((r) => r.type === "IN")?._sum.count ?? 0;
  const outSum = rows.find((r) => r.type === "OUT")?._sum.count ?? 0;
  return inSum - outSum;
}

// GET /api/items/:itemId/records
app.get("/api/items/:itemId/records", requireAuth, async (req, res) => {
  const itemId = Number(req.params.itemId);
  if (!Number.isFinite(itemId) || itemId <= 0) {
    return res.status(400).json({ ok: false, message: "itemId가 잘못되었습니다." });
  }

  const records = await prisma.record.findMany({
    where: { itemId, userId: req.userId },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });

  //  프론트 호환: 배열 그대로
  res.json(records);
});

// POST /api/items/:itemId/records
// body: { price, count, date, type?, memo? }
app.post("/api/items/:itemId/records", requireAuth, async (req, res) => {
  const itemId = Number(req.params.itemId);
  if (!Number.isFinite(itemId) || itemId <= 0) {
    return res.status(400).json({ ok: false, message: "itemId가 잘못되었습니다." });
  }

  const { price, count, date, type, memo } = req.body;

  //  price 검증 추가
  if (price == null || price === "" || Number.isNaN(Number(price))) {
    return res.status(400).json({ ok: false, message: "price는 필수입니다." });
  }

  const numericCount = count == null ? 1 : Number(count);
  if (!Number.isFinite(numericCount) || numericCount <= 0) {
    return res.status(400).json({ ok: false, message: "count가 잘못되었습니다." });
  }

  const recordType = normType(type);

  //  OUT 재고 부족 체크
  if (recordType === "OUT") {
    const stock = await calcStock(req.userId, itemId);
    if (numericCount > stock) {
      return res.status(400).json({
        ok: false,
        message: `재고 부족: 현재 재고(${stock})보다 많이 출고할 수 없습니다.`,
        stock,
      });
    }
  }

  const record = await prisma.record.create({
    data: {
      itemId,
      userId: req.userId,
      type: recordType,
      memo: memo != null ? String(memo) : null,
      price: Number(price),
      count: numericCount,
      date: date ? new Date(date) : new Date(),
    },
  });

  res.status(201).json(record);
});

// PUT /api/items/:itemId/records
// body: { id, price?, count?, date?, type?, memo? }
app.put("/api/items/:itemId/records", requireAuth, async (req, res) => {
  const itemId = Number(req.params.itemId);
  if (!Number.isFinite(itemId) || itemId <= 0) {
    return res.status(400).json({ ok: false, message: "itemId가 잘못되었습니다." });
  }

  const { id, price, count, date, type, memo } = req.body;
  const numericId = Number(id);

  //  id 검증 추가
  if (!Number.isFinite(numericId) || numericId <= 0) {
    return res.status(400).json({ ok: false, message: "id가 잘못되었습니다." });
  }

  const existing = await prisma.record.findFirst({
    where: { id: numericId, itemId, userId: req.userId },
  });
  if (!existing) return res.status(404).json({ ok: false });

  const nextType = type != null ? normType(type) : existing.type;
  const nextCount = count != null ? Number(count) : existing.count;

  if (!Number.isFinite(nextCount) || nextCount <= 0) {
    return res.status(400).json({ ok: false, message: "count가 잘못되었습니다." });
  }

  // 업데이트 재고 체크
  if (nextType === "OUT") {
    const stockNow = await calcStock(req.userId, itemId);
    const stockExcludingThis =
      existing.type === "OUT" ? stockNow + existing.count : stockNow;

    if (nextCount > stockExcludingThis) {
      return res.status(400).json({
        ok: false,
        message: `재고 부족: 현재 재고(${stockExcludingThis})보다 많이 출고할 수 없습니다.`,
        stock: stockExcludingThis,
      });
    }
  }

  const updated = await prisma.record.update({
    where: { id: numericId },
    data: {
      ...(price != null
        ? (Number.isNaN(Number(price))
            ? {}
            : { price: Number(price) })
        : {}),
      ...(count != null ? { count: nextCount } : {}),
      ...(date ? { date: new Date(date) } : {}),
      ...(type != null ? { type: nextType } : {}),
      ...(memo != null ? { memo: memo ? String(memo) : null } : {}),
    },
  });

  res.json(updated);
});

// DELETE /api/items/:itemId/records?id=123
app.delete("/api/items/:itemId/records", requireAuth, async (req, res) => {
  const itemId = Number(req.params.itemId);
  if (!Number.isFinite(itemId) || itemId <= 0) {
    return res.status(400).json({ ok: false, message: "itemId가 잘못되었습니다." });
  }

  const id = Number(req.query.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ ok: false, message: "id가 잘못되었습니다." });
  }

  const existing = await prisma.record.findFirst({
    where: { id, itemId, userId: req.userId },
  });
  if (!existing) return res.status(404).json({ ok: false });

  await prisma.record.delete({ where: { id } });
  res.status(204).end();
});

// ================== EXPORT ==================
export default app;
