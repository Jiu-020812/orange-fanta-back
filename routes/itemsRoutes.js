import express from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = express.Router();

// 아이템 목록 조회 (로그인 유저만)
router.get("/", async (req, res) => {
  try {
    const items = await prisma.item.findMany({
      where: { userId: req.userId },  // 🔥 로그인한 사용자 데이터만!
      orderBy: { createdAt: "desc" },
    });
    res.json(items);
  } catch (err) {
    console.error("❌ GET /items 오류:", err);
    res.status(500).json({ message: "서버 오류" });
  }
});

// 아이템 생성
router.post("/", async (req, res) => {
  try {
    const { name, size, imageUrl } = req.body;

    const item = await prisma.item.create({
      data: {
        name,
        size,
        imageUrl: imageUrl ?? null,
        userId: req.userId,  // 🔥 로그인한 사용자 ID 저장
      },
    });

    res.status(201).json(item);
  } catch (err) {
    console.error("❌ POST /items 오류:", err);
    res.status(500).json({ message: "서버 오류" });
  }
});

export default router;