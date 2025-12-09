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
];

const FIXED_USER_ID = 1; // TODO: 로그인 붙이면 실제 로그인 유저 ID로 교체

function setCors(req, res) {
  const origin = req.headers.origin || "";

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
        where: { userId: FIXED_USER_ID },
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
          userId: FIXED_USER_ID,
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

  // 그 밖의 메서드는 허용 안 함
  res.setHeader("Allow", "GET,POST,OPTIONS");
  res.status(405).end("Method Not Allowed");
}