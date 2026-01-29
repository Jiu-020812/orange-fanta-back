import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import crypto from "crypto";
import { Resend } from "resend";

import itemsBatchHandler from "./migrate/items-batch.js";
import recordsBatchHandler from "./migrate/records-batch.js";
import meRouter from "../routes/me.js";
import createCategoriesRouter from "./routes/categories.js";
import createItemsRouter from "./routes/items.js";
import createRecordsRouter from "./routes/records.js";
import createAdminRouter from "./routes/admin.js";
import {
  normalizeRecordInput,
  toYmd,
  calcStockAndPending,
  calcStock,
} from "./utils/records.js";

const app = express();

/* ================= ENV ================= */
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-key";

const allowedOrigins = [
  "https://myinvetory.com",
  "http://localhost:5173",
  "http://localhost:5175",
];

/* ================= UTILS ================= */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);


/* ================= CORS ================= */
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/* ================= COMMON ================= */
app.use(cookieParser());
app.use(express.json({ limit: "20mb" }));

/* ===================== 인증 유틸 ===================== */
function makeRandomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function addHours(date, hours) {
  const d = new Date(date);
  d.setHours(d.getHours() + hours);
  return d;
}


const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

async function sendVerifyEmail({ to, link }) {
  if (!resend) {
    console.log("[MAIL SKIP] RESEND_API_KEY missing. Link:", link);
    return;
  }

  const from = process.env.MAIL_FROM || "onboarding@resend.dev";

  await resend.emails.send({
    from,
    to,
    subject: "이메일 인증을 완료해 주세요",
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5">
        <h2>이메일 인증</h2>
        <p>아래 버튼을 눌러 이메일 인증을 완료해 주세요.</p>
        <p>
          <a href="${link}"
             style="display:inline-block;padding:10px 14px;border-radius:10px;
                    background:#111827;color:#fff;text-decoration:none">
            이메일 인증하기
          </a>
        </p>
        <p style="color:#6b7280;font-size:13px">
          버튼이 안 되면 아래 링크를 복사해서 브라우저에 붙여넣어 주세요.<br/>
          ${link}
        </p>
      </div>
    `,
  });
}
/* ================= AUTH ================= */
const createToken = (userId) =>
  jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });

const getTokenFromReq = (req) =>
  req.cookies?.token ||
  (req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : null);

const requireAuth = (req, res, next) => {
  const token = getTokenFromReq(req);
  if (!token) {
    return res.status(401).json({ ok: false, reason: "NO_TOKEN" });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ ok: false, reason: "INVALID_TOKEN" });
  }
};

/* ================= HELLO ================= */
app.get("/", (req, res) => {
  res.json({ ok: true, message: "Backend running" });
});

/* ================= ROUTERS (기존 유지) ================= */
app.use("/api/me", meRouter);

/* ================= MIGRATE (기존 유지) ================= */
app.use("/api/migrate/items-batch", itemsBatchHandler);
app.use("/api/migrate/records-batch", recordsBatchHandler);

/* ================= AUTH API ================= */
app.post(
  "/api/auth/signup",
  asyncHandler(async (req, res) => {
    const { email, password, name } = req.body;

    const e = String(email ?? "").trim();
    const p = String(password ?? "");
    const n = String(name ?? "").trim();

    if (!e || !p) {
      return res.status(400).json({ ok: false, message: "email/password required" });
    }
    if (p.length < 8) {
      return res.status(400).json({ ok: false, message: "password must be at least 8 chars" });
    }

    const exists = await prisma.user.findUnique({ where: { email: e } });
    if (exists) {
      return res.status(409).json({ ok: false, message: "이미 존재하는 이메일입니다." });
    }

    const hashed = await bcrypt.hash(p, 10);

    const user = await prisma.user.create({
      data: { email: e, password: hashed, name: n || null },
      select: { id: true, email: true, name: true, emailVerified: true },
    });

    const rawToken = makeRandomToken(32);
    const tokenHash = sha256(rawToken);

    await prisma.emailVerifyToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: addHours(new Date(), 24),
      },
    });

    const apiOrigin = process.env.API_ORIGIN || `https://${req.headers.host}`;
    const link = `${apiOrigin}/api/auth/verify?token=${rawToken}`;

    await sendVerifyEmail({ to: user.email, link });
   console.log("[VERIFY SENT]", user.email);
    return res.status(201).json({
      ok: true,
      message: "회원가입 완료. 이메일 인증을 진행해주세요.",
      devVerifyLink: process.env.NODE_ENV !== "production" ? link : undefined,
      user: { id: user.id, email: user.email, name: user.name, emailVerified: user.emailVerified },
    });
  })
);

