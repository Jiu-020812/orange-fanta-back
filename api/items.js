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
  
    // 1) 로컬 개발 환경이면 (http://localhost:포트) 전부 허용
    const isLocalhost = origin.startsWith("http://localhost");
  
    // 2) 배포된 프론트 도메인은 ALLOWED_ORIGINS 화이트리스트로 허용
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
  // 예: 나중에 쿠키/세션/토큰에서 꺼내 쓰게 변경
  // const userIdFromToken = ...
  // return userIdFromToken;

  return 1; // 임시
}

// /api/items 엔드포인트
export default async function handler(req, res) {
  setCors(req, res);

  // 프리플라이트 요청
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  const method = req.method;

  // ---------------- 공통: 현재 유저 ----------------
  const userId = getCurrentUserId(req);

  // ---------------- GET /api/items ----------------
  if (method === "GET") {
    try {
      /**
       * 2세대 구조: 로그인 붙으면
       *   - where: { userId } 로 "내 아이템만" 조회
       * 지금은 userId = 1로 고정된 상태
       */
      const items = await prisma.item.findMany({
        where: {
          userId, // Prisma 스키마에 userId 없으면 이 줄은 잠시 주석 처리
        },
        orderBy: [
          { createdAt: "asc" },
          { id: "asc" },
        ],
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
  if (method === "POST") {
    try {
      const { name, size, imageUrl } = req.body || {};

      if (!name || !size) {
        res
          .status(400)
          .json({ ok: false, message: "name과 size는 필수입니다." });
        return;
      }

      /**
       * 2세대 구조: userId를 반드시 함께 저장
       * - Prisma 스키마에서:
       *    model Item {
       *      id      Int   @id @default(autoincrement())
       *      userId  Int
       *      user    User  @relation(fields: [userId], references: [id])
       *      ...
       *    }
       */
      const newItem = await prisma.item.create({
        data: {
          name,
          size,
          imageUrl: imageUrl || null,
          userId, // Prisma 스키마에 userId 없으면 이 줄은 잠시 주석 처리
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

  // 그 밖의 메서드는 허용 안 함
  res.setHeader("Allow", "GET,POST,OPTIONS");
  res.status(405).end("Method Not Allowed");
}