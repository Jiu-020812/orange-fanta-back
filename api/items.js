import { PrismaClient } from "@prisma/client";

// Vercel 서버리스에서 커넥션 재사용(전역 1회)
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

/**
 *  임시 userId 추출(로그인 쿠키 방식 완성되면 여기만 갈아끼우면 됨)
 * - GET/DELETE: ?userId=1
 * - POST/PUT: body.userId
 * - 없으면 null(호환)
 */
function getUserId(req) {
  const qUserId = Number(req.query?.userId);
  if (Number.isFinite(qUserId) && qUserId > 0) return qUserId;

  const body = getBody(req);
  const bUserId = Number(body?.userId);
  if (Number.isFinite(bUserId) && bUserId > 0) return bUserId;

  return null;
}

function normCategory(c) {
  // schema: SHOE | FOOD
  if (c === "FOOD") return "FOOD";
  return "SHOE";
}

// /api/items
export default async function handler(req, res) {
  setCors(req, res);

  // 프리플라이트
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  const userId = getUserId(req);

  // ---------------- GET /api/items?userId=1&category=SHOE ----------------
  if (req.method === "GET") {
    try {
      const category = req.query?.category ? normCategory(req.query.category) : null;

      const items = await prisma.item.findMany({
        where: {
          ...(userId ? { userId } : {}),
          ...(category ? { category } : {}),
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });

      //  프론트 호환: 배열 그대로 반환
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
  // body: { userId?, name, size, imageUrl?, category?, legacyId?, memo? }
  if (req.method === "POST") {
    try {
      const body = getBody(req) || {};
      const { name, size, imageUrl, category, legacyId, memo } = body;

      if (!name || !size) {
        res.status(400).json({ ok: false, message: "name과 size는 필수입니다." });
        return;
      }

      const newItem = await prisma.item.create({
        data: {
          name: String(name),
          size: String(size),
          imageUrl: imageUrl ? String(imageUrl) : null,
          category: normCategory(category),
          legacyId: legacyId ? String(legacyId) : null,
          memo: memo != null ? String(memo) : null,
          ...(userId ? { userId } : {}),
        },
      });

      //  프론트 호환: item 객체 그대로 반환
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

  // ---------------- PUT /api/items ----------------
  // body: { userId?, id, name?, size?, imageUrl?, category?, legacyId?, memo? }
  //  옵션 수정/메모 저장에 필요
  if (req.method === "PUT") {
    try {
      const body = getBody(req) || {};
      const { id, name, size, imageUrl, category, legacyId, memo } = body;

      const numericId = Number(id);
      if (!numericId || Number.isNaN(numericId)) {
        res.status(400).json({ ok: false, message: "id가 잘못되었습니다." });
        return;
      }

      //  userId가 있으면 내 아이템만 수정되게 가드
      if (userId) {
        const exists = await prisma.item.findFirst({
          where: { id: numericId, userId },
          select: { id: true },
        });
        if (!exists) {
          res.status(404).json({ ok: false, message: "item을 찾을 수 없습니다." });
          return;
        }
      }

      const updated = await prisma.item.update({
        where: { id: numericId },
        data: {
          ...(name != null ? { name: String(name) } : {}),
          ...(size != null ? { size: String(size) } : {}),
          ...(imageUrl !== undefined ? { imageUrl: imageUrl ? String(imageUrl) : null } : {}),
          ...(category != null ? { category: normCategory(category) } : {}),
          ...(legacyId !== undefined ? { legacyId: legacyId ? String(legacyId) : null } : {}),
          ...(memo !== undefined ? { memo: memo != null && memo !== "" ? String(memo) : null } : {}),
        },
      });

      //  프론트 호환: item 객체 그대로 반환
      res.status(200).json(updated);
    } catch (err) {
      console.error("PUT /api/items error", err);
      res.status(500).json({
        ok: false,
        message: "서버 에러(PUT /api/items)",
        error: String(err?.message || err),
        code: err?.code || null,
      });
    }
    return;
  }

  // ---------------- DELETE /api/items?id=123&userId=1 ----------------
  if (req.method === "DELETE") {
    const id = Number(req.query.id);
    if (!id || Number.isNaN(id)) {
      res.status(400).json({ ok: false, message: "id 쿼리 파라미터가 필요합니다." });
      return;
    }

    try {
      // userId가 있으면 내 아이템만 삭제되게 가드
      if (userId) {
        const existing = await prisma.item.findFirst({
          where: { id, userId },
          select: { id: true },
        });
        if (!existing) {
          res.status(404).json({ ok: false, message: "item을 찾을 수 없습니다." });
          return;
        }
      }

      // 1) 먼저 이 아이템의 기록들 삭제
      await prisma.record.deleteMany({
        where: {
          itemId: id,
          ...(userId ? { userId } : {}),
        },
      });

      // 2) 아이템 삭제
      await prisma.item.delete({
        where: { id },
      });

      //  프론트 호환: 204
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

  res.setHeader("Allow", "GET,POST,PUT,DELETE,OPTIONS");
  res.status(405).end("Method Not Allowed");
}
