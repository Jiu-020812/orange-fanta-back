import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import crypto from "crypto";
import { Resend } from "resend";

import itemsBatchHandler from "./migrate/items-batch.js";
import recordsBatchHandler from "./migrate/records-batch.js";
import meRouter from "../routes/me.js";

const app = express();

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

// 입력 정규화(규칙)
// - IN: price 무조건 null
// - PURCHASE: price 필수(>0)
// - OUT: price 선택(null 가능, 있으면 >=0)
function normalizeRecordInput(body) {
  const type = normRecordType(body?.type);
  if (!type) throw new Error("Invalid record type (IN/OUT/PURCHASE)");

  const countRaw = body?.count ?? 1;
  const countNum = Number(countRaw);
  const count = Math.max(1, Math.abs(Number.isFinite(countNum) ? countNum : 1));

  const rawPrice = body?.price;
  const price = rawPrice === "" || rawPrice == null ? null : Number(rawPrice);

  if (type === "IN") {
    return { type, count, price: null };
  }

  if (type === "PURCHASE") {
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error("PURCHASE requires price (>0)");
    }
    return { type, count, price: Math.floor(price) };
  }

  // OUT
  if (price === null) return { type, count, price: null };
  if (!Number.isFinite(price) || price < 0) throw new Error("Invalid price");
  return { type, count, price: Math.floor(price) };
}

function toYmd(v) {
  if (!v) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

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

/* ===================== 인증 유틸 ===================== */
function makeRandomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function addHours(date, hours) {
  const d = new Date(date);
  d.setHours(d.getHours() + hours);
  return d;
}


const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

async function sendVerifyEmail({ to, link }) {
  if (!resend) {
    console.log("[MAIL SKIP] RESEND_API_KEY missing. Link:", link);
    return;
  }

  const from = process.env.MAIL_FROM || "onboarding@resend.dev";

  await resend.emails.send({
    from,
    to,
    subject: "이메일 인증을 완료해 주세요",
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5">
        <h2>이메일 인증</h2>
        <p>아래 버튼을 눌러 이메일 인증을 완료해 주세요.</p>
        <p>
          <a href="${link}"
             style="display:inline-block;padding:10px 14px;border-radius:10px;
                    background:#111827;color:#fff;text-decoration:none">
            이메일 인증하기
          </a>
        </p>
        <p style="color:#6b7280;font-size:13px">
          버튼이 안 되면 아래 링크를 복사해서 브라우저에 붙여넣어 주세요.<br/>
          ${link}
        </p>
      </div>
    `,
  });
}
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
  if (!token) {
    return res.status(401).json({ ok: false, reason: "NO_TOKEN" });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ ok: false, reason: "INVALID_TOKEN" });
  }
};

/* ================= HELLO ================= */
app.get("/", (req, res) => {
  res.json({ ok: true, message: "Backend running" });
});

/* ================= ROUTERS (기존 유지) ================= */
app.use("/api/me", meRouter);

/* ================= MIGRATE (기존 유지) ================= */
app.use("/api/migrate/items-batch", itemsBatchHandler);
app.use("/api/migrate/records-batch", recordsBatchHandler);

/* ================= AUTH API ================= */
app.post(
  "/api/auth/signup",
  asyncHandler(async (req, res) => {
    const { email, password, name } = req.body;

    const e = String(email ?? "").trim();
    const p = String(password ?? "");
    const n = String(name ?? "").trim();

    if (!e || !p) {
      return res.status(400).json({ ok: false, message: "email/password required" });
    }
    if (p.length < 8) {
      return res.status(400).json({ ok: false, message: "password must be at least 8 chars" });
    }

    const exists = await prisma.user.findUnique({ where: { email: e } });
    if (exists) {
      return res.status(409).json({ ok: false, message: "이미 존재하는 이메일입니다." });
    }

    const hashed = await bcrypt.hash(p, 10);

    const user = await prisma.user.create({
      data: { email: e, password: hashed, name: n || null },
      select: { id: true, email: true, name: true, emailVerified: true },
    });

    const rawToken = makeRandomToken(32);
    const tokenHash = sha256(rawToken);

    await prisma.emailVerifyToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: addHours(new Date(), 24),
      },
    });

    const apiOrigin = process.env.API_ORIGIN || `https://${req.headers.host}`;
    const link = `${apiOrigin}/api/auth/verify?token=${rawToken}`;

    await sendVerifyEmail({ to: user.email, link });
   console.log("[VERIFY SENT]", user.email);
    return res.status(201).json({
      ok: true,
      message: "회원가입 완료. 이메일 인증을 진행해주세요.",
      devVerifyLink: process.env.NODE_ENV !== "production" ? link : undefined,
      user: { id: user.id, email: user.email, name: user.name, emailVerified: user.emailVerified },
    });
  })
);

app.get(
  "/api/auth/verify",
  asyncHandler(async (req, res) => {
    const token = String(req.query.token || "");
    if (!token) return res.status(400).send("Missing token");

    const tokenHash = sha256(token);

    const row = await prisma.emailVerifyToken.findUnique({
      where: { tokenHash },
      select: { userId: true, expiresAt: true },
    });

    if (!row) return res.status(400).send("Invalid token");
    if (row.expiresAt < new Date()) return res.status(400).send("Token expired");

    await prisma.$transaction([
      prisma.user.update({
        where: { id: row.userId },
        data: { emailVerified: true },
      }),
      prisma.emailVerifyToken.delete({ where: { tokenHash } }),
    ]);


    // 2) 프론트 로그인 페이지로 보내고 싶으면 redirect
    const appOrigin = process.env.APP_ORIGIN || "http://localhost:5173";
    return res.redirect(`${appOrigin}/login?verified=1`);
  })
);


app.post(
  "/api/auth/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    const e = String(email ?? "").trim();
    const p = String(password ?? "");
    if (!e || !p) return res.status(400).json({ ok: false });

    const user = await prisma.user.findUnique({ where: { email: e } });
    if (!user) {
      return res
        .status(401)
        .json({ ok: false, message: "이메일 또는 비밀번호 오류" });
    }

    const ok = await bcrypt.compare(p, user.password);
    if (!ok) {
      return res
        .status(401)
        .json({ ok: false, message: "이메일 또는 비밀번호 오류" });
    }

    if (!user.emailVerified) {
      return res.status(403).json({ ok: false, message: "이메일 인증이 필요합니다." });
    }
    

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

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token", { path: "/", secure: true, sameSite: "none" });
  res.json({ ok: true });
});

