import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { PrismaClient } from "@prisma/client";

const app = express();
const prisma = new PrismaClient();

// CORS 설정
app.use(
  cors({
    origin: "*", // Vercel에서는 * 또는 특정 도메인 허용 필요
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

// 서버 상태 체크
app.get("/", (req, res) => {
  res.json({ ok: true, message: "Backend running with Prisma DB (Vercel)" });
});

/* --------------------------- ITEMS --------------------------- */

// GET /api/items - 모든 상품 가져오기
app.get("/api/items", async (req, res) => {
  try {
    const items = await prisma.item.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    res.json(items);
  } catch (err) {
    console.error("GET /api/items error", err);
    res.status(500).json({ ok: false, message: "서버 에러" });
  }
});

// POST /api/items - 새로운 상품 생성
app.post("/api/items", async (req, res) => {
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
      },
    });

    res.status(201).json(newItem);
  } catch (err) {
    console.error("POST /api/items error", err);
    res.status(500).json({ ok: false, message: "서버 에러" });
  }
});

/* --------------------------- RECORDS --------------------------- */

// GET /api/items/:itemId/records
app.get("/api/items/:itemId/records", async (req, res) => {
  const itemId = Number(req.params.itemId);

  if (Number.isNaN(itemId)) {
    return res
      .status(400)
      .json({ ok: false, message: "itemId가 잘못되었습니다." });
  }

  try {
    const records = await prisma.record.findMany({
      where: { itemId },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    });
    res.json(records);
  } catch (err) {
    console.error("GET /api/items/:itemId/records error", err);
    res.status(500).json({ ok: false, message: "서버 에러" });
  }
});

// POST /api/items/:itemId/records
app.post("/api/items/:itemId/records", async (req, res) => {
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
        price: Number(price),
        count: count == null ? 1 : Number(count),
        date: date ? new Date(date) : new Date(),
      },
    });

    res.status(201).json(newRecord);
  } catch (err) {
    console.error("POST /api/items/:itemId/records error", err);
    res.status(500).json({ ok: false, message: "서버 에러" });
  }
});

/* --------------------------- VERCEL EXPORT --------------------------- */

export default app;