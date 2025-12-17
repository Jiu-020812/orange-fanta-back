import express from "express";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { requireAuth } from "../api/middlewares/requireAuth.js"

const prisma = new PrismaClient();
const router = express.Router();

/* ======================= 비밀번호 정책 ======================= */
/**
 * 조건:
 * - 8자 이상
 * - 숫자 1개 이상
 * - 특수문자 1개 이상
 */
const PASSWORD_REGEX =
  /^(?=.*\d)(?=.*[!@#$%^&*()[\]{};:'",.<>/?\\|`~+=_-]).{8,}$/;

function validatePassword(pw) {
  if (typeof pw !== "string" || pw.length === 0) {
    return { ok: false, reason: "비밀번호를 입력해 주세요." };
  }

  if (!PASSWORD_REGEX.test(pw)) {
    return {
      ok: false,
      reason: "비밀번호는 8자 이상이며 숫자와 특수문자를 각각 1개 이상 포함해야 합니다.",
    };
  }

  return { ok: true };
}

/* ======================= GET /api/me ======================= */
/**
 * 내 정보 조회
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const userId = req.userId;

    const me = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!me) {
      return res.status(404).json({
        ok: false,
        message: "유저를 찾을 수 없습니다.",
      });
    }

    return res.json({ ok: true, user: me });
  } catch (err) {
    console.error("❌ GET /api/me error:", err);
    return res.status(500).json({
      ok: false,
      message: "server error",
    });
  }
});

/* ======================= PATCH /api/me ======================= */
/**
 * 닉네임 변경
 * body: { name }
 */
router.patch("/", requireAuth, async (req, res) => {
  try {
    const userId = req.userId;
    const name = String(req.body?.name ?? "").trim();

    if (name.length < 2) {
      return res.status(400).json({
        ok: false,
        message: "닉네임은 2자 이상이어야 합니다.",
      });
    }

    if (name.length > 20) {
      return res.status(400).json({
        ok: false,
        message: "닉네임은 20자 이하로 해주세요.",
      });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { name },
      select: { id: true, email: true, name: true },
    });

    return res.json({ ok: true, user: updated });
  } catch (err) {
    console.error("❌ PATCH /api/me error:", err);
    return res.status(500).json({
      ok: false,
      message: "server error",
    });
  }
});

/* ======================= PATCH /api/me/password ======================= */
/**
 * 비밀번호 변경
 * body: { currentPassword, newPassword }
 */
router.patch("/password", requireAuth, async (req, res) => {
  try {
    const userId = req.userId;
    const currentPassword = String(req.body?.currentPassword ?? "");
    const newPassword = String(req.body?.newPassword ?? "");

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        ok: false,
        message: "현재 비밀번호와 새 비밀번호를 모두 입력해 주세요.",
      });
    }

    // 새 비밀번호 정책 검사
    const policy = validatePassword(newPassword);
    if (!policy.ok) {
      return res.status(400).json({
        ok: false,
        message: policy.reason,
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true },
    });

    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "유저를 찾을 수 없습니다.",
      });
    }

    // 현재 비밀번호 확인
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({
        ok: false,
        message: "현재 비밀번호가 올바르지 않습니다.",
      });
    }

    // 기존 비밀번호와 동일한지 체크 (선택이지만 추천)
    const isSame = await bcrypt.compare(newPassword, user.password);
    if (isSame) {
      return res.status(400).json({
        ok: false,
        message: "새 비밀번호가 기존 비밀번호와 동일합니다.",
      });
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashed },
    });

    return res.json({
      ok: true,
      message: "비밀번호 변경 완료",
    });
  } catch (err) {
    console.error("❌ PATCH /api/me/password error:", err);
    return res.status(500).json({
      ok: false,
      message: "server error",
    });
  }
});

export default router;