app.get(
  "/api/auth/verify",
  asyncHandler(async (req, res) => {
    const token = String(req.query.token || "");
    if (!token) return res.status(400).send("Missing token");

    const tokenHash = sha256(token);

    const row = await prisma.emailVerifyToken.findUnique({
      where: { tokenHash },
      select: { userId: true, expiresAt: true },
    });

    if (!row) return res.status(400).send("Invalid token");
    if (row.expiresAt < new Date()) return res.status(400).send("Token expired");

    await prisma.$transaction([
      prisma.user.update({
        where: { id: row.userId },
        data: { emailVerified: true },
      }),
      prisma.emailVerifyToken.delete({ where: { tokenHash } }),
    ]);


    // 2) 프론트 로그인 페이지로 보내고 싶으면 redirect
    const appOrigin = process.env.APP_ORIGIN || "http://localhost:5173";
    return res.redirect(`${appOrigin}/login?verified=1`);
  })
);


app.post(
  "/api/auth/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    const e = String(email ?? "").trim();
    const p = String(password ?? "");
    if (!e || !p) return res.status(400).json({ ok: false });

    const user = await prisma.user.findUnique({ where: { email: e } });
    if (!user) {
      console.warn("[AUTH] login failed: user not found", { email: e });
      return res
        .status(401)
        .json({ ok: false, message: "이메일 또는 비밀번호 오류" });
    }

    const ok = await bcrypt.compare(p, user.password);
    if (!ok) {
      console.warn("[AUTH] login failed: password mismatch", { email: e });
      return res
        .status(401)
        .json({ ok: false, message: "이메일 또는 비밀번호 오류" });
    }

    if (!user.emailVerified) {
      return res.status(403).json({ ok: false, message: "이메일 인증이 필요합니다." });
    }
    

    const token = createToken(user.id);

    res
      .cookie("token", token, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/",
      })
      .json({
        ok: true,
        user: { id: user.id, email: user.email, name: user.name },
      });
  })
);

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token", { path: "/", secure: true, sameSite: "none" });
  res.json({ ok: true });
});

app.get(
  "/api/auth/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, email: true, name: true },
    });
    if (!user) return res.status(404).json({ ok: false });
    res.json({ ok: true, user });
  })
);
// POST /api/auth/resend-verify
app.post(
  "/api/auth/resend-verify",
  asyncHandler(async (req, res) => {
    const email = String(req.body?.email ?? "").trim();
    if (!email) return res.status(400).json({ ok: false, message: "email required" });

    // 보안상: 존재 여부/인증 여부를 자세히 말하지 않고 ok로 통일(선택)
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, emailVerified: true },
    });
    if (!user) return res.json({ ok: true });

    if (user.emailVerified) return res.json({ ok: true });

    // 기존 토큰 삭제 후 재발급
    await prisma.emailVerifyToken.deleteMany({ where: { userId: user.id } });

    const rawToken = makeRandomToken(32);
    const tokenHash = sha256(rawToken);
    const expiresAt = addHours(new Date(), 24);

    await prisma.emailVerifyToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    const apiOrigin = process.env.API_ORIGIN || `https://${req.headers.host}`;
    const link = `${apiOrigin}/api/auth/verify?token=${rawToken}`;

    await sendVerifyEmail({ to: user.email, link });

    res.json({ ok: true });
  })
);

/* ================= FORGOT PASSWORD =================
 * POST /api/auth/forgot-password
 * body: { email }
 *
 * - 보안: 이메일 존재 여부는 숨김(항상 ok:true 형태로 응답)
 * - 이메일 인증 안 된 계정은 "인증 먼저" 안내(그래도 ok:true)
 * - 토큰은 평문 저장 X (hash 저장)
 * - 링크는 APP_ORIGIN 기반
 * - 메일 발신자는 MAIL_FROM(도메인 인증 후) 우선, 없으면 onboarding@resend.dev(개발용)
 */
