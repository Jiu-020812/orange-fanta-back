export const PASSWORD_REGEX =
  /^(?=.*[!@#$%^&*()[\]{};:'",.<>/?\\|`~+=_-]).{8,}$/;

export function validatePassword(pw) {
  if (typeof pw !== "string") return { ok: false, reason: "비밀번호가 비어있어요." };
  if (!PASSWORD_REGEX.test(pw)) {
    return {
      ok: false,
      reason: "비밀번호는 8자 이상이고 특수문자를 1개 이상 포함해야 합니다.",
    };
  }
  return { ok: true };
}