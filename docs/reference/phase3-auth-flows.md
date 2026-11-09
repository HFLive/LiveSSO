# Phase 3 邀请、邮件与风险登录参考

状态：已实现  
最后更新：2026-11-07

## 账号创建

- 公开 `/sign-up/email` 与原始 `/sign-in/email|username` 端点均关闭，避免绕过邀请和风险层。
- `POST /api/invitations` 只接受当前 `ADMIN` 会话，管理员指定邮箱及可选的 3–32 位全局用户名、身份标签（最多 40 字符）、真名（最多 80 字符），并选择 `2h | 1d | 7d | 30d` 有效期；邀请固定创建普通 `USER`，默认有效期 7 天。
- 邀请链接保存 `Invitation` ID 与随机 token；数据库只保存用途隔离 HMAC 摘要。
- 待处理邀请通过大小写不敏感的部分唯一索引预留用户名；创建新邀请前会把到期但仍为 `PENDING` 的记录转成 `EXPIRED`，因此未接受的邮箱和用户名到期后可重新使用。仍有效或已创建成正式用户的用户名继续拒绝重复。接受页面只读显示管理员指定值，服务端以邀请记录为准，不接受浏览器改写。未指定用户名（省略、null、空白均视为未指定）时，受邀者必须自行填写有效用户名；接受时检查正式账号及其他有效邀请预留，并使用 Serializable 事务防止并发争用。
- 身份标签与真名可分别填写，空白规范化为 null，拒绝控制字符。接受页面只读展示资料，服务端仅从邀请记录复制到新 User；受邀者传入的身份资料不会生效。邀请列表返回这两项资料，权限与既有成员管理相同。显示名仍由成员填写。
- 新增 migration `20261008000000_invitation_identity_details` 只增加两个可空列，旧邀请保持原语义；部署前运行 `prisma migrate deploy`。回滚应用时保留新增列和已创建用户资料，无需变更 issuer、会话、JWKS 或 token TTL。
- 创建接口区分已有账号、仍有效的待处理邀请、邮件投递失败和内部数据库故障；管理页面按错误代码给出对应处理建议，不能把迁移缺失或邮件故障伪装成“邮箱或用户名已被使用”。邀请与审计在同一事务创建，事务失败时不会尝试发送邮件。
- 管理员在 `/admin/invitations` 按待接受/历史记录筛选邀请，并按邮箱或用户名搜索，每页 15 条；服务端只读取当前页，历史记录可翻页查阅。发送邀请使用独立的 `/admin/invitations/new` 页面。列表把过期但尚未转换的 pending 记录归入历史并显示为已过期。现有 `GET /api/invitations` 契约不变，仍返回全部有效邀请及最近 30 条历史记录，且不返回 token 摘要或邀请链接；新的分页页面不依赖该全量接口。
- 管理员可通过同源 `DELETE /api/invitations/{id}` 撤回未过期、未接受的邀请。服务端重新校验有效管理员权限，在 Serializable 事务中条件更新为 `REVOKED` 并记录 `invitation.revoked` 审计。提交后原链接立即失效，pending 唯一索引释放邮箱和用户名；已接受、已撤回或已过期的邀请返回冲突，不改变终态。撤回不会删除历史邀请或已创建账号。
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

密码验证成功后，以下情况触发邮箱验证：

- 浏览器没有该账号有效且未撤销的 30 天受信设备凭据；
- 15 分钟内该账号至少有五次密码验证失败；
- 受信设备的 User-Agent 摘要变化；
- 受信设备的 IP 摘要变化，且该账号 10 分钟内已有至少五次成功登录。

普通换网和短时间重复登录单独出现时，已有受信设备可继续使用密码登录。命中规则且邮件可用时创建 10 分钟、最多 5 次尝试的 `LoginChallenge`，发送 6 位随机邮箱 OTP。challenge binding、OTP、IP、User-Agent 与设备 token 只以用途隔离摘要保存。OTP 仅可为有效账号原子消费一次。

密码和 OTP 端点都使用 PostgreSQL 限流。登录成功、失败、challenge 和设备使用会写入 90 天审计；审计 metadata 不包含标识符、密码、OTP、cookie 或原始 token。

### 验证状态与重发

