import { PrismaClient } from "@prisma/client";

let prisma;
if (!globalThis._prisma) globalThis._prisma = new PrismaClient();
prisma = globalThis._prisma;

export default async function itemsBatchHandler(req, res) {
  // POST만 허용
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, message: "Method Not Allowed" });
  }

  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    if (items.length === 0) {
      return res.json({ ok: true, inserted: 0, skipped: 0 });
    }

    // 여기서 req.userId를 쓰고 싶으면 (requireAuth를 앞에서 붙였을 때) 가능
    // 지금은 서버쪽에서 이미 userId 넣는 로직이 있다 가정하고 그대로 받음.

    const data = items.map((it) => ({
      userId: it.userId,               //  migrate 코드에서 넣어줘야 함
      name: it.name ?? "",
      size: it.size ?? "",
      imageUrl: it.imageUrl ?? null,
      category: it.category ?? "FOOD", // 없으면 기본 FOOD(원하면 SHOE)
      legacyId: String(it.legacyId ?? it.id ?? ""), // 문자열로 저장
      createdAt: it.createdAt ? new Date(it.createdAt) : new Date(),
    })).filter((x) => x.userId && x.name && x.size && x.legacyId); // 최소 조건

    // 중복(같은 userId/category/legacyId)이면 스킵
    const result = await prisma.item.createMany({
      data,
      skipDuplicates: true,
    });

    return res.json({
      ok: true,
      inserted: result.count,
      received: items.length,
      sent: data.length,
    });
  } catch (err) {
    console.error("migrate items error", err);
    return res.status(500).json({
      ok: false,
      message: "server error",
      error: String(err?.message || err),
    });
  }
}
