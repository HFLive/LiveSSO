export const auditEventLabels: Record<string, string> = {
  "account.recovery.delivery_failed": "账号恢复邮件投递失败",
  "login.password": "密码登录验证",
  "login.completed": "完成登录",
  "login.challenge.created": "发送登录验证码",
  "login.challenge.resent": "重新发送登录验证码",
  "invitation.created": "发送成员邀请",
  "invitation.accepted": "接受成员邀请",
  "invitation.revoked": "撤回成员邀请",
  "user.profile.changed": "更新个人资料",
  "user.username.changed": "更改登录用户名",
  "user.identity-details.changed": "更新成员身份资料",
  "user.status.changed": "更改账号状态",
  "user.email.change.requested": "申请更改邮箱",
  "user.email.change.cancelled": "取消更改邮箱",
  "user.email.changed": "完成邮箱更改",
  "oauth.client.created": "添加应用",
  "oauth.client.configuration.updated": "更新应用登录设置",
  "oauth.client.disabled": "停用应用",
  "oauth.client.enabled": "启用应用",
  "oauth.client.secret.rotated": "轮换应用密钥",
  "oauth.client.webhook.updated": "更新事件通知设置",
  "oauth.client.webhook.secret.rotated": "轮换事件签名密钥",
  "directory.user.read": "应用读取成员资料",
  "platform.role.change": "更改平台角色",
  "platform.admin.bootstrap": "创建初始管理员",
  "platform.admin.bootstrap_email_repaired": "修复初始管理员邮箱",
};

export const auditOutcomeLabels = { SUCCESS: "成功", FAILURE: "失败", DENIED: "已拒绝" };
export const auditSeverityLabels = { INFO: "一般记录", WARNING: "需关注", CRITICAL: "高影响操作" };

export function auditContext(event: { eventType: string; actorType: string; actorUserId: string | null; subjectUserId: string | null; clientId: string | null }, userNames: ReadonlyMap<string, string>, clientNames: ReadonlyMap<string, string>) {
  const loginRequest = event.eventType.startsWith("login.");
  const actor = event.actorUserId ? userNames.get(event.actorUserId) ?? "已移除的成员"
    : event.actorType === "CLIENT" ? clientNames.get(event.clientId ?? "") ?? "已移除的应用"
    : loginRequest ? "登录请求"
    : event.actorType === "SYSTEM" ? "系统" : "未识别的操作者";
  const subject = event.subjectUserId ? userNames.get(event.subjectUserId) ?? "已移除的成员"
    : event.clientId ? clientNames.get(event.clientId) ?? "已移除的应用"
    : loginRequest ? "未识别的账号"
    : event.eventType.startsWith("invitation.") ? "成员邀请" : "统一账号平台";
  return { actor, subject };
}

export function auditTypesForSearch(query: string) {
  return Object.entries(auditEventLabels).filter(([, label]) => label.includes(query)).map(([type]) => type);
}
