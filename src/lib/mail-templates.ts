import { INVITATION_DURATIONS, type InvitationDuration } from "./invitation-duration";

type MailAction =
  | { kind: "link"; url: string; label: string; validity: string }
  | { kind: "code"; value: string; validity: string };

type MailTemplate = {
  subject: string;
  title: string;
  preview: string;
  body: string;
  action?: MailAction;
  note: string;
};

const sans = "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', Arial, sans-serif";
const mono = "'SFMono-Regular', Consolas, 'Liberation Mono', monospace";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderAction(action: MailAction) {
  const validity = escapeHtml(action.validity);
  if (action.kind === "code") {
    return {
      text: `验证码是 ${action.value}，${action.validity}。`,
      html: `<table class="mail-code-panel" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f5efe6" style="background-color:#f5efe6;border:1px solid #e5dbcd;border-radius:10px;">
        <tr><td align="center" style="padding:16px 12px;">
          <code class="mail-heading" dir="ltr" style="display:block;font-family:${mono};font-size:32px;line-height:1.25;font-weight:700;letter-spacing:.16em;color:#292623;">${escapeHtml(action.value)}</code>
          <p class="mail-muted" style="margin:6px 0 0;font-size:13px;line-height:1.5;color:#655d53;">${validity}</p>
        </td></tr>
      </table>`,
    };
  }

  // Action links come from invitation creation and Better Auth and may use HTTP in local deployments.
  if (!/^https?:\/\//i.test(action.url)) throw new Error("Invalid email action URL.");
  const url = escapeHtml(action.url);
  return {
    text: `${action.label}（${action.validity}）\n${action.url}`,
    html: `<table role="presentation" cellspacing="0" cellpadding="0" border="0">
      <tr><td class="mail-button" bgcolor="#272724" style="background-color:#272724;border-radius:7px;mso-padding-alt:12px 22px;">
        <a class="mail-button-text" href="${url}" style="display:inline-block;padding:12px 22px;mso-padding-alt:0;font-family:${sans};font-size:15px;line-height:22px;font-weight:700;color:#fffdf8;text-decoration:none;">${escapeHtml(action.label)}</a>
      </td></tr>
    </table>
    <p class="mail-muted" style="margin:10px 0 0;font-size:13px;line-height:1.6;color:#655d53;">${validity}</p>
    <p class="mail-muted" style="margin:20px 0 0;font-size:13px;line-height:1.7;color:#655d53;">若按钮无法打开，可复制下方链接到浏览器。<br>
      <a class="mail-url" href="${url}" style="color:#6d4934;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere;">${url}</a>
    </p>`,
  };
}

function renderEmail({ subject, title, preview, body, action, note }: MailTemplate) {
  const renderedAction = action && renderAction(action);
  return {
    subject,
    text: [body, renderedAction?.text, note].filter(Boolean).join("\n\n"),
    html: `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${escapeHtml(subject)}</title>
  <style>
    :root { color-scheme: light dark; }
    @media screen and (max-width: 480px) {
      .mail-frame { padding-top: 16px !important; padding-bottom: 16px !important; }
      .mail-inset { padding-left: 20px !important; padding-right: 20px !important; }
      .mail-title { font-size: 26px !important; }
    }
    @media (prefers-color-scheme: dark) {
      .mail-canvas { background-color: #191918 !important; }
      .mail-card { background-color: #20201e !important; border-color: #3d3b35 !important; }
      .mail-heading { color: #eeece6 !important; }
      .mail-copy { color: #d5d1c7 !important; }
      .mail-muted { color: #bcb7ab !important; }
      .mail-code-panel { background-color: #2b2824 !important; border-color: #4b4037 !important; }
      .mail-button { background-color: #ece9e2 !important; }
      .mail-button-text { color: #20201e !important; }
      .mail-url { color: #e8c5ad !important; }
      .mail-note { background-color: #272724 !important; border-color: #3d3b35 !important; color: #bcb7ab !important; }
    }
  </style>
</head>
<body class="mail-canvas" style="margin:0;padding:0;background-color:#f3efe8;">
  <div aria-hidden="true" style="display:none;visibility:hidden;opacity:0;max-height:0;max-width:0;overflow:hidden;mso-hide:all;">${escapeHtml(preview)}</div>
  <table class="mail-canvas" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f3efe8" style="background-color:#f3efe8;font-family:${sans};">
    <tr><td class="mail-frame" align="center" style="padding:32px 12px;">
      <!--[if mso]><table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
      <table class="mail-card" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#fffdf8" style="max-width:560px;table-layout:fixed;background-color:#fffdf8;border:1px solid #ded8ce;border-radius:13px;">
        <tr><td class="mail-inset" bgcolor="#272724" style="padding:17px 32px;text-align:left;background-color:#272724;border-radius:12px 12px 0 0;border-bottom:2px solid #e8c5ad;color:#eeece6;font-family:${sans};font-size:18px;line-height:26px;font-weight:700;">HFLive <span style="color:#e8c5ad;font-weight:600;">Auth</span></td></tr>
        <tr><td class="mail-inset" style="padding:30px 32px 28px;text-align:left;font-family:${sans};">
          <h1 class="mail-heading mail-title" style="margin:0 0 12px;font-size:30px;line-height:1.25;font-weight:700;color:#292623;">${escapeHtml(title)}</h1>
          <p class="mail-copy" style="margin:0;font-size:15px;line-height:1.8;color:#4c473e;word-wrap:break-word;overflow-wrap:anywhere;">${escapeHtml(body)}</p>
          ${renderedAction ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="table-layout:fixed;">
            <tr><td style="padding-top:22px;">${renderedAction.html}</td></tr>
          </table>` : ""}
        </td></tr>
        <tr><td class="mail-inset mail-note" bgcolor="#f8f4ed" style="padding:15px 32px;text-align:left;background-color:#f8f4ed;border-top:1px solid #e8e0d4;border-radius:0 0 12px 12px;font-family:${sans};font-size:13px;line-height:1.7;color:#655d53;">${escapeHtml(note)}</td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`,
  };
}

export function invitationEmail(input: { url: string; username: string | null; duration: InvitationDuration }) {
  const { url, username, duration } = input;
  const setup = username
    ? `指定的用户名为 ${username}。请设置显示名和密码。`
    : "请设置用户名、显示名和密码。";
  return renderEmail({
    subject: "邀请你创建 HFLive Auth 账号",
    title: "接受账号邀请",
    preview: "打开邀请链接以创建你的 HFLive Auth 账号。",
    body: `管理员邀请你创建账号。${setup}`,
    action: { kind: "link", url, label: "接受邀请", validity: `${INVITATION_DURATIONS[duration].label}内有效` },
    note: "此邀请链接仅可使用一次。",
  });
}

export function loginCodeEmail(otp: string, minutes: number, resent = false) {
  return renderEmail({
    subject: "HFLive Auth 登录验证码",
    title: resent ? "新的登录验证码" : "登录验证码",
    preview: "请在登录验证页输入六位验证码。",
    body: resent ? "请在登录验证页输入以下新验证码。此前的验证码已失效。" : "请在登录验证页输入以下验证码。",
    action: { kind: "code", value: otp, validity: `${minutes} 分钟内有效` },
    note: "请勿向他人透露验证码。",
  });
}

export function passwordResetEmail(url: string, hours: number) {
  return renderEmail({
    subject: "重置你的 HFLive Auth 密码",
    title: "重置密码",
    preview: "打开密码重置链接以设置新密码。",
    body: "你可以通过下方链接为 HFLive Auth 账号设置新密码。",
    action: { kind: "link", url, label: "重置密码", validity: `${hours} 小时内有效` },
    note: "若非本人发起，请忽略这封邮件。",
  });
}

export function emailChangeCodeEmail(otp: string, minutes: number) {
  return renderEmail({
    subject: "确认更改 HFLive Auth 邮箱",
    title: "确认更改邮箱",
    preview: "请在账号资料页输入验证码以确认新邮箱。",
    body: "你正在将 HFLive Auth 账号的邮箱改为接收本邮件的地址。请在资料页输入以下验证码。",
    action: { kind: "code", value: otp, validity: `${minutes} 分钟内有效` },
    note: "请勿向他人透露验证码。若非本人发起，请忽略这封邮件。",
  });
}

export function securityNoticeEmail(summary: string) {
  return renderEmail({
    subject: "HFLive Auth 安全提醒",
    title: "账号安全提醒",
    preview: "请查看你的 HFLive Auth 账号活动。",
    body: summary,
    note: "若非本人操作，请立即联系 HFLive Auth 管理员并重置密码。",
  });
}
