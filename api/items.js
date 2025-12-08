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
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
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
    try {
      const items = await prisma.item.findMany({
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      res.status(200).json(items);
    } catch (err) {
      console.error("GET /api/items error", err);
      res
        .status(500)
        .json({ ok: false, message: "서버 에러(GET /api/items)" });
    }
    return;
  }

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
      res
        .status(500)
        .json({ ok: false, message: "서버 에러(POST /api/items)" });
    }
    return;
  }

  res.setHeader("Allow", "GET,POST,OPTIONS");
  res.status(405).end("Method Not Allowed");
}