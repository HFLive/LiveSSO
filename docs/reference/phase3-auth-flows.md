# Phase 3 邀请、邮件与风险登录参考

状态：已实现  
最后更新：2026-08-09

## 账号创建

- 公开 `/sign-up/email` 与原始 `/sign-in/email|username` 端点均关闭，避免绕过邀请和风险层。
- `POST /api/invitations` 只接受当前 `ADMIN` 会话，管理员必须同时指定邮箱、3–32 位全局用户名和 `2h | 1d | 7d | 30d` 有效期；邀请固定创建普通 `USER`，默认有效期 7 天。
- 邀请链接保存 `Invitation` ID 与随机 token；数据库只保存用途隔离 HMAC 摘要。
- 待处理邀请通过大小写不敏感的部分唯一索引预留用户名；创建新邀请前会把到期但仍为 `PENDING` 的记录转成 `EXPIRED`，因此未接受的邮箱和用户名到期后可重新使用。仍有效或已创建成正式用户的用户名继续拒绝重复。接受页面只读显示管理员指定值，服务端以邀请记录为准，不接受浏览器改写。旧版本遗留的未指定用户名邀请仍允许受邀者填写。
- 创建接口区分已有账号、仍有效的待处理邀请、邮件投递失败和内部数据库故障；管理页面按错误代码给出对应处理建议，不能把迁移缺失或邮件故障伪装成“邮箱或用户名已被使用”。邀请与审计在同一事务创建，事务失败时不会尝试发送邮件。
- 接受邀请时在同一数据库事务内创建 `User`、Better Auth `credential` account 并条件消费邀请。密码使用 Better Auth 哈希；链接并发只会成功一次。

## 登录与风险 challenge

浏览器只调用 `/api/auth/hflive/sign-in`。服务端统一规范化用户名/邮箱，验证密码和 `accountStatus`，失败响应不区分账号不存在、密码错误或账号停用。

当登录由 OAuth/OIDC authorize 发起时，登录页把原始同源授权查询恢复为
`/api/auth/oauth2/authorize?...` 回跳地址。该地址同时覆盖直接登录和邮箱 OTP 路径，
避免首次登录成功后落到站点首页并丢失 authorization code flow。

登录页在服务端读取现有 HFLive Auth 会话。已有有效会话时直接继续同源 callback 或
OIDC authorize 请求，不再次显示用户名和密码表单；外部 `callbackURL` 被丢弃并回到
`/profile`。主页同样按服务端会话渲染，已登录用户只看到账号摘要、资料管理和有权限的
管理后台入口。

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

Vercel Production 使用 `pnpm vercel:build`，在 Next.js 构建前执行 `prisma migrate deploy`；Preview 不连接正式 direct URL 执行迁移。数据库迁移失败必须阻断正式部署，避免应用代码与数据库 schema 不一致。

## 自动化验收

```bash
pnpm validate
pnpm test:db
pnpm test:phase3
pnpm oidc:smoke
```

`test:phase3` 需要 PostgreSQL 和 Mailpit，覆盖受信设备直登、新设备邮件 OTP、challenge 单次消费、账号枚举响应一致、数据库暴力尝试限流和公开注册关闭。

## 自助更改邮箱

- `/profile` 提供新邮箱、当前密码与验证码表单，可取消或刷新后继续待验证请求；未启用邮件时不提供更改入口。
- `POST /api/auth/hflive/profile/email/request` 只接受本人有效会话，使用 Better Auth 校验当前密码。地址去空白、转小写并验证格式，拒绝与当前相同、已使用或仍在邀请/验证中的邮箱；外部占用错误统一返回 `EMAIL_UNAVAILABLE`，不说明是哪类占用。
- 新邮箱收到 6 位随机验证码，有效期 10 分钟，最多 5 次错误尝试。数据库只保存绑定 user ID 的用途隔离 HMAC 摘要。请求成功前不更改原邮箱；重新发起会取消旧请求，发送失败会取消本次请求。
- `POST /api/auth/hflive/profile/email/confirm` 接受 `otp`。账号必须保持 ACTIVE；原子消费、最终占用检查、邮箱及 `emailVerified=true`、credential accountId、审计和 `user.profile.changed` outbox 在同一 Serializable 事务提交。冲突时回滚消费；并发提交至多一次成功。接入应用依据事件重新读取 Directory。
- `POST /api/auth/hflive/profile/email/cancel` 取消本人的待处理请求。三类端点沿用 Better Auth 的来源验证和数据库限流：请求每 IP 每 10 分钟 5 次，确认/取消各 15 次。另由请求记录限制验证码错误次数。
- 更改成功取消旧邮箱的待处理登录 challenge 和现有密码恢复凭据，并尝试向旧邮箱发送安全提醒；提醒发送失败不回滚已完成的更改。密码重置成功会取消尚未确认的邮箱更改。
- `EmailChangeRequest` 的部分唯一索引约束每用户、每个小写目标邮箱至多一条 PENDING；过期请求在发起新请求时释放。迁移必须先于应用发布执行。
- 身份 `sub`、用户名、角色、issuer、JWKS 和 token TTL 不变，不按新邮箱自动合并任何应用账号。现有会话继续有效；已有 JWT 的邮箱快照保留至原到期时间，新 token 和 Directory 读取更新后的资料。回滚代码时保留新增表与已更新邮箱，不能将已验证的新地址自动还原。

专项验证：`pnpm test:email-change`（需要 disposable PostgreSQL；邮件发送在集成测试中被替换为可断言的本地 mock）。浏览器验收使用本地 HTTP 邮件接收器，无真实邮件外发。
