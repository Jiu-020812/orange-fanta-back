import express from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = express.Router();

// 특정 아이템의 기록 조회
router.get("/:itemId/records", async (req, res) => {
  try {
    const itemId = Number(req.params.itemId);

    const records = await prisma.record.findMany({
      where: {
        itemId,
        userId: req.userId,  // 🔥 로그인한 사용자 기록만
      },
      orderBy: { date: "desc" },
    });

    res.json(records);
  } catch (err) {
    console.error("❌ GET records 오류:", err);
    res.status(500).json({ message: "서버 오류" });
  }
});

// 기록 추가
router.post("/:itemId/records", async (req, res) => {
  try {
    const itemId = Number(req.params.itemId);
    const { price, count, date } = req.body;

    const record = await prisma.record.create({
      data: {
        itemId,
        price,
        count,
        date,
        userId: req.userId,  // 🔥 반드시 필요!
      },
    });

    res.status(201).json(record);
  } catch (err) {
    console.error("❌ POST record 오류:", err);
    res.status(500).json({ message: "서버 오류" });
  }
});

export default router;