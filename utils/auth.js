import jwt from "jsonwebtoken";
import crypto from "crypto";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-key";

export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "none",
  path: "/",
};

export function createToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
}

export function getTokenFromReq(req) {
  return (
    req.cookies?.token ||
    (req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : null)
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export function makeRandomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

export function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function addHours(date, hours) {
  const d = new Date(date);
  d.setHours(d.getHours() + hours);
  return d;
}

export function requireAuth(req, res, next) {
  const token = getTokenFromReq(req);
  if (!token) {
    return res.status(401).json({ ok: false, reason: "NO_TOKEN" });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ ok: false, reason: "INVALID_TOKEN" });
  }

  req.userId = payload.userId;
  next();
}
