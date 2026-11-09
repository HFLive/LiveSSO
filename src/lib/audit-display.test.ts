import { describe, expect, it } from "vitest";
import { auditContext } from "./audit-display";

describe("audit attribution", () => {
  const users = new Map([["member", "测试成员"]]);
  const clients = new Map([["app", "测试应用"]]);
  const systemEvent = { eventType: "platform.admin.bootstrap", actorType: "SYSTEM", actorUserId: null, subjectUserId: null, clientId: null };

  it("distinguishes an anonymous login request from system work", () => {
    expect(auditContext({ ...systemEvent, eventType: "login.password" }, users, clients)).toEqual({ actor: "登录请求", subject: "未识别的账号" });
    expect(auditContext(systemEvent, users, clients)).toEqual({ actor: "系统", subject: "统一账号平台" });
  });

  it("identifies a known login target without treating it as the authenticated actor", () => {
    expect(auditContext({ ...systemEvent, eventType: "login.password", actorType: "USER", subjectUserId: "member" }, users, clients)).toEqual({ actor: "登录请求", subject: "测试成员" });
  });

  it("keeps member and client attribution and handles removed members", () => {
    expect(auditContext({ ...systemEvent, actorUserId: "removed", clientId: "app" }, users, clients)).toEqual({ actor: "已移除的成员", subject: "测试应用" });
    expect(auditContext({ ...systemEvent, actorType: "CLIENT", clientId: "app", subjectUserId: "member" }, users, clients)).toEqual({ actor: "测试应用", subject: "测试成员" });
  });
});
