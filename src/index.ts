import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { PrismaClient } from "@prisma/client";

const app = express();
const prisma = new PrismaClient();

// 일단은 "나 혼자" 쓰는 기본 유저
const DEFAULT_USER_ID = 1;

app.use(
  cors({
    origin: "http://localhost:5173", // 프론트 dev 주소 (필요하면 5201로 변경)
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// 헬스체크
app.get("/", (req, res) => {
  res.json({ ok: true, message: "Backend running" });
});

app.get("/api/items", (req, res) => {
  res.json([
    { id: 1, name: "테스트 신발", size: "260" },
    { id: 2, name: "두번째 신발", size: "250" },
  ]);
});


//  ITEM API


// 모든 아이템 조회 (현재 유저 기준)
app.get("/items", async (req, res) => {
  try {
    const items = await prisma.item.findMany({
      where: { userId: DEFAULT_USER_ID },
      orderBy: { createdAt: "desc" },
    });
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch items" });
  }
});

// 아이템 하나 추가
app.post("/items", async (req, res) => {
  try {
    const { name, size, imageUrl } = req.body;

    if (!name || !size) {
      return res.status(400).json({ error: "name과 size는 필수입니다." });
    }

    const newItem = await prisma.item.create({
      data: {
        userId: DEFAULT_USER_ID,
        name,
        size,
        imageUrl: imageUrl || null,
      },
    });

    res.status(201).json(newItem);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create item" });
  }
});

// 아이템 삭제 (관련 기록이 있으면 에러 날 수 있음)
app.delete("/items/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "잘못된 id" });
    }

    await prisma.item.delete({
      where: { id },
    });

    res.status(204).send();
  } catch (err: any) {
    console.error(err);
    // 외래키 제약 등
    res.status(500).json({ error: "Failed to delete item" });
  }
});


//  RECORD API


// 특정 아이템의 기록 리스트 조회 ?itemId=123 형식
app.get("/records", async (req, res) => {
  try {
    const itemIdParam = req.query.itemId as string | undefined;

    const where: any = { userId: DEFAULT_USER_ID };
    if (itemIdParam) {
      const itemId = Number(itemIdParam);
      if (!Number.isNaN(itemId)) {
        where.itemId = itemId;
      }
    }

    const records = await prisma.record.findMany({
      where,
      orderBy: { date: "desc" },
    });

    res.json(records);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch records" });
  }
});

// 기록 추가
app.post("/records", async (req, res) => {
  try {
    const { itemId, price, count, date } = req.body;

    if (!itemId || !price || !count || !date) {
      return res
        .status(400)
        .json({ error: "itemId, price, count, date는 모두 필수입니다." });
    }

    const parsedItemId = Number(itemId);
    const parsedPrice = Number(price);
    const parsedCount = Number(count);
    const parsedDate = new Date(date);

    if (
      Number.isNaN(parsedItemId) ||
      Number.isNaN(parsedPrice) ||
      Number.isNaN(parsedCount) ||
      isNaN(parsedDate.getTime())
    ) {
      return res.status(400).json({ error: "숫자/날짜 형식이 잘못되었습니다." });
    }

    const newRecord = await prisma.record.create({
      data: {
        userId: DEFAULT_USER_ID,
        itemId: parsedItemId,
        price: parsedPrice,
        count: parsedCount,
        date: parsedDate,
      },
    });

    res.status(201).json(newRecord);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create record" });
  }
});

// 기록 삭제
app.delete("/records/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "잘못된 id" });
    }

    await prisma.record.delete({
      where: { id },
    });

    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete record" });
  }
});

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`🚀 Backend listening on http://localhost:${PORT}`);
});