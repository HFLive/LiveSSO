import { describe, expect, it } from "vitest";
import { describeConsentPermissions } from "./consent-permissions";

describe("describeConsentPermissions", () => {
  it("groups sign-in scopes into one plain-language permission", () => {
    expect(describeConsentPermissions(["openid", "profile", "email"])).toEqual([
      { title: "使用你的 HFLive Auth 账号登录", description: "查看你的显示名、用户名和头像，以及邮箱及其验证状态" },
    ]);
  });

  it("describes persistent access without exposing the scope name", () => {
    expect(describeConsentPermissions(["openid", "offline_access"])).toEqual([
      { title: "使用你的 HFLive Auth 账号登录", description: "确认这是你的 HFLive Auth 账号" },
      { title: "保持登录状态", description: "你离开应用后，该应用仍可维持已经授权的会话" },
    ]);
  });
});
