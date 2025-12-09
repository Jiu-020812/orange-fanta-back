import { PrismaClient } from "@prisma/client";

let prisma;
if (!globalThis.prisma) {
  globalThis.prisma = new PrismaClient();
}
prisma = globalThis.prisma;

const ALLOWED_ORIGINS = [
  "https://orange-fanta-one.vercel.app",
  "http://localhost:5173",
];

function setCors(req, res) {
  const origin = req.headers.origin ||"";

  
   // 로컬 환경이면 포트 상관없이 모두 허용 (http://localhost:*****)
   if (origin.startsWith("http://localhost")) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
 
   // 배포 환경에서는 기존 origin만 허용
   if (
    origin === "https://orange-fanta-one.vercel.app"
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

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
      res
        .status(500)
        .json({ ok: false, message: "서버 에러(GET /api/records)" });
    }
    return;
  }

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
      res
        .status(500)
        .json({ ok: false, message: "서버 에러(POST /api/records)" });
    }
    return;
  }
   // ---------------- PUT /api/records (기록 수정) ----------------
   if (req.method === "PUT") {
    try {
      const { id, price, count, date } = req.body || {};

      const numericId = Number(id);
      if (!numericId || Number.isNaN(numericId)) {
        res
          .status(400)
          .json({ ok: false, message: "id가 잘못되었습니다." });
        return;
      }

      const data = {};
      if (price != null) data.price = Number(price);
      if (count != null) data.count = Number(count);
      if (date) data.date = new Date(date);

      const updated = await prisma.record.update({
        where: { id: numericId },
        data,
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

  // ---------------- DELETE /api/records (기록 삭제) ----------------
  if (req.method === "DELETE") {
    const numericId = Number(req.query.id || req.body?.id);

    if (!numericId || Number.isNaN(numericId)) {
      res
        .status(400)
        .json({ ok: false, message: "id 쿼리 파라미터가 필요합니다." });
      return;
    }

    try {
      await prisma.record.delete({
        where: { id: numericId },
      });
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

  res.setHeader("Allow", "GET,POST,DELETE,OPTIONS");
  res.status(405).end("Method Not Allowed");
}