app.get(
  "/api/auth/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, email: true, name: true },
    });
    if (!user) return res.status(404).json({ ok: false });
    res.json({ ok: true, user });
  })
);
// POST /api/auth/resend-verify
app.post(
  "/api/auth/resend-verify",
  asyncHandler(async (req, res) => {
    const email = String(req.body?.email ?? "").trim();
    if (!email) return res.status(400).json({ ok: false, message: "email required" });

    // 보안상: 존재 여부/인증 여부를 자세히 말하지 않고 ok로 통일(선택)
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, emailVerified: true },
    });
    if (!user) return res.json({ ok: true });

    if (user.emailVerified) return res.json({ ok: true });

    // 기존 토큰 삭제 후 재발급
    await prisma.emailVerifyToken.deleteMany({ where: { userId: user.id } });

    const rawToken = makeRandomToken(32);
    const tokenHash = sha256(rawToken);
    const expiresAt = addHours(new Date(), 24);

    await prisma.emailVerifyToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    const apiOrigin = process.env.API_ORIGIN || `https://${req.headers.host}`;
    const link = `${apiOrigin}/api/auth/verify?token=${rawToken}`;

    await sendVerifyEmail({ to: user.email, link });

    res.json({ ok: true });
  })
);

/* ================= CATEGORIES ================= */
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

// POST /api/categories { name, sortOrder? }
app.post(
  "/api/categories",
  requireAuth,
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name ?? "").trim();
    const sortOrderRaw = req.body?.sortOrder;

    if (!name) {
      return res.status(400).json({ ok: false, message: "name required" });
    }

    const dup = await prisma.category.findFirst({
      where: { userId: req.userId, name },
      select: { id: true },
    });
    if (dup) {
      return res.status(409).json({ ok: false, message: "duplicate name" });
    }

    let sortOrder = Number(sortOrderRaw);
    if (sortOrderRaw == null || !Number.isFinite(sortOrder)) {
      const last = await prisma.category.findFirst({
        where: { userId: req.userId },
        orderBy: [{ sortOrder: "desc" }, { id: "desc" }],
        select: { sortOrder: true },
      });
      sortOrder = (last?.sortOrder ?? 0) + 1;
    }

    const created = await prisma.category.create({
      data: { userId: req.userId, name, sortOrder },
    });

    res.status(201).json(created);
  })
);

