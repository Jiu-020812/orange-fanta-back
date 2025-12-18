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

// ================== ENV ==================
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-key";

const allowedOrigins = [
  "https://orange-fanta-one.vercel.app",
  "http://localhost:5173",
  "http://localhost:5175",
];

// ================== UTILS ==================
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const normType = (t) => (String(t).toUpperCase() === "OUT" ? "OUT" : "IN");

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

// ================== COMMON ==================
app.use(cookieParser());
app.use(express.json({ limit: "20mb" }));

// 🔹 기존 me 라우트 (/api/me)
app.use("/api/me", meRouter);

// ================== MIGRATE ==================
app.use("/api/migrate/items-batch", itemsBatchHandler);
app.use("/api/migrate/records-batch", recordsBatchHandler);

// ================== AUTH UTILS ==================
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
  } catch {
    return res.status(401).json({
      ok: false,
      reason: "INVALID_TOKEN",
      message: "토큰이 유효하지 않습니다.",
    });
  }
}

// ================== HELLO ==================
app.get("/", (req, res) => {
  res.json({ ok: true, message: "Backend running" });
});

// ================== AUTH API ==================

// POST /api/auth/signup
app.post(
  "/api/auth/signup",
  asyncHandler(async (req, res) => {
    const { email, password, name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ ok: false });
    }

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      return res.status(409).json({ ok: false });
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
      });
  })
);

// POST /api/auth/login
app.post(
  "/api/auth/login",
  asyncHandler(async (req, res) => {
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
      });
  })
);

// POST /api/auth/logout
app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token", {
    path: "/",
    secure: true,
    sameSite: "none",
  });
  res.json({ ok: true });
});

// 🔥 추가: GET /api/auth/me (프론트 호환용)
app.get(
  "/api/auth/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, email: true, name: true },
    });
    res.json({ ok: true, user });
  })
);

// ================== ITEMS ==================
app.get(
  "/api/items",
  requireAuth,
  asyncHandler(async (req, res) => {
    const items = await prisma.item.findMany({
      where: { userId: req.userId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    res.json(items);
  })
);

// POST /api/items (barcode 포함)
app.post(
  "/api/items",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { name, size, category, imageUrl, barcode } = req.body;

    const n = String(name ?? "").trim();
    const s = String(size ?? "").trim();
    const bc =
      barcode && String(barcode).trim() !== ""
        ? String(barcode).trim()
        : null;

    if (!n || !s) return res.status(400).json({ ok: false });

    if (bc) {
      const exists = await prisma.item.findFirst({
        where: { userId: req.userId, barcode: bc },
      });
      if (exists) {
        return res
          .status(409)
          .json({ ok: false, message: "이미 등록된 바코드입니다." });
      }
    }

    const item = await prisma.item.create({
      data: {
        userId: req.userId,
        name: n,
        size: s,
        category,
        imageUrl: imageUrl || null,
        barcode: bc,
      },
    });

    res.status(201).json(item);
  })
);

// GET /api/items/lookup
app.get(
  "/api/items/lookup",
  requireAuth,
  asyncHandler(async (req, res) => {
    const barcode = String(req.query.barcode || "").trim();
    if (!barcode) return res.status(400).json({ ok: false });

    const item = await prisma.item.findFirst({
      where: { userId: req.userId, barcode },
    });

    if (!item) return res.json({ ok: false, message: "NOT_FOUND" });

    res.json({
      ok: true,
      item: {
        itemId: item.id,
        name: item.name,
        size: item.size,
        imageUrl: item.imageUrl,
        barcode: item.barcode,
        category: item.category,
      },
    });
  })
);

// ================== RECORDS ==================
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

// POST /api/records/batch
app.post(
  "/api/records/batch",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { type, items } = req.body;
    const recordType = normType(type);

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false });
    }

    const data = items
      .map((x) => ({
        userId: req.userId,
        itemId: Number(x.itemId),
        type: recordType,
        count: Number(x.count),
        date: new Date(),
      }))
      .filter((x) => x.itemId > 0 && x.count > 0);

    if (recordType === "OUT") {
      for (const row of data) {
        const stock = await calcStock(req.userId, row.itemId);
        if (row.count > stock) {
          return res
            .status(400)
            .json({ ok: false, message: "재고 부족" });
        }
      }
    }

    await prisma.record.createMany({ data });
    res.json({ ok: true, inserted: data.length });
  })
);

// ================== ERROR ==================
app.use((err, req, res, next) => {
  console.error("ERROR:", err);
  res.status(500).json({ ok: false, message: "server error" });
});

// ================== EXPORT ==================
export default app;
