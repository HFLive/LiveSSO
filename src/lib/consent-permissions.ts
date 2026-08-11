export type ConsentPermission = { title: string; description: string };

export function describeConsentPermissions(scopes: string[]): ConsentPermission[] {
  const requested = new Set(scopes);
  const permissions: ConsentPermission[] = [];
  const basicFields = [
    ...(requested.has("profile") ? ["显示名、用户名和头像"] : []),
    ...(requested.has("email") ? ["邮箱及其验证状态"] : []),
  ];

  if (requested.has("openid") || basicFields.length) {
    permissions.push({
      title: "使用你的 HFLive 账号登录",
      description: basicFields.length ? `查看你的${basicFields.join("，以及")}` : "确认这是你的 HFLive 账号",
    });
  }

  if (requested.has("offline_access")) {
    permissions.push({
      title: "保持登录状态",
      description: "你离开应用后，该应用仍可维持已经授权的会话",
    });
  }

  if (!permissions.length) {
    permissions.push({ title: "连接你的 HFLive 账号", description: "完成此应用所需的账号授权" });
  }

  return permissions;
}
