const INVITATION_ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: "登录已过期，请重新登录后再发送邀请。",
  FORBIDDEN: "只有管理员可以邀请成员。",
  MAIL_DISABLED: "邮件服务尚未启用，请先完成邮件配置。",
  INVALID_REQUEST: "请检查邮箱、用户名和链接有效期。",
  ACCOUNT_EXISTS: "该邮箱或用户名已经属于现有账号。",
  INVITATION_PENDING: "该邮箱或用户名已有尚未过期的邀请。",
  MAIL_DELIVERY_FAILED: "邀请已撤销，因为邮件服务未能发送邮件。请检查邮件服务后重试。",
  INVITATION_FAILED: "邀请暂时无法创建，请稍后重试或联系系统维护者。",
};

export function invitationErrorMessage(code?: string) {
  return INVITATION_ERROR_MESSAGES[code ?? ""] ?? "邀请发送失败，请稍后重试。";
}