// PATCH /api/categories/:id { name?, sortOrder? }
app.patch(
  "/api/categories/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "invalid id" });
    }

    const existing = await prisma.category.findFirst({
      where: { id, userId: req.userId },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ ok: false });

    const data = {};

    if (req.body?.name !== undefined) {
      const name = String(req.body.name ?? "").trim();
      if (!name) {
        return res.status(400).json({ ok: false, message: "name required" });
      }
      const dup = await prisma.category.findFirst({
        where: { userId: req.userId, name, NOT: { id } },
        select: { id: true },
      });
      if (dup) return res.status(409).json({ ok: false, message: "duplicate name" });
      data.name = name;
    }

    if (req.body?.sortOrder !== undefined) {
      const so = Number(req.body.sortOrder);
      if (!Number.isFinite(so)) {
        return res.status(400).json({ ok: false, message: "sortOrder invalid" });
      }
      data.sortOrder = so;
    }

    const updated = await prisma.category.update({ where: { id }, data });
    res.json(updated);
  })
);

// DELETE /api/categories/:id  (삭제 시 해당 아이템은 "미분류"로 이동)
app.delete(
  "/api/categories/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "invalid id" });
    }

    const target = await prisma.category.findFirst({
      where: { id, userId: req.userId },
      select: { id: true, name: true },
    });
    if (!target) return res.status(404).json({ ok: false });

    // "미분류" 확보
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

/* ================= ITEMS ================= */
// categoryId 필터 적용
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

// GET /api/items/lookup?barcode=xxxxx
app.get(
  "/api/items/lookup",
  requireAuth,
  asyncHandler(async (req, res) => {
    const barcode = String(req.query.barcode || "").trim();
    if (!barcode) return res.status(400).json({ ok: false, message: "barcode required" });

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

// POST /api/items  body: { name, size, categoryId, imageUrl?, barcode? }
app.post(
  "/api/items",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { name, size, categoryId, imageUrl, barcode } = req.body;

    const n = String(name ?? "").trim();
    const s = String(size ?? "").trim();
    const cid = Number(categoryId);

    const bc = barcode && String(barcode).trim() !== "" ? String(barcode).trim() : null;

    if (!n || !s) {
      return res.status(400).json({ ok: false, message: "name/size required" });
    }
    if (!Number.isFinite(cid) || cid <= 0) {
      return res.status(400).json({ ok: false, message: "categoryId required" });
    }

    // categoryId가 내 것인지 검증
    const cat = await prisma.category.findFirst({
      where: { id: cid, userId: req.userId },
      select: { id: true },
    });
    if (!cat) {
      return res.status(400).json({ ok: false, message: "invalid categoryId" });
    }

    // barcode 중복 체크(있을 때만)
    if (bc) {
      const dup = await prisma.item.findFirst({
        where: { userId: req.userId, barcode: bc },
        select: { id: true },
      });
      if (dup) {
        return res.status(409).json({ ok: false, message: "이미 등록된 바코드입니다." });
      }
    }

    const created = await prisma.item.create({
      data: {
        userId: req.userId,
        name: n,
        size: s,
        categoryId: cid,
        imageUrl: imageUrl || null,
        barcode: bc,
      },
    });

    res.status(201).json(created);
  })
);

// PUT /api/items/:id
app.put(
  "/api/items/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "invalid id" });
    }

    const existing = await prisma.item.findFirst({
      where: { id, userId: req.userId },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ ok: false, message: "item not found" });

    const { name, size, imageUrl, memo, categoryId, barcode } = req.body;

    // barcode 정리
    const bc =
      barcode === undefined
        ? undefined
        : barcode === null
        ? null
        : String(barcode).trim() === ""
        ? null
        : String(barcode).trim();

    if (bc !== undefined && bc !== null) {
      const dup = await prisma.item.findFirst({
        where: { userId: req.userId, barcode: bc, NOT: { id } },
        select: { id: true },
      });
      if (dup) {
        return res.status(409).json({ ok: false, message: "이미 등록된 바코드입니다." });
      }
    }

    let nextCategoryId = undefined;
    if (categoryId !== undefined) {
      const cid = Number(categoryId);
      if (!Number.isFinite(cid) || cid <= 0) {
        return res.status(400).json({ ok: false, message: "categoryId invalid" });
      }
      const cat = await prisma.category.findFirst({
        where: { id: cid, userId: req.userId },
        select: { id: true },
      });
      if (!cat) return res.status(400).json({ ok: false, message: "invalid categoryId" });
      nextCategoryId = cid;
    }

    const updated = await prisma.item.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: String(name) } : {}),
        ...(size !== undefined ? { size: String(size) } : {}),
        ...(imageUrl !== undefined ? { imageUrl } : {}),
        ...(memo !== undefined ? { memo } : {}),
        ...(nextCategoryId !== undefined ? { categoryId: nextCategoryId } : {}),
        ...(bc !== undefined ? { barcode: bc } : {}),
      },
    });

    res.json(updated);
  })
);

