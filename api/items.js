import { PrismaClient } from "@prisma/client";

// Vercel 서버리스에서 커넥션 재사용을 위해 전역에 한 번만 생성
let prisma;
if (!globalThis._prisma) {
  globalThis._prisma = new PrismaClient();
}
prisma = globalThis._prisma;

const ALLOWED_ORIGINS = [
  "https://orange-fanta-one.vercel.app",
  "http://localhost:5173",
  "http://localhost:5175",
];

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  // 🔹 DELETE까지 포함
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// /api/items 엔드포인트
export default async function handler(req, res) {
  setCors(req, res);

  // 프리플라이트 요청
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  // ---------------- GET /api/items ----------------
  if (req.method === "GET") {
    try {
      const items = await prisma.item.findMany({
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      res.status(200).json(items);
    } catch (err) {
      console.error("GET /api/items error", err);
      res.status(500).json({
        ok: false,
        message: "서버 에러(GET /api/items)",
        error: String(err?.message || err),
        code: err?.code || null,
      });
    }
    return;
  }

  // ---------------- POST /api/items ----------------
  if (req.method === "POST") {
    try {
      const { name, size, imageUrl } = req.body || {};

      if (!name || !size) {
        res
          .status(400)
          .json({ ok: false, message: "name과 size는 필수입니다." });
        return;
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
      res.status(500).json({
        ok: false,
        message: "서버 에러(POST /api/items)",
        error: String(err?.message || err),
        code: err?.code || null,
      });
    }
    return;
  }

  // ---------------- DELETE /api/items?id=123 ----------------
  if (req.method === "DELETE") {
    const id = Number(req.query.id);
    if (!id || Number.isNaN(id)) {
      res
        .status(400)
        .json({ ok: false, message: "id 쿼리 파라미터가 필요합니다." });
      return;
    }

    try {
      // 1) 먼저 이 아이템의 기록들 삭제
      await prisma.record.deleteMany({
        where: { itemId: id },
      });

      // 2) 아이템 삭제
      await prisma.item.delete({
        where: { id },
      });

      res.status(204).end();
    } catch (err) {
      console.error("DELETE /api/items error", err);
      res.status(500).json({
        ok: false,
        message: "서버 에러(DELETE /api/items)",
        error: String(err?.message || err),
      });
    }
    return;
  }

  // 그 밖의 메서드는 허용 안 함
  res.setHeader("Allow", "GET,POST,DELETE,OPTIONS");
  res.status(405).end("Method Not Allowed");
}