app.post(
  "/api/auth/forgot-password",
  asyncHandler(async (req, res) => {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ ok: false, message: "email required" });
    }

    // 보안/UX: 항상 동일한 성공 응답 형태(존재 여부 숨김)
    const okMsg = "메일을 발송했습니다. (스팸함도 확인)";

    // 사용자 조회
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, emailVerified: true },
    });

    // 사용자 없으면 그대로 ok
    if (!user) {
      return res.json({ ok: true, message: okMsg });
    }

    // 이메일 인증 안 됐으면: 재설정 자체를 막는 UX
    // (그래도 존재 여부를 노출시키고 싶지 않다면 okMsg로 통일해도 됨)
    if (!user.emailVerified) {
      return res.json({
        ok: true,
        message:
          "이메일 인증이 완료되지 않았습니다. 가입하신 이메일(스팸함 포함)에서 인증을 먼저 진행해 주세요.",
      });
    }

    // origin 준비 (마지막 / 제거)
    const APP_ORIGIN_RAW = process.env.APP_ORIGIN || process.env.FRONTEND_URL || "";
    const APP_ORIGIN = String(APP_ORIGIN_RAW).trim().replace(/\/+$/, "");
    if (!APP_ORIGIN) {
      // 서버 설정 문제이므로 500으로 알려주기
      return res.status(500).json({
        ok: false,
        message: "Server misconfigured: APP_ORIGIN (or FRONTEND_URL) is not set",
      });
    }

    // 토큰 생성(평문은 메일로만 보내고, DB에는 hash로 저장)
    const token = makeRandomToken(32);
    const tokenHash = sha256(token);
    const expiresAt = addHours(new Date(), 1); // 1시간

    // 같은 유저가 여러 번 요청하면 기존 토큰 정리(선택)
    await prisma.passwordResetToken.deleteMany({
      where: { userId: user.id },
    });

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    const resetLink = `${APP_ORIGIN}/reset-password?token=${encodeURIComponent(token)}`;

    // 발신자: 도메인 인증 후엔 MAIL_FROM 사용 권장
    const from =
      process.env.MAIL_FROM ||
      "MyInvetory <onboarding@resend.dev>"; 

    // 메일 발송
    await resend.emails.send({
      from,
      to: user.email,
      subject: "[마이 인벤토리] 비밀번호 재설정 안내",
      html: `
        <div style="font-family:Apple SD Gothic Neo, Malgun Gothic, sans-serif; line-height:1.6">
          <h2 style="margin:0 0 12px 0">비밀번호 재설정</h2>
          <p>안녕하세요, 마이 인벤토리 입니다.</p>
          <p>비밀번호 재설정 요청을 받았습니다. 아래 버튼을 눌러 새 비밀번호를 설정하세요.</p>

          <p style="margin:18px 0">
            <a href="${resetLink}"
              style="display:inline-block;background:#111827;color:#fff;text-decoration:none;
                      padding:10px 14px;border-radius:10px;font-weight:700">
              비밀번호 재설정하기
            </a>
          </p>

          <p style="font-size:12px;color:#6b7280">
            • 이 링크는 1시간 후 만료됩니다.<br/>
            • 본인이 요청하지 않았다면 이 메일을 무시해도 됩니다.
          </p>

          <hr style="border:none;border-top:1px solid #e5e7eb;margin:18px 0"/>

          <p style="font-size:12px;color:#9ca3af">
            마이 인벤토리 · 자동발송 메일입니다.
          </p>
        </div>
      `,
    });

    console.log("[RESET SENT]", user.email);

    return res.json({ ok: true, message: okMsg });
  })
);


app.post(
  "/api/auth/reset-password",
  asyncHandler(async (req, res) => {
    const token = String(req.body?.token ?? "").trim();
    const newPassword = String(req.body?.newPassword ?? "");

    if (!token || !newPassword) {
      return res.status(400).json({ ok: false, message: "token/newPassword required" });
    }

    // 비번 정책은 프론트와 동일하게 맞추는 게 좋아
    const PASSWORD_REGEX =
      /^(?=.*\d)(?=.*[!@#$%^&*()[\]{};:'",.<>/?\\|`~+=_-]).{8,}$/;

    if (!PASSWORD_REGEX.test(newPassword)) {
      return res.status(400).json({
        ok: false,
        message: "비밀번호는 8자 이상이며 숫자와 특수문자를 포함해야 합니다.",
      });
    }

    const tokenHash = sha256(token);

    const row = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    });

    if (!row) {
      return res.status(400).json({ ok: false, message: "유효하지 않은 링크입니다." });
    }
    if (row.usedAt) {
      return res.status(400).json({ ok: false, message: "이미 사용된 링크입니다." });
    }
    if (new Date(row.expiresAt).getTime() < Date.now()) {
      return res.status(400).json({ ok: false, message: "링크가 만료되었습니다." });
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: row.userId },
        data: { password: hashed },
      }),
      prisma.passwordResetToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      }),
    ]);

    res.json({ ok: true, message: "비밀번호가 변경되었습니다. 로그인해 주세요." });
  })
);


app.use(
  "/api/categories",
  createCategoriesRouter({
    prisma,
    requireAuth,
    asyncHandler,
  })
);
app.use(
  "/api/items",
  createItemsRouter({
    prisma,
    requireAuth,
    asyncHandler,
    normalizeRecordInput,
    calcStock,
    calcStockAndPending,
  })
);
app.use(
  "/api",
  createRecordsRouter({
    prisma,
    requireAuth,
    asyncHandler,
    toYmd,
    calcStockAndPending,
  })
);
app.use(
  "/api/admin",
  createAdminRouter({
    prisma,
    requireAuth,
    asyncHandler,
  })
);

/* =================회원탈퇴================= */
app.delete(
  "/api/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId;
    const password = String(req.body?.password ?? "");

    if (!password) {
      return res.status(400).json({ ok: false, message: "password required" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true },
    });

    if (!user) return res.status(404).json({ ok: false, message: "user not found" });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ ok: false, message: "비밀번호가 올바르지 않습니다." });
    }

    await prisma.$transaction(async (tx) => {
      await tx.record.deleteMany({ where: { userId } });
      await tx.item.deleteMany({ where: { userId } });
      await tx.category.deleteMany({ where: { userId } });
      await tx.user.delete({ where: { id: userId } });
    });

    res.clearCookie("token", { path: "/", secure: true, sameSite: "none" });
    res.json({ ok: true });
  })
);

/* ================= ERROR ================= */
app.use((err, req, res, next) => {
  console.error("ERROR:", err);
  res.status(500).json({
    ok: false,
    message: "server error",
    error: String(err?.message || err),
  });
});

export default app;
