import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-key";
const COOKIE_NAME = "token";

// Vercel + 크로스 도메인용 쿠키 옵션
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,      // Vercel에서는 항상 true (https)
  sameSite: "none",  // 프론트/백 도메인이 달라서 필요
  path: "/",
};

// JWT 토큰 생성 함수
function createToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
}

// 요청에서 토큰 꺼내는 헬퍼 (쿠키 + Authorization 헤더 둘 다 지원)
function getTokenFromReq(req) {
  // 1) 쿠키 우선
  let token = req.cookies?.[COOKIE_NAME];

  // 2) 없으면 Authorization: Bearer xxx 에서 시도
  const authHeader = req.headers.authorization;
  if (!token && authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7); // "Bearer ".length === 7
  }

  return token;
}

/* --------------------------- SIGNUP --------------------------- */
// POST /api/auth/signup
router.post("/signup", async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "이메일과 비밀번호는 필수입니다." });
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

    // 쿠키 + 응답 JSON 둘 다로 토큰 전달
    res
      .cookie(COOKIE_NAME, token, COOKIE_OPTIONS)
      .status(201)
      .json({
        user: { id: user.id, email: user.email, name: user.name },
        token,
      });
  } catch (err) {
    console.error("❌ POST /api/auth/signup 에러:", err);
    res
      .status(500)
      .json({ message: "회원가입 중 서버 오류가 발생했습니다." });
  }
});

/* --------------------------- LOGIN --------------------------- */
// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res
        .status(401)
        .json({ message: "이메일 또는 비밀번호가 올바르지 않습니다." });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res
        .status(401)
        .json({ message: "이메일 또는 비밀번호가 올바르지 않습니다." });
    }

    const token = createToken(user.id);

    // 쿠키 + 응답 JSON 둘 다로 토큰 전달
    res
      .cookie(COOKIE_NAME, token, COOKIE_OPTIONS)
      .json({
        user: { id: user.id, email: user.email, name: user.name },
        token,
      });
  } catch (err) {
    console.error("❌ POST /api/auth/login 에러:", err);
    res
      .status(500)
      .json({ message: "로그인 중 서버 오류가 발생했습니다." });
  }
});

/* --------------------------- ME --------------------------- */
// GET /api/auth/me
router.get("/me", async (req, res) => {
  try {
    const token = getTokenFromReq(req);

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
    console.error("❌ GET /api/auth/me 에러:", err);
    res
      .status(401)
      .json({ message: "세션이 만료되었거나 잘못된 토큰입니다." });
  }
});

/* --------------------------- LOGOUT --------------------------- */
// POST /api/auth/logout
router.post("/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, {
    path: "/",
    secure: true,
    sameSite: "none",
  });
  res.json({ ok: true });
});

export default router;