- `/verify-login` 在服务端用 HttpOnly challenge Cookie 读取有效请求；没有有效绑定、已消费、停用账号、过期或锁定时不声称邮件已发送。只向浏览器传递脱敏邮箱、期限、冷却时间、剩余尝试次数和服务端时间。
- `GET /api/auth/hflive/challenge/status` 读取相同状态，成功响应为 `private, no-store`；未知绑定不返回邮箱。该端点按 IP 每分钟最多 30 次。
- `POST /api/auth/hflive/challenge/resend` 只接受有效绑定，每个 challenge 最多重发 3 次，初次发送和每次重发之间至少间隔 60 秒；冷却与次数使用现有 PostgreSQL `RateLimit` 表保存。端点另按 IP 每分钟最多 3 次。密码登录、验证、重发及退出 hook 显式校验既有 trusted origins，不接受任意跨站请求。
- 重发与验证共享 challenge 行锁，更新 OTP 摘要时不延长原 10 分钟有效期、不重置最多 5 次的尝试额度。旧码在新码生成后失效；投递失败时，仅在请求仍为 pending 且摘要未再次变化时恢复原摘要，冷却和重发计数保留。初次发送失败则取消 challenge，不把浏览器送入“已发送”页面。未修改 schema，无新增 migration。
- 输错 OTP 返回 `INVALID_OTP`，过期/锁定分别返回 `CHALLENGE_EXPIRED` / `CHALLENGE_LOCKED`；无效、已消费或停用账号保持通用 `INVALID_CHALLENGE`。这些状态只针对密码验证后已持有绑定的浏览器。登录密码失败的枚举保护保持不变。
- 验证与找回/重置密码表单处理网络异常和超时并恢复按钮；只有请求被服务端接受后才显示通用恢复结果。返回登录时可保留原同源授权回跳。

### 主动退出与切换账号

账号菜单使用 Better Auth `/sign-out` 撤销当前浏览器的统一账号会话。退出前取消当前 Cookie 绑定的 pending challenge，退出后删除 challenge Cookie；切换账号完成相同退出流程后进入登录页。受信设备凭据、其他浏览器会话和各应用的本地会话继续遵循原策略，不扩大全局登出范围。既有 session Cookie、issuer、JWKS 与 token TTL 均保持原配置；回滚 UI 不需要数据迁移，新建的重发限流记录可按既有限流保留策略清理。

### 会话保留

- 邮箱验证页默认不勾选「信任此设备并保持登录 30 天」。主动勾选后，本次 HFLive Auth 会话、浏览器会话 Cookie 和受信设备凭据从验证时起可保留 30 天。受信设备凭据仅用于下次密码登录的风险判断。
- 普通会话使用 Better Auth 的 7 天有效期和 1 天续期阈值；续期请求最多续到登录后第 30 天。数据库记录决定会话是否仍有效。主动退出、账号停用和密码重置仍可提前撤销会话。
- 发布时保留现有会话与 Cookie 的有效期，也不恢复已过期的会话；旧会话若已超过新上限，保留其当前到期时间。回滚时数据库和浏览器中已签发的长会话仍受其已存有效期约束；如需立即结束这些会话，应通过会话撤销流程处理。issuer、JWKS 轮换和 OIDC token TTL 延续原配置。各接入应用独立管理本地会话。

## 邮件与恢复

`MAIL_TRANSPORT=smtp` 用于本地 Mailpit 或自部署 SMTP；`http` 用于官方 HTTP API 邮件供应商。HTTP 请求使用 JSON `from/to/subject/text/html`，可选 Bearer token。

找回密码复用 Better Auth 单次 reset token。邮件关闭时，在查询账号前对所有邮箱统一返回不可用；已启用但投递失败时，记录不含邮箱、链接或 token 的审计，已知与未知账号继续返回相同的提交结果。界面只确认请求已提交，不保证邮件已送达。token 有效期 1 小时，重置后撤销全部现有会话并尝试发送安全提醒。邀请创建、风险 OTP、账号创建和密码重置均发送相应事务邮件或安全提醒。

已登录用户在 `/profile` 的“密码”行可输入当前密码和新密码进行修改，使用 Better Auth `/change-password`，并撤销其他 HFLive Auth 会话。来自 LiveBoard 的资料页链接带 `action=password`，登录后仍保留该参数并打开改密弹窗。新密码长度为 12–128 个字符；忘记当前密码时继续使用邮件找回流程。

官方生产必须启用邮件。自部署可显式设置 `MAIL_ENABLED=false`：邀请和找回密码不可用；风险规则仍会记录，但密码正确时以 `mailDegraded=true` 审计后登录，不会伪装成已经发送 OTP。该模式只用于明确接受能力降级的自部署环境。

Vercel Production 使用 `pnpm vercel:build`，在 Next.js 构建前执行 `prisma migrate deploy`；Preview 不连接正式 direct URL 执行迁移。数据库迁移失败必须阻断正式部署，避免应用代码与数据库 schema 不一致。

## 自动化验收

```bash
pnpm validate
pnpm test:db
pnpm test:phase3
pnpm oidc:smoke
```

`test:phase3` 需要 PostgreSQL 和 Mailpit，覆盖受信设备换 IP 后直登、新设备邮件 OTP、主动选择后的 30 天会话、过期拒绝、账号枚举响应一致、数据库暴力尝试限流和公开注册关闭，并执行 `login-challenge.integration.test.ts` 验证状态脱敏、并发重发、原期限/额度保留、旧码失效、终态拒绝、投递失败恢复、跨站拒绝和退出取消。

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
