import express from "express";
import cookieParser from "cookie-parser";
import { PrismaClient } from "@prisma/client";

import authRoutes from "./routes/authRoutes.js";
import { requireAuth } from "./middleware/requireAuth.js";
import itemsRoutes from "./routes/itemsRoutes.js";
import recordsRoutes from "./routes/recordsRoutes.js";

const app = express();
const prisma = new PrismaClient();

// ---------------- CORS 직접 처리 ----------------
const allowedOrigins = [
  "https://orange-fanta-one.vercel.app", // 프론트 배포 주소
  "http://localhost:5173",
  "http://localhost:5175",               // 로컬 개발용
];

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && allowedOrigins.includes(origin)) {
    // 어떤 origin에서 왔는지 그대로 허용
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
    res.header("Access-Control-Allow-Credentials", "true");
  }

  // 허용할 메서드 / 헤더
  res.header(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS"
  );
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  // 🔥 preflight 요청은 여기서 바로 끝내기
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

// --------------------------------------------------
// 공통 미들웨어
// --------------------------------------------------
app.use(express.json());
app.use(cookieParser());

// 헬스체크용
app.get("/", (req, res) => {
  res.json({ ok: true, message: "Backend running with Prisma + Supabase" });
});

// --------------------------------------------------
// 라우트 정의
// --------------------------------------------------

// 인증 (로그인/회원가입/로그아웃/내 정보)
app.use("/api/auth", authRoutes);

// 이후 라우트는 로그인 필요
app.use("/api/items", requireAuth, itemsRoutes);
// /api/items/:itemId/records
app.use("/api/items", requireAuth, recordsRoutes);

// Vercel용: Express 앱만 export
export default app;