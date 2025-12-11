import express from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = express.Router();

/* --------------------------- ITEMS --------------------------- */

// GET /api/items - 로그인한 유저의 모든 상품 가져오기
router.get("/", async (req, res) => {
  try {
    const items = await prisma.item.findMany({
      where: { userId: req.userId }, // 🔥 로그인 유저 기준
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    res.status(200).json(items);
  } catch (err) {
    console.error("GET /api/items error", err);
    res.status(500).json({
      ok: false,
      message: "서버 에러(GET /api/items)",
      error: String(err),
    });
  }
});

// POST /api/items - 새로운 상품 생성
router.post("/", async (req, res) => {
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
        userId: req.userId, // 🔥 로그인 유저 ID 저장
      },
    });

    res.status(201).json(newItem);
  } catch (err) {
    console.error("POST /api/items error", err);
    res.status(500).json({
      ok: false,
      message: "서버 에러(POST /api/items)",
      error: String(err),
    });
  }
});

export default router;