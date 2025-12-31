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

const normType = (t) => (String(t || "").toUpperCase() === "OUT" ? "OUT" : "IN");

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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ================== COMMON ==================
app.use(cookieParser());
app.use(express.json({ limit: "20mb" }));

// 기존 me 라우트 (/api/me)
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
    if (!email || !password) return res.status(400).json({ ok: false });

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return res.status(409).json({ ok: false });

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
  res.clearCookie("token", { path: "/", secure: true, sameSite: "none" });
  res.json({ ok: true });
});

// GET /api/auth/me (프론트 호환용)
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

// ================== CATEGORIES ==================

// GET /api/categories
app.get(
  "/api/categories",
  requireAuth,
  asyncHandler(async (req, res) => {
    const categories = await prisma.category.findMany({
      where: { userId: req.userId },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
    res.json(categories);
  })
);

// POST /api/categories  body: { name, sortOrder? }
app.post(
  "/api/categories",
  requireAuth,
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name ?? "").trim();
    const sortOrder =
      req.body?.sortOrder == null ? undefined : Number(req.body.sortOrder);

    if (!name) return res.status(400).json({ ok: false, message: "name required" });

    const exists = await prisma.category.findFirst({
      where: { userId: req.userId, name },
      select: { id: true },
    });
    if (exists) return res.status(409).json({ ok: false, message: "duplicate name" });

    let finalSortOrder = sortOrder;
    if (finalSortOrder == null || !Number.isFinite(finalSortOrder)) {
      const last = await prisma.category.findFirst({
        where: { userId: req.userId },
        orderBy: [{ sortOrder: "desc" }, { id: "desc" }],
        select: { sortOrder: true },
      });
      finalSortOrder = (last?.sortOrder ?? 0) + 1;
    }

    const created = await prisma.category.create({
      data: { userId: req.userId, name, sortOrder: finalSortOrder },
    });

    res.status(201).json(created);
  })
);

// PATCH /api/categories/:id  body: { name?, sortOrder? }
app.patch(
  "/api/categories/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false });

    const existing = await prisma.category.findFirst({
      where: { id, userId: req.userId },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ ok: false });

    const data = {};

    if (req.body?.name !== undefined) {
      const name = String(req.body.name ?? "").trim();
      if (!name) return res.status(400).json({ ok: false, message: "name required" });

      const dup = await prisma.category.findFirst({
        where: { userId: req.userId, name, NOT: { id } },
        select: { id: true },
      });
      if (dup) return res.status(409).json({ ok: false, message: "duplicate name" });

      data.name = name;
    }

    if (req.body?.sortOrder !== undefined) {
      const sortOrder = Number(req.body.sortOrder);
      if (!Number.isFinite(sortOrder)) {
        return res.status(400).json({ ok: false, message: "sortOrder invalid" });
      }
      data.sortOrder = sortOrder;
    }

    const updated = await prisma.category.update({
      where: { id },
      data,
    });

    res.json(updated);
  })
);

// DELETE /api/categories/:id  (아이템은 '미분류'로 이동 후 삭제)
app.delete(
  "/api/categories/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false });

    const target = await prisma.category.findFirst({
      where: { id, userId: req.userId },
      select: { id: true, name: true },
    });
    if (!target) return res.status(404).json({ ok: false });

    // 미분류 카테고리 확보
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

// ================== ITEMS ==================

// GET /api/items?categoryId=123
app.get(
  "/api/items",
  requireAuth,
  asyncHandler(async (req, res) => {
    const categoryIdRaw = req.query.categoryId;
    const categoryId = categoryIdRaw ? Number(categoryIdRaw) : null;

    const where = { userId: req.userId };
    if (categoryId && Number.isFinite(categoryId)) {
      where.categoryId = categoryId;
    }

    const items = await prisma.item.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    res.json(items);
  })
);

// POST /api/items (barcode 포함) body: { name, size, categoryId, imageUrl?, barcode? }
app.post(
  "/api/items",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { name, size, categoryId, imageUrl, barcode } = req.body;

    const n = String(name ?? "").trim();
    const s = String(size ?? "").trim();
    const cid = Number(categoryId);

    const bc =
      barcode && String(barcode).trim() !== ""
        ? String(barcode).trim()
        : null;

    if (!n || !s) return res.status(400).json({ ok: false, message: "name/size required" });
    if (!Number.isFinite(cid) || cid <= 0) {
      return res.status(400).json({ ok: false, message: "categoryId required" });
    }

    // 내 카테고리인지 검증
    const cat = await prisma.category.findFirst({
      where: { id: cid, userId: req.userId },
      select: { id: true },
    });
    if (!cat) return res.status(400).json({ ok: false, message: "invalid categoryId" });

    if (bc) {
      const exists = await prisma.item.findFirst({
        where: { userId: req.userId, barcode: bc },
        select: { id: true },
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
        categoryId: cid,
        imageUrl: imageUrl || null,
        barcode: bc,
      },
    });

    res.status(201).json(item);
  })
);

