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
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204); // preflight 여기서 끝
  }

  next();
});

// ================== 공통 미들웨어 ==================
app.use(express.json());
app.use(cookieParser());

// ================== 유틸 함수 ==================
function createToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
}

function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).json({ message: "로그인이 필요합니다." });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (err) {
    console.error("requireAuth 에러:", err);
    return res.status(401).json({ message: "세션이 만료되었거나 잘못된 토큰입니다." });
  }
}

// ================== 헬스체크 ==================
app.get("/", (req, res) => {
  res.json({ ok: true, message: "Backend running (single-file api/index.js)" });
});

// ================== AUTH ==================

// 회원가입
// POST /api/auth/signup
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "이메일과 비밀번호는 필수입니다." });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ message: "이미 존재하는 이메일입니다." });
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
        secure: process.env.NODE_ENV === "production",
        sameSite: "none",
        path: "/",
      })
      .status(201)
      .json({ id: user.id, email: user.email, name: user.name });
  } catch (err) {
    console.error("POST /api/auth/signup 에러:", err);
    res.status(500).json({ message: "회원가입 중 서버 오류가 발생했습니다." });
  }
});

// 로그인
// POST /api/auth/login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ message: "이메일 또는 비밀번호가 올바르지 않습니다." });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ message: "이메일 또는 비밀번호가 올바르지 않습니다." });
    }

    const token = createToken(user.id);
    res
      .cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "none",
        path: "/",
      })
      .json({ id: user.id, email: user.email, name: user.name });
  } catch (err) {
    console.error("POST /api/auth/login 에러:", err);
    res.status(500).json({ message: "로그인 중 서버 오류가 발생했습니다." });
  }
});

// 현재 유저 정보
// GET /api/auth/me
app.get("/api/auth/me", async (req, res) => {
  try {
    const token = req.cookies?.token;
    if (!token) {
      return res.status(401).json({ message: "로그인이 필요합니다." });
    }
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, name: true },
    });
    if (!user) {
      return res.status(401).json({ message: "사용자를 찾을 수 없습니다." });
    }
    res.json(user);
  } catch (err) {
    console.error("GET /api/auth/me 에러:", err);
    res.status(401).json({ message: "세션이 만료되었거나 잘못된 토큰입니다." });
  }
});

// 로그아웃
// POST /api/auth/logout
app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token", { path: "/" });
  res.json({ ok: true });
});

// ================== ITEMS ==================

// GET /api/items
app.get("/api/items", requireAuth, async (req, res) => {
  try {
    const items = await prisma.item.findMany({
      where: { userId: req.userId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    res.status(200).json(items);
  } catch (err) {
    console.error("GET /api/items error", err);
    res.status(500).json({ ok: false, message: "서버 에러(GET /api/items)" });
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
    res.status(500).json({ ok: false, message: "서버 에러(POST /api/items)" });
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
    const records = await prisma.record.findMany({
      where: { itemId, userId: req.userId },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    });
    res.status(200).json(records);
  } catch (err) {
    console.error("GET /api/items/:itemId/records error", err);
    res.status(500).json({
      ok: false,
      message: "서버 에러(GET /records)",
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
    const { price, count, date } = req.body;

    if (price == null) {
      return res
        .status(400)
        .json({ ok: false, message: "price는 필수입니다." });
    }

    const newRecord = await prisma.record.create({
      data: {
        itemId,
        userId: req.userId,
        price: Number(price),
        count: count == null ? 1 : Number(count),
        date: date ? new Date(date) : new Date(),
      },
    });

    res.status(201).json(newRecord);
  } catch (err) {
    console.error("POST /api/items/:itemId/records error", err);
    res.status(500).json({
      ok: false,
      message: "서버 에러(POST /records)",
    });
  }
});

// ================== Vercel용 export ==================
export default app;