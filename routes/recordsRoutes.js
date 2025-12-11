import express from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = express.Router();

/* --------------------------- RECORDS --------------------------- */

// GET /api/items/:itemId/records
router.get("/:itemId/records", async (req, res) => {
  const itemId = Number(req.params.itemId);

  if (Number.isNaN(itemId)) {
    return res
      .status(400)
      .json({ ok: false, message: "itemId가 잘못되었습니다." });
  }

  try {
    const records = await prisma.record.findMany({
      where: {
        itemId,
        userId: req.userId, // 🔥 본인 데이터만
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    });
    res.status(200).json(records);
  } catch (err) {
    console.error("GET /api/items/:itemId/records error", err);
    res.status(500).json({
      ok: false,
      message: "서버 에러(GET /records)",
      error: String(err),
    });
  }
});

// POST /api/items/:itemId/records
router.post("/:itemId/records", async (req, res) => {
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
        userId: req.userId, // 🔥 로그인 유저 ID 저장
      },
    });

    res.status(201).json(newRecord);
  } catch (err) {
    console.error("POST /api/items/:itemId/records error", err);
    res.status(500).json({
      ok: false,
      message: "서버 에러(POST /records)",
      error: String(err),
    });
  }
});

export default router;