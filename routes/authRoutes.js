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
  secure: true,
  sameSite: "none",
  path: "/",
};

// JWT 토큰 생성
function createToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
}

// 요청에서 토큰 꺼내기 (쿠키 + Authorization 헤더)
function getTokenFromReq(req) {
  let token = req.cookies?.[COOKIE_NAME];

  const authHeader = req.headers.authorization;
  if (!token && authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7);
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
        .json({ ok: false, reason: "MISSING_FIELDS", message: "이메일과 비밀번호는 필수입니다." });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res
        .status(409)
        .json({ ok: false, reason: "DUPLICATE_EMAIL", message: "이미 존재하는 이메일입니다." });
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

    // ✅ 의도적으로 구조를 눈에 띄게 바꿔둠
    res
      .cookie(COOKIE_NAME, token, COOKIE_OPTIONS)
      .status(201)
      .json({
        ok: true,
        mode: "signup",
        user: { id: user.id, email: user.email, name: user.name },
        token,
      });
  } catch (err) {
    console.error("❌ POST /api/auth/signup 에러:", err);
    res
      .status(500)
      .json({ ok: false, reason: "SERVER_ERROR", message: "회원가입 중 서버 오류가 발생했습니다." });
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
        .json({ ok: false, reason: "INVALID_CREDENTIALS", message: "이메일 또는 비밀번호가 올바르지 않습니다." });
    }

    const okPassword = await bcrypt.compare(password, user.password);
    if (!okPassword) {
      return res
        .status(401)
        .json({ ok: false, reason: "INVALID_CREDENTIALS", message: "이메일 또는 비밀번호가 올바르지 않습니다." });
    }

    const token = createToken(user.id);

    res
      .cookie(COOKIE_NAME, token, COOKIE_OPTIONS)
      .json({
        ok: true,
        mode: "login",
        user: { id: user.id, email: user.email, name: user.name },
        token,
      });
  } catch (err) {
    console.error("❌ POST /api/auth/login 에러:", err);
    res
      .status(500)
      .json({ ok: false, reason: "SERVER_ERROR", message: "로그인 중 서버 오류가 발생했습니다." });
  }
});

/* --------------------------- ME --------------------------- */
// GET /api/auth/me
router.get("/me", async (req, res) => {
  try {
    const token = getTokenFromReq(req);

    if (!token) {
      return res
        .status(401)
        .json({ ok: false, reason: "NO_TOKEN", message: "로그인이 필요합니다." });
    }

    const payload = jwt.verify(token, JWT_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, name: true },
    });

    if (!user) {
      return res
        .status(401)
        .json({ ok: false, reason: "USER_NOT_FOUND", message: "사용자를 찾을 수 없습니다." });
    }

    res.json({ ok: true, user });
  } catch (err) {
    console.error("❌ GET /api/auth/me 에러:", err);
    res
      .status(401)
      .json({
        ok: false,
        reason: "INVALID_TOKEN",
        message: "세션이 만료되었거나 잘못된 토큰입니다.",
      });
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
  res.json({ ok: true, mode: "logout" });
});

export default router;