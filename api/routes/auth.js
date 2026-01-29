import express from "express";
import bcrypt from "bcryptjs";
import { Resend } from "resend";
import { prisma } from "../../lib/prisma.js";
import {
  createToken,
  requireAuth,
  makeRandomToken,
  sha256,
  addHours,
  COOKIE_OPTIONS,
} from "../../utils/auth.js";
import { validatePassword } from "../../utils/passwordPolicy.js";

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

async function sendPasswordResetEmail({ to, link }) {
  if (!resend) {
    console.log("[MAIL SKIP] RESEND_API_KEY missing. Link:", link);
    return;
  }

  const from =
    process.env.MAIL_FROM || "MyInvetory <onboarding@resend.dev>";

  await resend.emails.send({
    from,
    to,
    subject: "[마이 인벤토리] 비밀번호 재설정 안내",
    html: `
      <div style="font-family:Apple SD Gothic Neo, Malgun Gothic, sans-serif; line-height:1.6">
        <h2 style="margin:0 0 12px 0">비밀번호 재설정</h2>
        <p>안녕하세요, 마이 인벤토리 입니다.</p>
        <p>비밀번호 재설정 요청을 받았습니다. 아래 버튼을 눌러 새 비밀번호를 설정하세요.</p>

        <p style="margin:18px 0">
          <a href="${link}"
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
}

export default function createAuthRouter({ asyncHandler }) {
  const router = express.Router();

  router.post(
    "/signup",
    asyncHandler(async (req, res) => {
      const { email, password, name } = req.body;

      const e = String(email ?? "").trim();
      const p = String(password ?? "");
      const n = String(name ?? "").trim();

      if (!e || !p) {
        return res
          .status(400)
          .json({ ok: false, message: "email/password required" });
      }

      const validation = validatePassword(p);
      if (!validation.ok) {
        return res.status(400).json({ ok: false, message: validation.reason });
      }

      const exists = await prisma.user.findUnique({ where: { email: e } });
      if (exists) {
        return res
          .status(409)
          .json({ ok: false, message: "이미 존재하는 이메일입니다." });
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

      const apiOrigin =
        process.env.API_ORIGIN || `https://${req.headers.host}`;
      const link = `${apiOrigin}/api/auth/verify?token=${rawToken}`;

      await sendVerifyEmail({ to: user.email, link });
      console.log("[VERIFY SENT]", user.email);

      return res.status(201).json({
        ok: true,
        message: "회원가입 완료. 이메일 인증을 진행해주세요.",
        devVerifyLink:
          process.env.NODE_ENV !== "production" ? link : undefined,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: user.emailVerified,
        },
      });
    })
  );

  router.get(
    "/verify",
    asyncHandler(async (req, res) => {
      const token = String(req.query.token || "");
      if (!token) return res.status(400).send("Missing token");

      const tokenHash = sha256(token);

      const row = await prisma.emailVerifyToken.findUnique({
        where: { tokenHash },
        select: { userId: true, expiresAt: true },
      });

      if (!row) return res.status(400).send("Invalid token");
      if (row.expiresAt < new Date())
        return res.status(400).send("Token expired");

      await prisma.$transaction([
        prisma.user.update({
          where: { id: row.userId },
          data: { emailVerified: true },
        }),
        prisma.emailVerifyToken.delete({ where: { tokenHash } }),
      ]);

      const appOrigin = process.env.APP_ORIGIN || "http://localhost:5173";
      return res.redirect(`${appOrigin}/login?verified=1`);
    })
  );

  router.post(
    "/login",
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
        return res
          .status(403)
          .json({ ok: false, message: "이메일 인증이 필요합니다." });
      }

      const token = createToken(user.id);

      res.cookie("token", token, COOKIE_OPTIONS).json({
        ok: true,
        user: { id: user.id, email: user.email, name: user.name },
      });
    })
  );

  router.post("/logout", (req, res) => {
    res.clearCookie("token", COOKIE_OPTIONS);
    res.json({ ok: true });
  });

  router.get(
    "/me",
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

  router.post(
    "/resend-verify",
    asyncHandler(async (req, res) => {
      const email = String(req.body?.email ?? "").trim();
      if (!email)
        return res.status(400).json({ ok: false, message: "email required" });

      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true, emailVerified: true },
      });
      if (!user) return res.json({ ok: true });
      if (user.emailVerified) return res.json({ ok: true });

      await prisma.emailVerifyToken.deleteMany({ where: { userId: user.id } });

      const rawToken = makeRandomToken(32);
      const tokenHash = sha256(rawToken);
      const expiresAt = addHours(new Date(), 24);

      await prisma.emailVerifyToken.create({
        data: { userId: user.id, tokenHash, expiresAt },
      });

      const apiOrigin =
        process.env.API_ORIGIN || `https://${req.headers.host}`;
      const link = `${apiOrigin}/api/auth/verify?token=${rawToken}`;

      await sendVerifyEmail({ to: user.email, link });

      res.json({ ok: true });
    })
  );

  router.post(
    "/forgot-password",
    asyncHandler(async (req, res) => {
      const email = String(req.body?.email ?? "").trim().toLowerCase();
      if (!email) {
        return res.status(400).json({ ok: false, message: "email required" });
      }

      const okMsg = "메일을 발송했습니다. (스팸함도 확인)";

      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true, emailVerified: true },
      });

      if (!user) {
        return res.json({ ok: true, message: okMsg });
      }

      if (!user.emailVerified) {
        return res.json({
          ok: true,
          message:
            "이메일 인증이 완료되지 않았습니다. 가입하신 이메일(스팸함 포함)에서 인증을 먼저 진행해 주세요.",
        });
      }

      const APP_ORIGIN_RAW =
        process.env.APP_ORIGIN || process.env.FRONTEND_URL || "";
      const APP_ORIGIN = String(APP_ORIGIN_RAW).trim().replace(/\/+$/, "");
      if (!APP_ORIGIN) {
        return res.status(500).json({
          ok: false,
          message:
            "Server misconfigured: APP_ORIGIN (or FRONTEND_URL) is not set",
        });
      }

      const token = makeRandomToken(32);
      const tokenHash = sha256(token);
      const expiresAt = addHours(new Date(), 1);

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

      await sendPasswordResetEmail({ to: user.email, link: resetLink });

      console.log("[RESET SENT]", user.email);

      return res.json({ ok: true, message: okMsg });
    })
  );

  router.post(
    "/reset-password",
    asyncHandler(async (req, res) => {
      const token = String(req.body?.token ?? "").trim();
      const newPassword = String(req.body?.newPassword ?? "");

      if (!token || !newPassword) {
        return res
          .status(400)
          .json({ ok: false, message: "token/newPassword required" });
      }

      const validation = validatePassword(newPassword);
      if (!validation.ok) {
        return res.status(400).json({ ok: false, message: validation.reason });
      }

      const tokenHash = sha256(token);

      const row = await prisma.passwordResetToken.findUnique({
        where: { tokenHash },
        select: { id: true, userId: true, expiresAt: true, usedAt: true },
      });

      if (!row) {
        return res
          .status(400)
          .json({ ok: false, message: "유효하지 않은 링크입니다." });
      }
      if (row.usedAt) {
        return res
          .status(400)
          .json({ ok: false, message: "이미 사용된 링크입니다." });
      }
      if (new Date(row.expiresAt).getTime() < Date.now()) {
        return res
          .status(400)
          .json({ ok: false, message: "링크가 만료되었습니다." });
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

      res.json({
        ok: true,
        message: "비밀번호가 변경되었습니다. 로그인해 주세요.",
      });
    })
  );

  return router;
}
