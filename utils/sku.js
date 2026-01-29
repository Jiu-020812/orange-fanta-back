import crypto from "crypto";

function formatDateYmd(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function randomToken(length = 6) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

function makeSku(prefix = "BH") {
  const date = formatDateYmd();
  return `${prefix}-${date}-${randomToken(6)}`;
}

async function generateUniqueSku({ prisma, userId, prefix = "BH", maxAttempts = 5 }) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const sku = makeSku(prefix);
    const exists = await prisma.item.findFirst({
      where: { userId, sku },
      select: { id: true },
    });
    if (!exists) return sku;
  }

  throw new Error("Failed to generate unique SKU");
}

export { makeSku, generateUniqueSku };
