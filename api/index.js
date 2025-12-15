import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const app = express();
const prisma = new PrismaClient();

// ================== 환경 변수 ==================
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-key";

// ================== CORS 설정 ==================
const allowedOrigins = [
  "https://orange-fanta-one.vercel.app", // 프론트 배포 주소
  "http://localhost:5173",
  "http://localhost:5175",
];

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
    res.header("Access-Control-Allow-Credentials", "true");
  }

  res.header(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS"
  );
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204); // preflight 여기서 끝
  }

  next();
});

// ================== 공통 미들웨어 ==================
app.use(express.json());
app.use(cookieParser());
app.use(express.json({ limit: "20mb" }));
app.use("/api/migrate/items-batch", itemsBatchHandler);
app.use("/api/migrate/records-batch", recordsBatchHandler);


// ================== 유틸 함수 ==================

// JWT 생성
function createToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
}

// 요청에서 토큰 꺼내기 (쿠키 + Authorization 헤더)
function getTokenFromReq(req) {
  let token = req.cookies?.token;

  const authHeader = req.headers.authorization;
  if (!token && authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  }

  return token;
}

// 인증 미들웨어
function requireAuth(req, res, next) {
  const token = getTokenFromReq(req);

  if (!token) {
    return res
      .status(401)
      .json({ ok: false, reason: "NO_TOKEN", message: "로그인이 필요합니다." });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (err) {
    console.error("requireAuth 에러:", err);
    return res.status(401).json({
      ok: false,
      reason: "INVALID_TOKEN",
      message: "세션이 만료되었거나 잘못된 토큰입니다.",
    });
  }
}

// ================== 헬스체크 ==================
app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Backend running (single-file api/index.js)",
  });
});

// ================== AUTH ==================

// 회원가입
// POST /api/auth/signup
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        ok: false,
        reason: "MISSING_FIELDS",
        message: "이메일과 비밀번호는 필수입니다.",
      });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({
        ok: false,
        reason: "DUPLICATE_EMAIL",
        message: "이미 존재하는 이메일입니다.",
      });
    }

    const hashed = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashed,
        name: name || null,
      },
    });

    const token = createToken(user.id);

    res
      .cookie("token", token, {
        httpOnly: true,
        secure: true, // Vercel는 https라 항상 true
        sameSite: "none",
        path: "/",
      })
      .status(201)
      .json({
        ok: true,
        mode: "signup",
        user: { id: user.id, email: user.email, name: user.name },
        token, // 👈 프론트에서 Authorization 헤더에 넣어 쓸 수 있도록 같이 내려줌
      });
  } catch (err) {
    console.error("POST /api/auth/signup 에러:", err);
    res.status(500).json({
      ok: false,
      reason: "SERVER_ERROR",
      message: "회원가입 중 서버 오류가 발생했습니다.",
    });
  }
});

// 로그인
// POST /api/auth/login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({
        ok: false,
        reason: "INVALID_CREDENTIALS",
        message: "이메일 또는 비밀번호가 올바르지 않습니다.",
      });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({
        ok: false,
        reason: "INVALID_CREDENTIALS",
        message: "이메일 또는 비밀번호가 올바르지 않습니다.",
      });
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
        mode: "login",
        user: { id: user.id, email: user.email, name: user.name },
        token, // 👈 여기도 token 같이 내려줌
      });
  } catch (err) {
    console.error("POST /api/auth/login 에러:", err);
    res.status(500).json({
      ok: false,
      reason: "SERVER_ERROR",
      message: "로그인 중 서버 오류가 발생했습니다.",
    });
  }
});

// 현재 유저 정보
// GET /api/auth/me
app.get("/api/auth/me", async (req, res) => {
  try {
    const token = getTokenFromReq(req);

    if (!token) {
      return res.status(401).json({
        ok: false,
        reason: "NO_TOKEN",
        message: "로그인이 필요합니다.",
      });
    }

    const payload = jwt.verify(token, JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, name: true },
    });

    if (!user) {
      return res.status(401).json({
        ok: false,
        reason: "USER_NOT_FOUND",
        message: "사용자를 찾을 수 없습니다.",
      });
    }

    res.json({ ok: true, user });
  } catch (err) {
    console.error("GET /api/auth/me 에러:", err);
    res.status(401).json({
      ok: false,
      reason: "INVALID_TOKEN",
      message: "세션이 만료되었거나 잘못된 토큰입니다.",
    });
  }
});

// 로그아웃
// POST /api/auth/logout
app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token", {
    path: "/",
    secure: true,
    sameSite: "none",
  });
  res.json({ ok: true, mode: "logout" });
});

// ================== ITEMS ==================

// GET /api/items
app.get("/api/items", requireAuth, async (req, res) => {
  try {
    // 로그인한 유저의 userId 는 requireAuth 가 넣어줌
    const userId = req.userId;

    const items = await prisma.item.findMany({
      where: { userId },             // ✅ 여기! OR / null 전부 삭제
      orderBy: [
        { createdAt: "asc" },
        { id: "asc" },
      ],
    });

    res.status(200).json(items);
  } catch (err) {
    console.error("GET /api/items error", err);
    res.status(500).json({
      ok: false,
      message: "서버 에러(GET /api/items)",
    });
  }
});

