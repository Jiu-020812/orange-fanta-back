import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

import authRoutes from "./routes/authRoutes.js";
import itemsRoutes from "./routes/itemsRoutes.js";
import recordsRoutes from "./routes/recordsRoutes.js";
import { requireAuth } from "./middleware/requireAuth.js";

// ----------------------------------
// 기본 설정
// ----------------------------------
const app = express();
const prisma = new PrismaClient();

// body 파서
app.use(express.json());
app.use(cookieParser());

// ----------------------------------
// CORS 설정
// ----------------------------------
app.use(
  cors({
    origin: [
      "https://orange-fanta-one.vercel.app", // 프론트 배포 주소
      "http://localhost:5173",
      "http://localhost:5175",
    ],
    credentials: true,
  })
);

// ----------------------------------
// 1) 인증 API
// ----------------------------------
app.use("/api/auth", authRoutes);

// ----------------------------------
// 2) 보호된 API (로그인 필요)
// ----------------------------------
app.use("/api/items", requireAuth, itemsRoutes);
app.use("/api/records", requireAuth, recordsRoutes);

// ----------------------------------
// 헬스체크
// ----------------------------------
app.get("/", (req, res) => {
  res.json({ ok: true, message: "Backend running on Vercel" });
});

// ----------------------------------
// Vercel Serverless Adapter
// ----------------------------------
export const config = {
  api: {
    bodyParser: false,
  },
};

// serverless-http 없이 Express 직접 실행 가능
export default function handler(req, res) {
  return app(req, res);
}