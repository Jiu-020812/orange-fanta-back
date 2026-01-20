import { PrismaClient } from "@prisma/client";

// Vercel 서버리스에서 커넥션 재사용
let prisma;
if (!globalThis._prisma) {
  globalThis._prisma = new PrismaClient();
}
prisma = globalThis._prisma;

// CORS 허용 도메인
const ALLOWED_ORIGINS = [
  "https://myinvetory.com",
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

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function getBody(req) {
  return typeof req.body === "string" ? safeJson(req.body) : req.body;
}

// userId 임시 호환: body.userId 또는 query.userId (없어도 동작하게 둠)
function getUserId(req) {
  const q = Number(req.query?.userId);
  if (Number.isFinite(q) && q > 0) return q;

  const body = getBody(req);
  const b = Number(body?.userId);
  if (Number.isFinite(b) && b > 0) return b;

  return null;
}

function normType(t) {
  return t === "OUT" ? "OUT" : "IN";
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  // ---------------- GET /api/records?itemId=123(&userId=1) ----------------
  if (req.method === "GET") {
    const itemId = Number(req.query.itemId);
    const userId = getUserId(req);

    if (!itemId || Number.isNaN(itemId)) {
      res.status(400).json({ ok: false, message: "itemId 쿼리 파라미터가 필요합니다." });
      return;
    }

    try {
      const records = await prisma.record.findMany({
        where: {
          itemId,
          ...(userId ? { userId } : {}), //  userId 있으면 필터, 없으면 기존처럼
        },
        orderBy: [{ date: "asc" }, { id: "asc" }],
      });

      //  프론트 호환: 기존처럼 배열만 반환
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
  // body: { itemId, price, count, date, type(IN|OUT), memo, userId? }
  if (req.method === "POST") {
    try {
      const body = getBody(req) || {};
      const { itemId, price, count, date, type, memo } = body;
      const userId = getUserId(req);

      const numericItemId = Number(itemId);
      if (!numericItemId || Number.isNaN(numericItemId)) {
        res.status(400).json({ ok: false, message: "itemId가 잘못되었습니다." });
        return;
      }

      if (price == null) {
        res.status(400).json({ ok: false, message: "price는 필수입니다." });
        return;
      }

      const numericCount = count == null ? 1 : Number(count);
      if (!Number.isFinite(numericCount) || numericCount <= 0) {
        res.status(400).json({ ok: false, message: "count가 잘못되었습니다." });
        return;
      }

      const recordType = normType(type);

      const newRecord = await prisma.record.create({
        data: {
          itemId: numericItemId,
          //  schema에 userId가 "필수"면 여기서 userId 없으면 에러가 날 거야.
          ...(userId ? { userId } : {}),
          type: recordType,                 // 판매 핵심
          memo: memo ? String(memo) : null,  // 메모
          price: Number(price),
          count: numericCount,
          date: date ? new Date(date) : new Date(),
        },
      });

      //  프론트 호환: record 객체 그대로 반환
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
  // body: { id, price?, count?, date?, type?, memo?, userId? }
  if (req.method === "PUT") {
    try {
      const body = getBody(req) || {};
      const { id, price, count, date, type, memo } = body;
      const userId = getUserId(req);

      const numericId = Number(id);
      if (!numericId || Number.isNaN(numericId)) {
        res.status(400).json({ ok: false, message: "id가 잘못되었습니다." });
        return;
      }

      //  userId 있으면 본인 레코드만 수정되게 가드
      if (userId) {
        const exists = await prisma.record.findFirst({ where: { id: numericId, userId } });
        if (!exists) {
          res.status(404).json({ ok: false, message: "record를 찾을 수 없습니다." });
          return;
        }
      }

      const updated = await prisma.record.update({
        where: { id: numericId },
        data: {
          ...(type != null ? { type: normType(type) } : {}),
          ...(memo != null ? { memo: memo ? String(memo) : null } : {}),
          ...(price != null ? { price: Number(price) } : {}),
          ...(count != null ? { count: Number(count) } : {}),
          ...(date ? { date: new Date(date) } : {}),
        },
      });

      //  프론트 호환: record 객체 그대로 반환
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

  // ---------------- DELETE /api/records?id=123(&userId=1) ----------------
  if (req.method === "DELETE") {
    const id = Number(req.query.id);
    const userId = getUserId(req);

    if (!id || Number.isNaN(id)) {
      res.status(400).json({ ok: false, message: "id 쿼리 파라미터가 필요합니다." });
      return;
    }

    try {
      //  userId 있으면 본인 레코드만 삭제되게 가드
      if (userId) {
        const exists = await prisma.record.findFirst({ where: { id, userId } });
        if (!exists) {
          res.status(404).json({ ok: false, message: "record를 찾을 수 없습니다." });
          return;
        }
      }

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

  res.setHeader("Allow", "GET,POST,PUT,DELETE,OPTIONS");
  res.status(405).end("Method Not Allowed");
}
