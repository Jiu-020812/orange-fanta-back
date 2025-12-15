import { PrismaClient } from "@prisma/client";

let prisma;
if (!globalThis._prisma) globalThis._prisma = new PrismaClient();
prisma = globalThis._prisma;

export default async function recordsBatchHandler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, message: "Method Not Allowed" });
  }

  try {
    const records = Array.isArray(req.body?.records) ? req.body.records : [];

    if (records.length === 0) {
      return res.json({ ok: true, inserted: 0, skipped: 0 });
    }

    // ⚠️ 여기서 핵심은 "레코드가 가리키는 로컬 item id(=shoeId)"를
    // 서버 Item.id로 바꿔서 저장해야 한다는 점
    // → 이 변환 로직은 네 기존 코드(items 넣을 때 legacyId 저장) 기준으로 작성해야 함

    // 지금은 "변환 로직 자리"만 정확히 만들어둘게:
    // records의 shoeId(=로컬 item id)와 userId/category로 Item을 찾아서 itemId로 매핑해야 함.

    const userId = records[0]?.userId; // migrate 호출에서 넣어주는 값 권장
    if (!userId) {
      return res.status(400).json({ ok: false, message: "userId is required in records" });
    }

    // 1) 필요한 legacyId 목록
    const legacyItemIds = [...new Set(records.map((r) => String(r.shoeId ?? r.itemLegacyId ?? "")))].filter(Boolean);

    // 2) 서버 아이템 조회 (legacyId → id 매핑)
    const items = await prisma.item.findMany({
      where: { userId, legacyId: { in: legacyItemIds } },
      select: { id: true, legacyId: true },
    });

    const map = new Map(items.map((it) => [it.legacyId, it.id]));

    // 3) 매핑된 것만 저장
    const data = records
      .map((r) => {
        const legacy = String(r.shoeId ?? r.itemLegacyId ?? "");
        const itemId = map.get(legacy);
        if (!itemId) return null;

        return {
          userId,
          itemId,
          price: Number(r.price),
          count: r.count == null ? 1 : Number(r.count),
          date: r.date ? new Date(r.date) : new Date(),
        };
      })
      .filter(Boolean);

    const result = await prisma.record.createMany({
      data,
      skipDuplicates: true,
    });

    return res.json({
      ok: true,
      inserted: result.count,
      received: records.length,
      sent: data.length,
      unmatched: records.length - data.length,
    });
  } catch (err) {
    console.error("migrate records error", err);
    return res.status(500).json({
      ok: false,
      message: "server error",
      error: String(err?.message || err),
    });
  }
}