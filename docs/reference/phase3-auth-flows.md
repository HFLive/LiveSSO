# Phase 3 邀请、邮件与风险登录参考

状态：已实现  
最后更新：2026-08-09

## 账号创建

- 公开 `/sign-up/email` 与原始 `/sign-in/email|username` 端点均关闭，避免绕过邀请和风险层。
- `POST /api/invitations` 只接受当前 `ADMIN` 会话，管理员必须同时指定邮箱和 3–32 位全局用户名；邀请固定创建普通 `USER`，有效期 7 天。
- 邀请链接保存 `Invitation` ID 与随机 token；数据库只保存用途隔离 HMAC 摘要。
- 待处理邀请通过大小写不敏感的部分唯一索引预留用户名；接受页面只读显示管理员指定值，服务端以邀请记录为准，不接受浏览器改写。旧版本遗留的未指定用户名邀请仍允许受邀者填写。
- 接受邀请时在同一数据库事务内创建 `User`、Better Auth `credential` account 并条件消费邀请。密码使用 Better Auth 哈希；链接并发只会成功一次。

## 登录与风险 challenge

浏览器只调用 `/api/auth/hflive/sign-in`。服务端统一规范化用户名/邮箱，验证密码和 `accountStatus`，失败响应不区分账号不存在、密码错误或账号停用。

当登录由 OAuth/OIDC authorize 发起时，登录页把原始同源授权查询恢复为
`/api/auth/oauth2/authorize?...` 回跳地址。该地址同时覆盖直接登录和邮箱 OTP 路径，
避免首次登录成功后落到站点首页并丢失 authorization code flow。

初版可解释规则：

- 未提供有效的 30 天受信设备 token；
- 15 分钟内至少两次密码失败后成功；
- 10 分钟内至少五次成功登录；
- 已受信设备的 IP 摘要或 User-Agent 摘要变化。

命中规则且邮件可用时创建 10 分钟、最多 5 次尝试的 `LoginChallenge`，发送 6 位随机邮箱 OTP。challenge binding、OTP、IP、User-Agent 与设备 token 只以用途隔离摘要保存。OTP 原子消费成功后才创建会话；用户可选择保存 30 天受信设备。

密码和 OTP 端点都使用 PostgreSQL 限流。登录成功、失败、challenge 和设备使用会写入 90 天审计；审计 metadata 不包含标识符、密码、OTP、cookie 或原始 token。

## 邮件与恢复

`MAIL_TRANSPORT=smtp` 用于本地 Mailpit 或自部署 SMTP；`http` 用于官方 HTTP API 邮件供应商。HTTP 请求使用 JSON `from/to/subject/text/html`，可选 Bearer token。

找回密码复用 Better Auth 单次 reset token，始终返回相同的提交结果。token 有效期 1 小时，重置后撤销全部现有会话并尝试发送安全提醒。邀请创建、风险 OTP、账号创建和密码重置均发送相应事务邮件或安全提醒。

官方生产必须启用邮件。自部署可显式设置 `MAIL_ENABLED=false`：邀请和找回密码不可用；风险规则仍会记录，但密码正确时以 `mailDegraded=true` 审计后登录，不会伪装成已经发送 OTP。该模式只用于明确接受能力降级的自部署环境。

## 自动化验收

```bash
pnpm validate
pnpm test:db
pnpm test:phase3
pnpm oidc:smoke
```

`test:phase3` 需要 PostgreSQL 和 Mailpit，覆盖受信设备直登、新设备邮件 OTP、challenge 单次消费、账号枚举响应一致、数据库暴力尝试限流和公开注册关闭。
