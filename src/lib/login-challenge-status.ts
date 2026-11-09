export type LoginChallengeStatus = { serverTime: number; maskedEmail: string; expiresAt: string; resendAt: string; remainingAttempts: number; canResend: boolean };

export const loginChallengeErrors: Record<string, string> = {
  INVALID_OTP: "验证码不正确，请检查最新收到的邮件后重新输入。",
  INVALID_CHALLENGE: "此次登录验证已失效，请重新登录。",
  CHALLENGE_EXPIRED: "验证码已过期，请重新登录以获取新的验证码。",
  CHALLENGE_LOCKED: "尝试次数已用完，请重新登录。",
  RESEND_LIMITED: "发送过于频繁，请等待倒计时结束后重试。",
  MAIL_DELIVERY_FAILED: "邮件暂时发送失败，请稍后重新发送。",
  TOO_MANY_REQUESTS: "尝试过于频繁，请稍后再试。",
};
