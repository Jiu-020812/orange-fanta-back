function normRecordType(t) {
  const v = String(t ?? "").trim().toUpperCase();
  if (v === "IN" || v === "OUT" || v === "PURCHASE") return v;
  return null;
}

// 입력 정규화(규칙)
// - IN: price 무조건 null
// - PURCHASE: price 필수(>0)
// - OUT: price 선택(null 가능, 있으면 >=0)
function normalizeRecordInput(body) {
  const type = normRecordType(body?.type);
  if (!type) throw new Error("Invalid record type (IN/OUT/PURCHASE)");

  const countRaw = body?.count ?? 1;
  const countNum = Number(countRaw);
  const count = Math.max(1, Math.abs(Number.isFinite(countNum) ? countNum : 1));

  const rawPrice = body?.price;
  const price = rawPrice === "" || rawPrice == null ? null : Number(rawPrice);

  if (type === "IN") {
    return { type, count, price: null };
  }

  if (type === "PURCHASE") {
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error("PURCHASE requires price (>0)");
    }
    return { type, count, price: Math.floor(price) };
  }

  // OUT
  if (price === null) return { type, count, price: null };
  if (!Number.isFinite(price) || price < 0) throw new Error("Invalid price");
  return { type, count, price: Math.floor(price) };
}

function toYmd(v) {
  if (!v) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// stock = IN - OUT (PURCHASE는 재고에 반영 X)
// pendingIn = max(0, PURCHASE - IN)
//  (purchaseId 여부는 여기선 상관없음. pendingIn은 "매입 대비 입고" 개념)
function calcStockAndPending(records) {
  let stock = 0;
  let inSum = 0;
  let purchaseSum = 0;

  for (const r of records) {
    const c = Number(r.count ?? 0) || 0;
    const t = String(r.type || "").toUpperCase();
    if (t === "IN") {
      stock += c;
      inSum += c;
    } else if (t === "OUT") {
      stock -= c;
    } else if (t === "PURCHASE") {
      purchaseSum += c;
    }
  }

  return {
    stock,
    pendingIn: Math.max(0, purchaseSum - inSum),
  };
}

// 재고 계산(OUT 체크용) — DB에서 sum으로 계산
async function calcStock(prisma, userId, itemId) {
  const rows = await prisma.record.groupBy({
    by: ["type"],
    where: { userId, itemId },
    _sum: { count: true },
  });
  const inSum = rows.find((r) => r.type === "IN")?._sum.count ?? 0;
  const outSum = rows.find((r) => r.type === "OUT")?._sum.count ?? 0;
  return inSum - outSum;
}

export {
  normalizeRecordInput,
  toYmd,
  calcStockAndPending,
  calcStock,
};
