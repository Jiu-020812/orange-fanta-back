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

// ================== RECORDS (IN/OUT) ==================

function normType(t) {
  const u = String(t || "").toUpperCase();
  return u === "OUT" ? "OUT" : "IN";
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
// item(name/size) 같이 내려줌 + 응답 형태 통일
app.get("/api/items/:itemId/records", requireAuth, async (req, res) => {
  const itemId = Number(req.params.itemId);
  if (!Number.isFinite(itemId) || itemId <= 0) {
    return res
      .status(400)
      .json({ ok: false, message: "itemId가 잘못되었습니다." });
  }

  const records = await prisma.record.findMany({
    where: { itemId, userId: req.userId },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    include: {
      item: { select: { id: true, name: true, size: true } }, // 옵션 표시용
    },
  });

  const stock = await calcStock(req.userId, itemId);
  return res.json({ ok: true, records, stock });
});

// POST /api/items/:itemId/records
// body: { price?, count, date?, type?, memo? }
// price는 옵션(없어도 OK). OUT일 때는 price 없어도 OK.
app.post("/api/items/:itemId/records", requireAuth, async (req, res) => {
  const itemId = Number(req.params.itemId);
  if (!Number.isFinite(itemId) || itemId <= 0) {
    return res
      .status(400)
      .json({ ok: false, message: "itemId가 잘못되었습니다." });
  }

  const { price, count, date, type, memo } = req.body;

  const numericCount = count == null ? 1 : Number(count);
  if (!Number.isFinite(numericCount) || numericCount <= 0) {
    return res.status(400).json({ ok: false, message: "count가 잘못되었습니다." });
  }

  const recordType = normType(type);

  //  price optional 처리
  let priceValue = null;
  if (price != null && price !== "") {
    const p = Number(price);
    if (Number.isNaN(p) || !Number.isFinite(p) || p < 0) {
      return res.status(400).json({ ok: false, message: "price가 잘못되었습니다." });
    }
    priceValue = p;
  }

  // OUT 재고 부족 체크
  if (recordType === "OUT") {
    const stockNow = await calcStock(req.userId, itemId);
    if (numericCount > stockNow) {
      return res.status(400).json({
        ok: false,
        message: `재고 부족: 현재 재고(${stockNow})보다 많이 출고할 수 없습니다.`,
        stock: stockNow,
      });
    }
  }

  const created = await prisma.record.create({
    data: {
      itemId,
      userId: req.userId,
      type: recordType,
      price: priceValue, 
      count: numericCount,
      date: date ? new Date(date) : new Date(),
      memo: memo != null && String(memo).trim() !== "" ? String(memo) : null,
    },
    include: {
      item: { select: { id: true, name: true, size: true } },
    },
  });

  const stock = await calcStock(req.userId, itemId);
  return res.status(201).json({ ok: true, record: created, stock });
});

// PUT /api/items/:itemId/records
// body: { id, price?, count?, date?, type?, memo? }
//  price optional + OUT 업데이트 재고체크 유지
app.put("/api/items/:itemId/records", requireAuth, async (req, res) => {
  const itemId = Number(req.params.itemId);
  if (!Number.isFinite(itemId) || itemId <= 0) {
    return res
      .status(400)
      .json({ ok: false, message: "itemId가 잘못되었습니다." });
  }

  const { id, price, count, date, type, memo } = req.body;
  const numericId = Number(id);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    return res.status(400).json({ ok: false, message: "id가 잘못되었습니다." });
  }

  const existing = await prisma.record.findFirst({
    where: { id: numericId, itemId, userId: req.userId },
  });
  if (!existing) return res.status(404).json({ ok: false, message: "record not found" });

  const nextType = type != null ? normType(type) : existing.type;
  const nextCount = count != null ? Number(count) : existing.count;

  if (!Number.isFinite(nextCount) || nextCount <= 0) {
    return res.status(400).json({ ok: false, message: "count가 잘못되었습니다." });
  }

  //  price optional 처리
  let nextPrice = undefined; // undefined = 변경 안함
  if (price === null || price === "") {
    nextPrice = null; // 명시적으로 비우기
  } else if (price != null) {
    const p = Number(price);
    if (Number.isNaN(p) || !Number.isFinite(p) || p < 0) {
      return res.status(400).json({ ok: false, message: "price가 잘못되었습니다." });
    }
    nextPrice = p;
  }

  // OUT 업데이트 재고 체크
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
      ...(nextPrice !== undefined ? { price: nextPrice } : {}),
      ...(count != null ? { count: nextCount } : {}),
      ...(date ? { date: new Date(date) } : {}),
      ...(type != null ? { type: nextType } : {}),
      ...(memo != null ? { memo: memo ? String(memo) : null } : {}),
    },
    include: {
      item: { select: { id: true, name: true, size: true } },
    },
  });

  const stock = await calcStock(req.userId, itemId);
  return res.json({ ok: true, record: updated, stock });
});

// DELETE /api/items/:itemId/records?id=123
app.delete("/api/items/:itemId/records", requireAuth, async (req, res) => {
  const itemId = Number(req.params.itemId);
  if (!Number.isFinite(itemId) || itemId <= 0) {
    return res
      .status(400)
      .json({ ok: false, message: "itemId가 잘못되었습니다." });
  }

  const id = Number(req.query.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ ok: false, message: "id가 잘못되었습니다." });
  }

  const existing = await prisma.record.findFirst({
    where: { id, itemId, userId: req.userId },
  });
  if (!existing) return res.status(404).json({ ok: false, message: "record not found" });

  await prisma.record.delete({ where: { id } });

  const stock = await calcStock(req.userId, itemId);
  return res.json({ ok: true, stock });
});

// 전체 기록 조회 (입/출고 페이지용)
app.get("/api/records", requireAuth, async (req, res) => {
  console.log("HIT /api/records", { userId: req.userId, q: req.query });

  try {
    const type = String(req.query.type || "").toUpperCase();
    const priceMissing = String(req.query.priceMissing || "") === "1";

    const where = { userId: req.userId };
    if (type === "IN" || type === "OUT") where.type = type;
    if (priceMissing) where.price = null;

    console.log("BEFORE prisma.record.findMany", where);

    const records = await prisma.record.findMany({
      where,
      orderBy: [{ date: "desc" }, { id: "desc" }],
      include: { item: { select: { id: true, name: true, size: true } } },
    });

    console.log("AFTER prisma.record.findMany", { count: records.length });

    return res.json({ ok: true, records });
  } catch (err) {
    console.error("GET /api/records error:", err);
    return res.status(500).json({ ok: false, message: "server error" });
  }
});

//추가 
app.use((err, req, res, next) => {
  console.error("UNHANDLED ERROR:", err);
  res.status(500).json({ ok: false, message: "server error" });
});




// ================== EXPORT ==================
export default app;
