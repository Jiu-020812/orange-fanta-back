import { PrismaClient } from "@prisma/client";

// Vercel 서버리스에서 커넥션 재사용
let prisma;
if (!globalThis._prisma) {
  globalThis._prisma = new PrismaClient();
}
prisma = globalThis._prisma;

// CORS 허용 도메인
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
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(req, res);

  // 프리플라이트
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  // ---------------- GET /api/records?itemId=123 ----------------
  if (req.method === "GET") {
    const itemId = Number(req.query.itemId);

    if (!itemId || Number.isNaN(itemId)) {
      res
        .status(400)
        .json({ ok: false, message: "itemId 쿼리 파라미터가 필요합니다." });
      return;
    }

    try {
      const records = await prisma.record.findMany({
        where: { itemId },
        orderBy: [{ date: "asc" }, { id: "asc" }],
      });

      res.status(200).json(records);
    } catch (err) {
      console.error("GET /api/records error", err);
      res.status(500).json({
        ok: false,
        message: "서버 에러(GET /api/records)",
        error: String(err?.message || err),
      });
    }
    return;
  }

  // ---------------- POST /api/records ----------------
  if (req.method === "POST") {
    try {
      const { itemId, price, count, date } = req.body || {};

      const numericItemId = Number(itemId);
      if (!numericItemId || Number.isNaN(numericItemId)) {
        res
          .status(400)
          .json({ ok: false, message: "itemId가 잘못되었습니다." });
        return;
      }

      if (price == null) {
        res
          .status(400)
          .json({ ok: false, message: "price는 필수입니다." });
        return;
      }

      const newRecord = await prisma.record.create({
        data: {
          itemId: numericItemId,
          price: Number(price),
          count: count == null ? 1 : Number(count),
          date: date ? new Date(date) : new Date(),
        },
      });

      res.status(201).json(newRecord);
    } catch (err) {
      console.error("POST /api/records error", err);
      res.status(500).json({
        ok: false,
        message: "서버 에러(POST /api/records)",
        error: String(err?.message || err),
      });
    }
    return;
  }

  // ---------------- PUT /api/records ----------------
  // 프론트에서 updateRecord({ id, price, count, date }) 로 호출
  if (req.method === "PUT") {
    try {
      const { id, price, count, date } = req.body || {};
      const numericId = Number(id);

      if (!numericId || Number.isNaN(numericId)) {
        res.status(400).json({ ok: false, message: "id가 잘못되었습니다." });
        return;
      }

      const updated = await prisma.record.update({
        where: { id: numericId },
        data: {
          ...(price != null ? { price: Number(price) } : {}),
          ...(count != null ? { count: Number(count) } : {}),
          ...(date ? { date: new Date(date) } : {}),
        },
      });

      res.status(200).json(updated);
    } catch (err) {
      console.error("PUT /api/records error", err);
      res.status(500).json({
        ok: false,
        message: "서버 에러(PUT /api/records)",
        error: String(err?.message || err),
      });
    }
    return;
  }

  // ---------------- DELETE /api/records?id=123 ----------------
  if (req.method === "DELETE") {
    const id = Number(req.query.id);

    if (!id || Number.isNaN(id)) {
      res
        .status(400)
        .json({ ok: false, message: "id 쿼리 파라미터가 필요합니다." });
      return;
    }

    try {
      await prisma.record.delete({ where: { id } });
      res.status(204).end();
    } catch (err) {
      console.error("DELETE /api/records error", err);
      res.status(500).json({
        ok: false,
        message: "서버 에러(DELETE /api/records)",
        error: String(err?.message || err),
      });
    }
    return;
  }

  // 허용 안 된 메서드
  res.setHeader("Allow", "GET,POST,PUT,DELETE,OPTIONS");
  res.status(405).end("Method Not Allowed");
}