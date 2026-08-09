# 安全策略

HFLive Auth 处理账号、会话和 OAuth 2.1 / OpenID Connect 安全边界。请不要在公开 Issue、Discussion、PR、日志或截图中披露可利用细节、真实账号信息或任何 secret。

## 报告漏洞

请通过 GitHub 的私密漏洞报告入口提交：

<https://github.com/HFLive/LiveSSO/security/advisories/new>

报告建议包含：

- 受影响的版本、commit 或部署模式；
- 最小复现步骤和预期/实际行为；
- 对认证、授权、账号、数据或可用性的影响；
- 已知缓解措施；
- 不含真实密码、OTP、session、authorization code、token、client secret、私钥或生产连接串的证据。

维护者会先确认收到报告，再评估严重性、修复和披露时间。修复发布前请不要公开漏洞细节。

## 支持范围

项目尚未发布首个稳定版本。当前仅维护默认分支 `main` 的最新代码；历史 commit 和未经维护者确认的部署不承诺安全更新。

普通功能缺陷请使用 GitHub Issues；依赖漏洞优先查看仓库 Security 页面中的 Dependabot alerts。