// DELETE /api/items/:id (해당 item records도 삭제)
app.delete(
  "/api/items/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "invalid id" });
    }

    const existing = await prisma.item.findFirst({
      where: { id, userId: req.userId },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ ok: false, message: "item not found" });

    await prisma.record.deleteMany({ where: { userId: req.userId, itemId: id } });
    await prisma.item.delete({ where: { id } });

    res.status(204).end();
  })
);

/* ================= RECORD CALC ================= */
// stock = IN - OUT (PURCHASE는 재고에 반영 X)
// pendingIn = max(0, PURCHASE - IN)
//  (purchaseId 여부는 여기선 상관없음. pendingIn은 "매입 대비 입고" 개념)
const calcStockAndPending = (records) => {
  let stock = 0;
  let inSum = 0;
  let purchaseSum = 0;

  for (const r of records) {
    const c = Number(r.count ?? 0) || 0;
    const t = String(r.type || "").toUpperCase();
    if (t === "IN") {
      stock += c;
      inSum += c;
    } else if (t === "OUT") {
      stock -= c;
    } else if (t === "PURCHASE") {
      purchaseSum += c;
    }
  }

  return {
    stock,
    pendingIn: Math.max(0, purchaseSum - inSum),
  };
};

// 재고 계산(OUT 체크용) — DB에서 sum으로 계산
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

/* ================= PURCHASE ARRIVE ================= */
/**
 *  구매(PURCHASE) 기준 "입고 처리" API
 *
 * POST /api/purchases/:purchaseId/arrive
 * body: { count?: number, date?: "YYYY-MM-DD", memo?: string }
 *
 * - count 없으면: 남은 수량 전부(=일괄입고)
 * - count 있으면: 그만큼만(=부분입고)
 * - IN record 생성(type=IN, price=null, purchaseId=해당 구매 id)
 */
app.post(
  "/api/purchases/:purchaseId/arrive",
  requireAuth,
  asyncHandler(async (req, res) => {
    const purchaseId = Number(req.params.purchaseId);
    if (!Number.isFinite(purchaseId) || purchaseId <= 0) {
      return res.status(400).json({ ok: false, message: "invalid purchaseId" });
    }

    const purchase = await prisma.record.findFirst({
      where: { id: purchaseId, userId: req.userId },
      select: { id: true, type: true, itemId: true, count: true, date: true },
    });
    if (!purchase) return res.status(404).json({ ok: false, message: "purchase not found" });
    if (String(purchase.type).toUpperCase() !== "PURCHASE") {
      return res.status(400).json({ ok: false, message: "record is not PURCHASE" });
    }

    // 이미 이 PURCHASE로 입고된 수량 합
    const arrived = await prisma.record.aggregate({
      where: { userId: req.userId, itemId: purchase.itemId, type: "IN", purchaseId },
      _sum: { count: true },
    });
    const arrivedSum = arrived?._sum?.count ?? 0;
    const remaining = Math.max(0, (purchase.count ?? 0) - arrivedSum);

    if (remaining <= 0) {
      return res.json({ ok: true, message: "already fully arrived", remaining: 0 });
    }

    const reqCountRaw = req.body?.count;
    const reqCountNum =
      reqCountRaw === "" || reqCountRaw == null ? null : Number(reqCountRaw);

    const count =
      reqCountNum == null
        ? remaining // 일괄입고
        : Math.max(1, Math.min(remaining, Math.floor(reqCountNum))); // 부분입고

    const dateStr = req.body?.date;
    const dateOnly = toYmd(dateStr) || toYmd(new Date());
    const date = new Date(dateOnly + "T00:00:00");

    const memo =
      req.body?.memo != null && String(req.body.memo).trim() !== ""
        ? String(req.body.memo)
        : null;

    const createdIn = await prisma.record.create({
      data: {
        userId: req.userId,
        itemId: purchase.itemId,
        type: "IN",
        price: null,
        count,
        date,
        memo,
        purchaseId, 
      },
      select: { id: true, itemId: true, type: true, price: true, count: true, date: true, memo: true, purchaseId: true },
    });

    // 디테일 다시 계산해서 돌려줌(프론트 편하게)
    const detail = await prisma.record.findMany({
      where: { userId: req.userId, itemId: purchase.itemId },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      select: { id: true, itemId: true, type: true, price: true, count: true, date: true, memo: true, purchaseId: true },
    });

    const { stock, pendingIn } = calcStockAndPending(detail);

    const arrived2 = await prisma.record.aggregate({
      where: { userId: req.userId, itemId: purchase.itemId, type: "IN", purchaseId },
      _sum: { count: true },
    });
    const arrivedSum2 = arrived2?._sum?.count ?? 0;
    const remaining2 = Math.max(0, (purchase.count ?? 0) - arrivedSum2);

    res.status(201).json({
      ok: true,
      inRecord: createdIn,
      remaining: remaining2, 
      stock,
      pendingIn,
      records: detail,
    });
  })
);