// PUT /api/items/:id (아이템 수정)
app.put(
  "/api/items/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0)
      return res.status(400).json({ ok: false });

    const existing = await prisma.item.findFirst({
      where: { id, userId: req.userId },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ ok: false });

    const { name, size, imageUrl, memo, categoryId, barcode } = req.body;

    // barcode 중복 체크(입력값이 있을 때만)
    const bc =
      barcode === null || barcode === undefined
        ? undefined
        : String(barcode).trim() === ""
        ? null
        : String(barcode).trim();

    if (bc !== undefined && bc !== null) {
      const dup = await prisma.item.findFirst({
        where: { userId: req.userId, barcode: bc, NOT: { id } },
        select: { id: true },
      });
      if (dup) {
        return res
          .status(409)
          .json({ ok: false, message: "이미 등록된 바코드입니다." });
      }
    }

    // categoryId 유효성 체크(들어온 경우)
    let nextCategoryId = undefined;
    if (categoryId !== undefined) {
      const cid = Number(categoryId);
      if (!Number.isFinite(cid) || cid <= 0) {
        return res.status(400).json({ ok: false, message: "categoryId가 잘못되었습니다." });
      }

      const cat = await prisma.category.findFirst({
        where: { id: cid, userId: req.userId },
        select: { id: true },
      });
      if (!cat) {
        return res.status(400).json({ ok: false, message: "invalid categoryId" });
      }

      nextCategoryId = cid;
    }

    const updated = await prisma.item.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(size !== undefined ? { size } : {}),
        ...(imageUrl !== undefined ? { imageUrl } : {}),
        ...(memo !== undefined ? { memo } : {}),
        ...(nextCategoryId !== undefined ? { categoryId: nextCategoryId } : {}),
        ...(bc !== undefined ? { barcode: bc } : {}),
      },
    });

    res.json(updated);
  })
);

// DELETE /api/items/:id (아이템 삭제 + 해당 아이템 기록 삭제)
app.delete(
  "/api/items/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0)
      return res.status(400).json({ ok: false });

    const existing = await prisma.item.findFirst({
      where: { id, userId: req.userId },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ ok: false });

    await prisma.record.deleteMany({
      where: { userId: req.userId, itemId: id },
    });
    await prisma.item.delete({ where: { id } });

    res.status(204).end();
  })
);

