import { describe, expect, it } from "vitest";
import { invitationErrorMessage } from "@/lib/invitation-error";

describe("invitationErrorMessage", () => {
  it("distinguishes reservation, mail, and system failures", () => {
    expect(invitationErrorMessage("INVITATION_PENDING")).toContain("尚未过期");
    expect(invitationErrorMessage("MAIL_DELIVERY_FAILED")).toContain("邮件服务");
    expect(invitationErrorMessage("INVITATION_FAILED")).toContain("系统维护者");
  });

  it("uses a safe fallback for unknown errors", () => {
    expect(invitationErrorMessage("UNKNOWN")).toBe("邀请发送失败，请稍后重试。");
  });
});
