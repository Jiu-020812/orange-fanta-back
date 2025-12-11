import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { PrismaClient } from "@prisma/client";

import authRoutes from "./routes/authRoutes.js";
import { requireAuth } from "./middleware/requireAuth.js";
import itemsRoutes from "./routes/itemsRoutes.js";
import recordsRoutes from "./routes/recordsRoutes.js";

const app = express();
const prisma = new PrismaClient();

// ---------------- CORS 설정 ----------------
const allowedOrigins = [
  "https://orange-fanta-one.vercel.app", // 프론트 배포 주소
  "http://localhost:5173",
  "http://localhost:5175",               // 로컬 개발용
];

const corsOptions = {
  origin(origin, callback) {
    // origin 이 없는 경우 (예: Postman)은 허용
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"), false);
  },
  credentials: true, // 쿠키 허용
};

// 🔥 모든 요청에 CORS 적용
app.use(cors(corsOptions));
// 🔥 preflight(OPTIONS) 요청도 CORS 통과
app.options("*", cors(corsOptions));

app.use(express.json());
app.use(cookieParser());

// 헬스체크용
app.get("/", (req, res) => {
  res.json({ ok: true, message: "Backend running with Prisma + Supabase" });
});

// 인증 라우트
app.use("/api/auth", authRoutes);

// 이후 라우트는 로그인 필요
app.use("/api/items", requireAuth, itemsRoutes);
// /api/items/:itemId/records → recordsRoutes 에서 처리
app.use("/api/items", requireAuth, recordsRoutes);

// Vercel용: Express 앱만 export
export default app;