// GET /api/items/lookup (barcode lookup)
app.get(
  "/api/items/lookup",
  requireAuth,
  asyncHandler(async (req, res) => {
    const barcode = String(req.query.barcode || "").trim();
    if (!barcode) return res.status(400).json({ ok: false });

    const item = await prisma.item.findFirst({
      where: { userId: req.userId, barcode },
      select: { id: true, name: true, size: true, imageUrl: true, barcode: true, categoryId: true },
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
        categoryId: item.categoryId,
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

/**
 *  디테일 페이지용: GET /api/items/:itemId/records (v2)
 */
app.get(
  "/api/items/:itemId/records",
  requireAuth,
  asyncHandler(async (req, res) => {
    const t0 = Date.now();
    const itemId = Number(req.params.itemId);

    if (!Number.isFinite(itemId) || itemId <= 0) {
      return res.status(400).json({ ok: false, message: "itemId가 잘못되었습니다." });
    }

    const t1 = Date.now();
    const itemWithRecords = await prisma.item.findFirst({
      where: { id: itemId, userId: req.userId },
      select: {
        id: true,
        name: true,
        size: true,
        imageUrl: true,
        categoryId: true,
        records: {
          where: { userId: req.userId },
          orderBy: [{ date: "asc" }, { id: "asc" }],
          select: {
            id: true,
            type: true,
            price: true,
            count: true,
            date: true,
            memo: true,
          },
        },
      },
    });
    const t2 = Date.now();

    if (!itemWithRecords) {
      return res.status(404).json({ ok: false, message: "item not found" });
    }

    const t3 = Date.now();
    let stock = 0;
    for (const r of itemWithRecords.records) {
      stock += r.type === "IN" ? (r.count ?? 0) : -(r.count ?? 0);
    }
    const t4 = Date.now();

    const payload = {
      ok: true,
      item: {
        id: itemWithRecords.id,
        name: itemWithRecords.name,
        size: itemWithRecords.size,
        imageUrl: itemWithRecords.imageUrl,
        categoryId: itemWithRecords.categoryId,
      },
      records: itemWithRecords.records,
      stock,
      timing: {
        one_query_ms: t2 - t1,
        stock_js_ms: t4 - t3,
        total_ms: t4 - t0,
      },
    };

    console.log("[DETAIL RECORDS TIMING v2]", {
      userId: req.userId,
      itemId,
      ...payload.timing,
      recordsCount: Array.isArray(payload.records) ? payload.records.length : 0,
    });

    return res.json(payload);
  })
);

// 디테일/단건 추가: POST /api/items/:itemId/records
app.post(
  "/api/items/:itemId/records",
  requireAuth,
  asyncHandler(async (req, res) => {
    const itemId = Number(req.params.itemId);
    if (!Number.isFinite(itemId) || itemId <= 0) {
      return res.status(400).json({ ok: false, message: "itemId가 잘못되었습니다." });
    }

    const existsItem = await prisma.item.findFirst({
      where: { id: itemId, userId: req.userId },
      select: { id: true },
    });
    if (!existsItem) return res.status(404).json({ ok: false, message: "item not found" });

    const { price, count, date, type, memo } = req.body;

    const recordType = normType(type);
    const numericCount = count == null ? 1 : Number(count);
    if (!Number.isFinite(numericCount) || numericCount <= 0) {
      return res.status(400).json({ ok: false, message: "count가 잘못되었습니다." });
    }

    let priceValue = null;
    if (price != null && price !== "") {
      const p = Number(price);
      if (!Number.isFinite(p) || p < 0) {
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
        userId: req.userId,
        itemId,
        type: recordType,
        price: priceValue,
        count: numericCount,
        date: date ? new Date(date) : new Date(),
        memo: memo != null && String(memo).trim() !== "" ? String(memo) : null,
      },
      include: { item: { select: { id: true, name: true, size: true, imageUrl: true } } },
    });

    const stock = await calcStock(req.userId, itemId);
    return res.status(201).json({ ok: true, record: created, stock });
  })
);

// 기록 수정: PUT /api/items/:itemId/records
app.put(
  "/api/items/:itemId/records",
  requireAuth,
  asyncHandler(async (req, res) => {
    const itemId = Number(req.params.itemId);
    if (!Number.isFinite(itemId) || itemId <= 0) {
      return res.status(400).json({ ok: false, message: "itemId가 잘못되었습니다." });
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

    let nextPrice = undefined; // undefined = 변경 안함
    if (price === null || price === "") {
      nextPrice = null;
    } else if (price != null) {
      const p = Number(price);
      if (!Number.isFinite(p) || p < 0) {
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
      include: { item: { select: { id: true, name: true, size: true, imageUrl: true } } },
    });

    const stock = await calcStock(req.userId, itemId);
    return res.json({ ok: true, record: updated, stock });
  })
);

// 기록 삭제: DELETE /api/items/:itemId/records?id=123
app.delete(
  "/api/items/:itemId/records",
  requireAuth,
  asyncHandler(async (req, res) => {
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
    if (!existing) return res.status(404).json({ ok: false, message: "record not found" });

    await prisma.record.delete({ where: { id } });

    const stock = await calcStock(req.userId, itemId);
    return res.json({ ok: true, stock });
  })
);

// 입/출고 페이지용 전체 기록 조회: GET /api/records
app.get(
  "/api/records",
  requireAuth,
  asyncHandler(async (req, res) => {
    const type = String(req.query.type || "").toUpperCase();
    const priceMissing = String(req.query.priceMissing || "") === "1";

    const where = { userId: req.userId };
    if (type === "IN" || type === "OUT") where.type = type;
    if (priceMissing) where.price = null;

    const records = await prisma.record.findMany({
      where,
      orderBy: [{ date: "desc" }, { id: "desc" }],
      include: {
        item: { select: { id: true, name: true, size: true, imageUrl: true } },
      },
    });

    return res.json({ ok: true, records });
  })
);

// 배치 입고/출고: POST /api/records/batch
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
          return res.status(400).json({ ok: false, message: "재고 부족" });
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
  res.status(500).json({
    ok: false,
    message: "server error",
    error: String(err?.message || err),
  });
});

// ================== EXPORT ==================
export default app;
