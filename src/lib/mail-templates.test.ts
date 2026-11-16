import { describe, expect, it } from "vitest";
import { emailChangeCodeEmail, invitationEmail, loginCodeEmail, passwordResetEmail, securityNoticeEmail } from "./mail-templates";

describe("transactional mail templates", () => {
  it("puts the same invitation URL in the button, fallback link and plain text", () => {
    const url = "https://auth.example.invalid/accept-invitation?token=placeholder&source=invite";
    const escaped = "https://auth.example.invalid/accept-invitation?token=placeholder&amp;source=invite";
    const email = invitationEmail({ url, username: "test_member", duration: "2h" });

    expect(email.html.match(/href="[^"]*"/g)).toEqual([`href="${escaped}"`, `href="${escaped}"`]);
    expect(email.html).toContain(`>${escaped}</a>`);
    for (const body of [email.html, email.text]) {
      expect(body).toContain("test_member");
      expect(body).toContain("2 小时内有效");
    }
    expect(email.text).toContain(`\n${url}\n`);
  });

  it("accepts local HTTP reset links and excludes executable link schemes", () => {
    const url = "http://localhost:3000/api/auth/reset-password/placeholder?callbackURL=%2Freset-password";
    const email = passwordResetEmail(url, 1);

    expect(email.html).toContain(`href="${url}"`);
    expect(email.text).toContain(`\n${url}\n`);
    expect(() => passwordResetEmail("javascript:void(0)", 1)).toThrow("Invalid email action URL.");
  });

  it("keeps verification codes contiguous in HTML and plain text, including after a resend", () => {
    const placeholder = "000000";
    const resent = loginCodeEmail(placeholder, 4, true);

    for (const email of [loginCodeEmail(placeholder, 10), resent, emailChangeCodeEmail(placeholder, 10)]) {
      expect(email.html).toContain(`>${placeholder}</code>`);
      expect(email.text).toContain(`验证码是 ${placeholder}`);
      expect(email.html).not.toContain("href=");
    }
    for (const body of [resent.html, resent.text]) {
      expect(body).toContain("4 分钟内有效");
      expect(body).toContain("此前的验证码已失效");
    }
  });

  it("escapes account activity details in HTML without changing the plain text", () => {
    const summary = `邮箱变更为 <member&name@example.invalid>，原地址为 "member'o@example.invalid"。`;
    const email = securityNoticeEmail(summary);

    expect(email.html).toContain("&lt;member&amp;name@example.invalid&gt;");
    expect(email.html).toContain("&quot;member&#39;o@example.invalid&quot;");
    expect(email.html).not.toContain(summary);
    expect(email.text).toContain(summary);
  });
});
