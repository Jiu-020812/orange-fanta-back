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
    const origin = req.headers.origin || "";
  
    const isLocalhost = origin.startsWith("http://localhost");
    const isAllowedOrigin =
      ALLOWED_ORIGINS.includes(origin) || isLocalhost;
  
    if (origin && isAllowedOrigin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
  
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }

/**
 * TODO: 로그인 붙인 후 여기를 실제 유저 정보로 교체
 * 지금은 2세대 구조 테스트용으로 userId = 1 고정
 */
function getCurrentUserId(req) {
  // 나중에 쿠키/세션/토큰에서 꺼내 쓰도록 변경 예정
  // const userIdFromToken = ...
  // return userIdFromToken;

  return 1; // 임시
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  const method = req.method;
  const userId = getCurrentUserId(req);

  // ---------------- GET /api/records ----------------
  if (method === "GET") {
    const itemId = Number(req.query.itemId);

    if (!itemId || Number.isNaN(itemId)) {
      res
        .status(400)
        .json({ ok: false, message: "itemId 쿼리 파라미터가 필요합니다." });
      return;
    }

    try {
      const records = await prisma.record.findMany({
        where: {
          itemId,
          userId, // 🔹 해당 유저 + 해당 품목에 대한 기록만
        },
        orderBy: [
          { date: "asc" },
          { id: "asc" },
        ],
      });

      res.status(200).json(records);
    } catch (err) {
      console.error("GET /api/records error", err);
      res.status(500).json({
        ok: false,
        message: "서버 에러(GET /api/records)",
        error: String(err?.message || err),
        code: err?.code || null,
      });
    }
    return;
  }

  // ---------------- POST /api/records ----------------
  if (method === "POST") {
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
          userId, // 🔹 이 기록이 어느 유저 것인지 저장
        },
      });

      res.status(201).json(newRecord);
    } catch (err) {
      console.error("POST /api/records error", err);
      res.status(500).json({
        ok: false,
        message: "서버 에러(POST /api/records)",
        error: String(err?.message || err),
        code: err?.code || null,
      });
    }
    return;
  }

  res.setHeader("Allow", "GET,POST,OPTIONS");
  res.status(405).end("Method Not Allowed");
}