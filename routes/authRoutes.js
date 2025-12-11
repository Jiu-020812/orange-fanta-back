import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

// 쿠키를 읽기 위해 필요 (app.js/server.js에서 한 번만 써도 됨)
router.use(cookieParser());

// JWT 만들기
function createToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// 쿠키 옵션
const cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

// 회원가입
router.post("/signup", async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "email과 password는 필수입니다." });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ message: "이미 존재하는 이메일입니다." });
    }

    const hashed = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: { email, password: hashed, name },
    });

    const token = createToken(user.id);
    res
      .cookie("token", token, cookieOptions)
      .status(201)
      .json({
        id: user.id,
        email: user.email,
        name: user.name,
      });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ message: "서버 오류" });
  }
});

// 로그인
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "email과 password는 필수입니다." });
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(401).json({ message: "이메일 또는 비밀번호가 올바르지 않습니다." });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ message: "이메일 또는 비밀번호가 올바르지 않습니다." });
    }

    const token = createToken(user.id);
    res
      .cookie("token", token, cookieOptions)
      .status(200)
      .json({
        id: user.id,
        email: user.email,
        name: user.name,
      });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "서버 오류" });
  }
});

// 내 정보 확인
router.get("/me", async (req, res) => {
  try {
    const token = req.cookies?.token;
    if (!token) {
      return res.status(401).json({ message: "로그인 필요" });
    }

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ message: "토큰이 유효하지 않습니다." });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, name: true },
    });

    if (!user) {
      return res.status(401).json({ message: "사용자를 찾을 수 없습니다." });
    }

    res.json(user);
  } catch (err) {
    console.error("Me error:", err);
    res.status(500).json({ message: "서버 오류" });
  }
});

// 로그아웃
router.post("/logout", (req, res) => {
  res
    .clearCookie("token", { path: "/" })
    .status(200)
    .json({ message: "로그아웃 완료" });
});

export default router;