/* ================= DETAIL (디테일 페이지) ================= */
// GET /api/items/:itemId/records
app.get(
  "/api/items/:itemId/records",
  requireAuth,
  asyncHandler(async (req, res) => {
    const itemId = Number(req.params.itemId);
    if (!Number.isFinite(itemId) || itemId <= 0) {
      return res.status(400).json({ ok: false, message: "invalid itemId" });
    }

    const item = await prisma.item.findFirst({
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
            itemId: true,
            type: true,
            price: true,
            count: true,
            date: true,
            memo: true,
            purchaseId: true, 
          },
        },
      },
    });

    if (!item) return res.status(404).json({ ok: false, message: "item not found" });

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

/* ================= RECORDS (디테일 CRUD) ================= */
// POST /api/items/:itemId/records
app.post(
  "/api/items/:itemId/records",
  requireAuth,
  asyncHandler(async (req, res) => {
    const itemId = Number(req.params.itemId);
    if (!Number.isFinite(itemId) || itemId <= 0) {
      return res.status(400).json({ ok: false, message: "invalid itemId" });
    }

    const item = await prisma.item.findFirst({
      where: { id: itemId, userId: req.userId },
      select: { id: true },
    });
    if (!item) return res.status(404).json({ ok: false, message: "item not found" });

    let normalized;
    try {
      normalized = normalizeRecordInput(req.body);
    } catch (e) {
      return res.status(400).json({ ok: false, message: String(e?.message || e) });
    }

    // OUT 재고 부족 체크
    if (normalized.type === "OUT") {
      const stockNow = await calcStock(req.userId, itemId);
      if (normalized.count > stockNow) {
        return res.status(400).json({
          ok: false,
          message: `재고 부족: 현재 재고(${stockNow})보다 많이 판매할 수 없습니다.`,
          stock: stockNow,
        });
      }
    }

    const { date, memo } = req.body;

    //  일반 create로 IN을 만들 때 purchaseId는 받지 않음(실수 방지)
    // 입고처리는 /api/purchases/:purchaseId/arrive 로만 처리하는게 안전
    const created = await prisma.record.create({
      data: {
        userId: req.userId,
        itemId,
        type: normalized.type,
        price: normalized.price,
        count: normalized.count,
        date: date ? new Date(date) : new Date(),
        memo: memo != null && String(memo).trim() !== "" ? String(memo) : null,
        purchaseId: null,
      },
      select: { id: true, itemId: true, type: true, price: true, count: true, date: true, memo: true, purchaseId: true },
    });

    const detail = await prisma.record.findMany({
      where: { userId: req.userId, itemId },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      select: { id: true, itemId: true, type: true, price: true, count: true, date: true, memo: true, purchaseId: true },
    });

    const { stock, pendingIn } = calcStockAndPending(detail);
    res.status(201).json({ ok: true, record: created, stock, pendingIn, records: detail });
  })
);

