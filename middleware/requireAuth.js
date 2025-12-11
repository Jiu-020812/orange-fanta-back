import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-key";
const COOKIE_NAME = "token";

// authRoutes.js와 동일 로직
function getTokenFromReq(req) {
  let token = req.cookies?.[COOKIE_NAME];

  const authHeader = req.headers.authorization;
  if (!token && authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  }

  return token;
}

export function requireAuth(req, res, next) {
  try {
    const token = getTokenFromReq(req);

    if (!token) {
      return res.status(401).json({ message: "로그인이 필요합니다." });
    }

    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;

    next();
  } catch (err) {
    console.error("❌ requireAuth 에러:", err);
    return res
      .status(401)
      .json({ message: "세션이 만료되었거나 잘못된 토큰입니다." });
  }
}