// POST /api/items
app.post("/api/items", requireAuth, async (req, res) => {
  try {
    const userId = req.userId;
    const { name, size, imageUrl } = req.body;

    if (!name || !size) {
      return res
        .status(400)
        .json({ ok: false, message: "name과 size는 필수입니다." });
    }

    const newItem = await prisma.item.create({
      data: {
        name,
        size,
        imageUrl: imageUrl || null,
        userId,                       //  이 유저에게 속한 아이템으로 저장
      },
    });

    res.status(201).json(newItem);
  } catch (err) {
    console.error("POST /api/items error", err);
    res.status(500).json({
      ok: false,
      message: "서버 에러(POST /api/items)",
    });
  }
});

// POST /api/items
app.post("/api/items", requireAuth, async (req, res) => {
  try {
    const { name, size, imageUrl } = req.body;

    if (!name || !size) {
      return res
        .status(400)
        .json({ ok: false, message: "name과 size는 필수입니다." });
    }

    const newItem = await prisma.item.create({
      data: {
        name,
        size,
        imageUrl: imageUrl || null,
        userId: req.userId,
      },
    });

    res.status(201).json(newItem);
  } catch (err) {
    console.error("POST /api/items error", err);
    res
      .status(500)
      .json({ ok: false, message: "서버 에러(POST /api/items)" });
  }
});

// ================== RECORDS ==================

// GET /api/items/:itemId/records
app.get("/api/items/:itemId/records", requireAuth, async (req, res) => {
  const itemId = Number(req.params.itemId);

  if (Number.isNaN(itemId)) {
    return res
      .status(400)
      .json({ ok: false, message: "itemId가 잘못되었습니다." });
  }

  try {
    // userId 가 없으면(where 에 undefined 넣으면) Prisma가 ValidationError 를 내서
    // 안전하게 조건을 나눠줌
    const where = { itemId };
    if (req.userId != null) {
      where.userId = req.userId;
    }

    const records = await prisma.record.findMany({
      where,
      orderBy: [{ date: "asc" }, { id: "asc" }],
    });

    return res.status(200).json(records);
  } catch (err) {
    console.error("GET /api/items/:itemId/records error", err);
    return res.status(500).json({
      ok: false,
      message: "서버 에러(GET /api/items/:itemId/records)",
    });
  }
});

// POST /api/items/:itemId/records
app.post("/api/items/:itemId/records", requireAuth, async (req, res) => {
  const itemId = Number(req.params.itemId);

  if (Number.isNaN(itemId)) {
    return res
      .status(400)
      .json({ ok: false, message: "itemId가 잘못되었습니다." });
  }

  try {
    const { price, count, date } = req.body || {};

    if (price == null) {
      return res
        .status(400)
        .json({ ok: false, message: "price는 필수입니다." });
    }

    const newRecord = await prisma.record.create({
      data: {
        itemId,
        userId: req.userId ?? null, // 스키마가 not null이면 req.userId 만 넣어도 됨
        price: Number(price),
        count: count == null ? 1 : Number(count),
        date: date ? new Date(date) : new Date(),
      },
    });

    return res.status(201).json(newRecord);
  } catch (err) {
    console.error("POST /api/items/:itemId/records error", err);
    return res.status(500).json({
      ok: false,
      message: "서버 에러(POST /api/items/:itemId/records)",
    });
  }
});

// ================== MIGRATION (IndexedDB → Server) ==================

// POST /api/migrate/indexeddb
app.post("/api/migrate/indexeddb", requireAuth, async (req, res) => {
  try {
    const data = req.body;

    if (!data?.stores) {
      return res.status(400).json({ message: "Invalid migration data" });
    }

    const { foods = [], foodRecords = [], shoes = [], records = [] } = data.stores;

    const itemIdMap = new Map(); // oldId -> newId

    // ---------- 1. FOODS ----------
    for (const item of foods) {
      const created = await prisma.item.create({
        data: {
          userId: req.userId,
          name: item.name,
          size: item.size ?? "",
          imageUrl: item.imageUrl ?? null,
          category: "FOOD",
          createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
        },
      });

      itemIdMap.set(item.id, created.id);
    }

    // ---------- 2. SHOES ----------
    for (const item of shoes) {
      const created = await prisma.item.create({
        data: {
          userId: req.userId,
          name: item.name,
          size: item.size ?? "",
          imageUrl: item.imageUrl ?? null,
          category: "SHOE",
          createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
        },
      });

      itemIdMap.set(item.id, created.id);
    }

    // ---------- 3. FOOD RECORDS ----------
    for (const r of foodRecords) {
      const newItemId = itemIdMap.get(r.itemId);
      if (!newItemId) continue;

      await prisma.record.create({
        data: {
          userId: req.userId,
          itemId: newItemId,
          price: Number(r.price),
          count: Number(r.count ?? 1),
          date: r.date ? new Date(r.date) : new Date(),
        },
      });
    }

    // ---------- 4. SHOE RECORDS ----------
    for (const r of records) {
      const newItemId = itemIdMap.get(r.itemId);
      if (!newItemId) continue;

      await prisma.record.create({
        data: {
          userId: req.userId,
          itemId: newItemId,
          price: Number(r.price),
          count: Number(r.count ?? 1),
          date: r.date ? new Date(r.date) : new Date(),
        },
      });
    }

    res.json({
      ok: true,
      summary: {
        foods: foods.length,
        shoes: shoes.length,
        foodRecords: foodRecords.length,
        records: records.length,
      },
    });
  } catch (err) {
    console.error("❌ MIGRATION ERROR", err);
    res.status(500).json({ message: "Migration failed" });
  }
});

// ================== Vercel용 export ==================
export default app;