// PUT /api/items/:itemId/records
app.put(
  "/api/items/:itemId/records",
  requireAuth,
  asyncHandler(async (req, res) => {
    const itemId = Number(req.params.itemId);
    const id = Number(req.body?.id);

    if (!Number.isFinite(itemId) || itemId <= 0) {
      return res.status(400).json({ ok: false, message: "invalid itemId" });
    }
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "invalid record id" });
    }

    const existing = await prisma.record.findFirst({
      where: { id, itemId, userId: req.userId },
      select: { id: true, type: true, count: true, price: true, date: true, memo: true, purchaseId: true },
    });
    if (!existing) return res.status(404).json({ ok: false, message: "record not found" });

    const mergedBody = {
      type: req.body.type != null ? req.body.type : existing.type,
      count: req.body.count != null ? req.body.count : existing.count,
      price: req.body.price !== undefined ? req.body.price : existing.price,
    };

    let normalized;
    try {
      normalized = normalizeRecordInput(mergedBody);
    } catch (e) {
      return res.status(400).json({ ok: false, message: String(e?.message || e) });
    }

    // OUT 업데이트 재고 체크
    if (normalized.type === "OUT") {
      const stockNow = await calcStock(req.userId, itemId);
      const stockExcludingThis =
        String(existing.type).toUpperCase() === "OUT" ? stockNow + existing.count : stockNow;

      if (normalized.count > stockExcludingThis) {
        return res.status(400).json({
          ok: false,
          message: `재고 부족: 현재 재고(${stockExcludingThis})보다 많이 판매할 수 없습니다.`,
          stock: stockExcludingThis,
        });
      }
    }

    const nextPurchaseId = existing.purchaseId;

    const { date, memo } = req.body;

    const updated = await prisma.record.update({
      where: { id },
      data: {
        type: normalized.type,
        count: normalized.count,
        price: normalized.price,
        ...(date ? { date: new Date(date) } : {}),
        ...(memo !== undefined ? { memo: memo ? String(memo) : null } : {}),
        purchaseId: nextPurchaseId,
      },
      select: { id: true, itemId: true, type: true, price: true, count: true, date: true, memo: true, purchaseId: true },
    });

    const detail = await prisma.record.findMany({
      where: { userId: req.userId, itemId },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      select: { id: true, itemId: true, type: true, price: true, count: true, date: true, memo: true, purchaseId: true },
    });

    const { stock, pendingIn } = calcStockAndPending(detail);
    res.json({ ok: true, record: updated, stock, pendingIn, records: detail });
  })
);

// DELETE /api/items/:itemId/records?id=123
app.delete(
  "/api/items/:itemId/records",
  requireAuth,
  asyncHandler(async (req, res) => {
    const itemId = Number(req.params.itemId);
    const id = Number(req.query?.id);

    if (!Number.isFinite(itemId) || itemId <= 0) {
      return res.status(400).json({ ok: false, message: "invalid itemId" });
    }
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "invalid record id" });
    }

    const existing = await prisma.record.findFirst({
      where: { id, itemId, userId: req.userId },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ ok: false, message: "record not found" });

    await prisma.record.delete({ where: { id } });

    const detail = await prisma.record.findMany({
      where: { userId: req.userId, itemId },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      select: { id: true, itemId: true, type: true, price: true, count: true, date: true, memo: true, purchaseId: true },
    });

    const { stock, pendingIn } = calcStockAndPending(detail);
    res.json({ ok: true, stock, pendingIn, records: detail });
  })
);

/* ================= RECORDS LIST (입출고 페이지용) ================= */
// GET /api/records?type=IN|OUT|PURCHASE&priceMissing=1
app.get(
  "/api/records",
  requireAuth,
  asyncHandler(async (req, res) => {
    const type = String(req.query.type || "").toUpperCase();
    const priceMissing = String(req.query.priceMissing || "") === "1";

    const where = { userId: req.userId };

    if (type === "IN" || type === "OUT" || type === "PURCHASE") {
      where.type = type;
    }

    if (priceMissing) {
      where.price = null;
    }

    const records = await prisma.record.findMany({
      where,
      orderBy: [{ date: "desc" }, { id: "desc" }],
      include: {
        item: {
          select: { id: true, name: true, size: true, imageUrl: true, categoryId: true, barcode: true },
        },
      },
    });

    res.json({ ok: true, records });
  })
);

/* =================회원탈퇴================= */
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

    if (!user) return res.status(404).json({ ok: false, message: "user not found" });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ ok: false, message: "비밀번호가 올바르지 않습니다." });
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
