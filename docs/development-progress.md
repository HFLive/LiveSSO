# 开发进度

最后更新：2026-08-23
当前阶段：Phase 6/7 生产接入稳定化，继续完善会话复用、资料管理与邀请运营体验
生产状态：HFLive Auth 核心平台已上线；会话感知首页/登录、个人资料页和可配置邀请有效期已完成本地验证，等待合并后的用户部署

本文件是项目当前完成度和下一步的唯一动态状态页。总体阶段定义见 [实施方案](../IMPLEMENTATION_PLAN.md)，Phase 1 的完成时证据见 [历史验收快照](../PHASE_1_STATUS.md)。

## 阶段总览

| 阶段                       | 状态   | 说明                                                                                                                          |
| -------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 基础契约           | 完成   | issuer、claims、scopes、接入边界和部署模式已确认                                                                              |
| Phase 1 工程/OIDC 骨架     | 完成   | 本地、生产构建、真实 PostgreSQL、PKCE 和 Docker 均验证                                                                        |
| Phase 2 安全与领域数据     | 完成   | 领域模型、数据库约束、摘要策略、原子消费/租约和管理员审计                                                                     |
| Phase 3 邀请/邮件/风险登录 | 完成   | 邀请、首次密码、邮件 OTP、恢复、风险规则和 30 天受信设备                                                                      |
| Phase 4 内部应用管理       | 完成   | client 生命周期、Directory API、可靠签名事件与审计控制台                                                                      |
| Phase 5 头像与正式部署     | 完成   | 自部署、恢复、官方 Vercel/Neon/R2/Resend、调度和静态分发均已验收                                                              |
| Phase 6 LiveBoard 后端     | 进行中 | 实现、正式 client、本机 dev OIDC/Directory、真实 Redis 与签名 webhook smoke 通过；尚缺 Vercel 同源回调和生产 webhook 投递证据 |
| Phase 7 LiveBoard 前端     | 完成   | 模式感知登录、冲突/会话关联、统一资料只读与跳转、外部头像优先及桌面/移动验收完成                                              |
| Phase 8 用户迁移           | 未开始 | 邀请、显式关联、hybrid 观察与回滚                                                                                             |
| Phase 9 上线运维           | 未开始 | 安全测试、备份恢复、轮换与事故流程                                                                                            |

## 当前可用能力

- 管理员邮件邀请可指定全局用户名和 2 小时、1 天、7 天或 30 天有效期，成功后显示页面顶部通知；未接受邀请到期后自动释放邮箱和用户名，受邀用户首次设置显示名和密码。
- 用户名或邮箱单输入框登录、可解释风险规则、邮箱 OTP 和 30 天受信设备。
- 统一找回密码、单次 reset token、全会话撤销和安全提醒。
- 禁止公开注册、禁止动态客户端注册。
- OIDC discovery 与 authorization code + PKCE。
- consent 以已审批应用名称和普通用户可理解的数据用途展示，不暴露内部 client ID 或 scope 术语；access/id/refresh token、userinfo、introspection、revocation、end-session 基础端点可用。
- PostgreSQL 持久化限流、会话、JWKS 和 OAuth 数据。
- 根域 issuer 与 EdDSA JWKS 轮换配置。
- 深色基础首页、登录页和 consent 页。
- liveness/readiness、安全响应头和 noindex。
- Vercel 配置、standalone Docker 镜像与 Compose 自动迁移。
- 初始唯一用户命令和 OIDC 端到端 smoke 脚本。
- `/admin` 提供 client 审批/停用/回调与 scope 维护/secret 轮换、用户状态和最近审计。
- Directory API 使用 `client_credentials` 与 `directory:user:read | directory:user:status` 最小 scope。
- 用户状态变化按订阅 client 生成独立 outbox，通过带时间戳 HMAC webhook 可靠投递。
- `/profile` 以个人资料页展示头像、显示名、用户名、邮箱验证、账号类型和加入时间；开放显示名编辑及头像选择、裁切与键盘调整，服务端将头像规范化为 512×512 WebP 并写入 R2/MinIO。
- 首页和登录页读取服务端会话；已登录用户不再看到登录按钮，OIDC 登录请求直接继续授权而不重复要求密码。
- 已审批应用可携带受控 `returnTo` 进入 `/profile`，页头明确显示“完成并返回”及应用产品名，头像保存后自动返回原应用页面；非白名单目标被忽略。
- 头像使用同源版本化 URL，旧版本保留，更新会写审计并生成 `user.profile.changed` outbox。

## 最近验证

- `pnpm validate`：通过。
- `pnpm build`：通过。
- PostgreSQL 17 共 7 个 migration：现有数据库原地应用和空数据库创建均通过。
- `pnpm oidc:smoke`：authorization code + PKCE、state、nonce、consent、token 和 claims 通过。
- Docker app/migrator 镜像：构建通过。
- Compose migrator：退出码 0；app readiness：HTTP 200。
- `pnpm test:phase3`：正常登录、风险 OTP、枚举保护、限流、关闭注册和邀请用户名约束共 6 项通过。
- `pnpm test:phase4`：secret 摘要、consent 应用名、client/scope/redirect 拒绝、Directory 与签名 outbox 共 5 项通过。
- 浏览器 1280×720 与 390×844：管理控制台无页面横向溢出或控制台错误，用户表格在移动端受控横向滚动，错误状态可读。
- `pnpm test:phase5`：真实 PostgreSQL + MinIO 的格式规范化、对象读回、版本替换和资料事件共 2 项通过。
- `pnpm oidc:smoke:phase4`：完整 authorization code + PKCE、consent、token、refresh token 与 claims 回归通过。
- 新 Compose 镜像：migrator/minio-init 退出 0，app readiness 200；浏览器头像真实上传、移动断点、键盘与错误状态通过。
- PostgreSQL custom dump 与 MinIO mirror 已恢复到隔离数据库/bucket，源/恢复计数一致；演练资源已清理。
- GitHub 仓库已初始化并发布到 `HFLive/LiveSSO`；CI、Dependabot、CODEOWNERS、安全策略和 PR 模板已合并到 `main`。
- LiveBoard Phase 6：空库和 baseline 旧库 migration 均在隔离 PostgreSQL 16 实际应用；旧用户保持 `localPasswordEnabled=true`、`sessionVersion=0`。
- LiveBoard Phase 6：真实 PostgreSQL 并发 JIT 与重复 webhook 集成测试通过；同一 subject 仅创建一个用户/映射，重复事件仅递增一次 sessionVersion。
- LiveBoard 仓库级 typecheck、472 项 API 测试、272 项 Web 测试、16 项 shared 测试、发布脚本测试和 production build 通过；本次变更文件格式检查通过。
- 正式 `https://auth.hsfz.live` discovery/readiness 只读探测通过，issuer、code、PKCE S256、授权/token/JWKS 端点和数据库 readiness 符合冻结契约；以编译后 CommonJS 产物实际加载 `openid-client` 并生成 state、nonce、PKCE 授权 URL 成功。
- 正式 HFLive OIDC 与 Directory dev client 已完成管理员审批和 secret 轮换；Directory `client_credentials` 返回 200，OIDC client 对不允许的 grant 返回预期 `unauthorized_client`，未再出现凭据拒绝。
- LiveBoard 本机 `hybrid` 真实浏览器联调通过：authorization code + PKCE、token exchange、claims、Directory 和回调均成功；同名 `super_admin` 未自动合并，经本地会话显式关联后进入 `/app/classrooms`。
- 数据库证据：`admin` 保持 `super_admin`、active、本地密码启用和原 `sessionVersion`；唯一外部映射为 `ACTIVE / LOCAL_SESSION / CURRENT`，认证审计记录 `oidc.link SUCCESS`。
- LiveBoard `pnpm test:phase6` 现默认加载本地环境并验证真实 PostgreSQL 并发 JIT、重复 webhook 事务和 Redis `GETDEL`，3 项通过；OIDC 定向单元测试 10 项、API typecheck、API build 与任务文件格式检查通过。
- LiveBoard Phase 7：登录页按 `local | hybrid | hflive_oidc` 服务端能力显示入口；break-glass 仅在明确启用时折叠展示，OIDC 冲突通过 fragment 单次票据进入旧密码显式关联页。
- LiveBoard Phase 7：个人设置区分 HFLive 权威字段与 LiveBoard 私有字段；外部头像优先、显示名/头像只读及服务端绕过保护通过定向测试，local 回滚仍使用旧本地资料。
- LiveBoard Phase 7 仓库级 typecheck、477 项 API 测试、280 项 Web 测试、16 项 Shared 测试、发布脚本回归和 production build 通过；真实 PostgreSQL/Redis Phase 6 持久化 3 项回归通过。
- 浏览器 1280×720 与 390×844 的真实 `hybrid` 登录、冲突、过期票据和已关联个人设置通过；无横向溢出，移动输入 16px，外部头像/只读字段生效且控制台无错误。

## Phase 2 验收

Phase 2 已冻结并实现下列模型字段、状态机和数据保留期：

1. 管理员权限：平台管理员与普通用户的最小模型。
2. `Invitation`：邀请、过期、消费和撤销。
3. `TrustedDevice`：摘要令牌、30 天到期、撤销和最近使用。
4. `LoginChallenge`：风险原因、OTP 摘要、尝试次数、并发消费。
5. `AuditEvent`：事件类型、actor、subject、应用、请求上下文和保留期。
6. `ProfileAsset`：对象键、版本、生命周期和内容元数据。
7. `OutboxEvent`：可靠投递、重试、幂等和死信处理。

验收结果：

- 4 个 migration 可从空数据库部署，已有 Phase 1 本地数据库原地升级通过。
- 邀请、challenge 并发消费和 outbox 并发认领/确认的真实 PostgreSQL 测试通过。
- 敏感值采用用途隔离 HMAC；生产强制独立摘要 secret；平台角色变更写入追加式审计。
- 数据库 check constraint、pending 邀请唯一约束、审计保留期保护和 outbox 租约已落地。
- `pnpm validate`、`pnpm build` 和 Docker 空库迁移的最终结果见开发日志。

完整字段和保留期见 [Phase 2 安全与领域数据参考](./reference/security-domain-data.md)。

## Phase 3 验收

Phase 3 已完成以下用户路径：

1. 管理员发送 7 天单次邀请，受邀用户首次设置显示名、用户名和密码。
2. 用户名或邮箱单输入框密码登录，受信设备走普通路径。
3. 新设备、近期失败、异常频率或请求上下文变化追加邮件 OTP。
4. OTP 成功后可信任设备 30 天，challenge 并发只能消费一次。
5. 找回密码使用 1 小时单次 token，完成后撤销全部现有会话并发送安全提醒。
6. 登录、OTP、邀请、恢复和错误页覆盖桌面与移动断点。

验收结果：

- 公开注册及原始密码登录端点不可用，不能绕过邀请或风险层。
- 不存在账号、错误密码和停用账号使用相同外部错误；未知账号仍执行密码哈希以收敛时序差异。
- 密码与 OTP 端点使用 PostgreSQL 限流；真实集成测试确认重复尝试返回 429。
- 正常与风险路径均有自动化测试；风险测试实际从 Mailpit 读取 OTP 并完成会话。
- 5 个 migration、生产构建、完整 OIDC smoke、Docker migrator/app 和浏览器验收通过。

完整流程与降级边界见 [Phase 3 认证流程参考](./reference/phase3-auth-flows.md)。

## Phase 4 验收

Phase 4 已完成以下内部应用路径：

1. 平台管理员审批创建 confidential client，维护精确 redirect URI/scope，停用、恢复和轮换 secret。
2. OAuth secret 只在创建/轮换时返回；数据库仅保存不可逆摘要，配置变更撤销旧 token/consent。
3. Directory API 只接受已审批且启用 client 的服务凭据，并区分完整资料与状态最小 scope。
4. 用户停用立即撤销 HFLive Auth session，并为每个活跃订阅生成独立可靠 outbox。
5. worker 使用租约、重试/死信、10 秒超时、禁止重定向和独立 webhook HMAC secret。
6. `/admin` 统一展示 client、用户状态和追加式审计，移动端表格允许受控横向滚动。

验收结果：

- 第 6 个 migration 已在现有 PostgreSQL 原地应用；Phase 4 真实数据库专项 4 项通过。
- 未审批/停用 client、错误 redirect URI、越权 scope 和用户 token 调 Directory 均被拒绝。
- `pnpm validate` 与生产构建通过；既有 Phase 2/3 专项回归通过。
- Docker、OIDC smoke 和浏览器最终验收记录见开发日志。

完整 API、scope、签名和 worker 契约见 [Phase 4 内部应用参考](./reference/phase4-internal-apps.md)。

## Phase 5 完成验收

已完成：

1. JPEG/PNG/WebP 输入校验、8 MiB/8192 像素限制、服务端 512×512 WebP 规范化。
2. `ProfileAsset` 版本状态、私有 S3 兼容对象、同源 immutable URL、OIDC/Directory `picture` 数据源。
3. `user.profile.changed` 审计和按订阅 client 隔离的可靠 outbox。
4. Compose bucket 初始化、MinIO endpoint 隔离、standalone 镜像和重启后持久化读取。
5. PostgreSQL + 对象 bucket 一致备份、隔离恢复与回滚文档及本地演练。

官方生产已完成：

- Vercel Hobby 项目已从个人私有 fork 创建并成功部署，`auth.hsfz.live` 已绑定；health、Neon readiness、`hkg1`、OIDC discovery/issuer 与 Ed25519 JWKS 已通过正式域名只读验收。
- Neon 的 6 个 migration 已成功应用；pooled/direct URL 均显式使用 `sslmode=verify-full`，正式 redeploy 后 readiness 保持数据库 connected。
- 初始管理员已成功 bootstrap；历史无效邮箱已由受限命令修复，旧 challenge 已取消，Resend 新设备 OTP、会话、`ADMIN` 权限和管理控制台均通过真实登录验收。
- 私有 R2 bucket 已通过真实头像上传、应用读取和刷新后持久化验收。
- Cloudflare `hflive-auth-outbox-scheduler` 已部署 `* * * * *` Cron；secret 轮换后版本 `f4053126-4dd4-4c32-a55a-d2d3cf826a3a` 的真实 scheduled invocation 为 `outcome: ok`。
- EdgeOne 可选静态资源分发已在生产启用：Vercel Production 仅上传 `/_next/static/*` 到 `static-auth.hsfz.live`；生产登录页已引用该 origin，CSS/JS/WOFF2 的 HTTP/2、MIME、immutable cache、CORS/CORP 与 EdgeOne cache hit 均通过外部验收。
- API 缓存策略已硬化：JWKS 成功响应短期公开缓存，session/Directory/头像错误保持 `private, no-store`；头像非法 UUID 在查询数据库前返回 400。

转入 Phase 6 的接入验收：

- 以正式接入 client 运行完整 authorization code + PKCE OIDC smoke，并验证 OIDC/Directory `picture`。
- 使用 LiveBoard 订阅 client 验证 `user.profile.changed` webhook 的生产投递状态。

非阻塞运营验收：

- 创建真实成员邀请，验收邀请邮件与接受流程；不在生产创建 disposable 测试账号。
- 分别记录中国大陆与境外真实用户网络的加载时间和失败率；EdgeOne 技术链路通过不等于已经证明大陆访问提速。

## Phase 7 完成验收

已完成：

1. 登录页从 `GET /auth/config` 读取服务端真实能力，完整覆盖 local、hybrid、
   hflive_oidc 与受控 break-glass 展示矩阵。
2. OIDC 冲突 callback 回跳专用页面，单次票据仅放 fragment 并在读取后移除；普通
   成员用旧密码显式关联，管理员不允许自助合并。
3. 已有本地会话可在个人设置以当前密码发起 HFLive 关联；成功后仍创建 LiveBoard
   本地会话，应用角色和权限不改变。
4. 个人设置明确展示统一身份归属；HFLive 用户名、邮箱、显示名和头像只读并跳转
   HFLive 修改，bio、Banner、徽章和偏好继续由 LiveBoard 管理。
5. API 返回当前用户安全身份摘要并使用 `private, no-store`；服务端拒绝绕过 UI 修改
   HFLive 权威显示名或头像，local 回滚恢复旧本地资料。
6. 桌面/移动、键盘焦点、中文错误、过期票据、加载骨架和横向溢出均已验证。

完整契约与证据见 [Phase 7 LiveBoard 前端接入参考](./reference/phase7-liveboard-frontend.md)。

Phase 8 尚未开始：未发送真实成员邀请、未批量关联约 10 个旧用户、未切换官方实例
默认登录模式，也未移除 local 回滚能力。

## 已知限制与注意事项

- HFLive Auth 核心基础设施与 LiveBoard Phase 6 后端代码、migration、正式 dev client 和本机真实 OIDC/Directory/Redis 联调已完成；Vercel Production 稳定同源回调和 HFLive outbox 对 LiveBoard 生产 webhook 的真实投递尚未验收，因此不能表述为生产 LiveBoard 已完成切换。
- LiveBoard Docker PostgreSQL/Redis/MinIO 已运行，真实 Redis `GETDEL` 和 localhost HTTP Cookie 已验证；本轮没有重建 Compose app/migrator 镜像，也没有验证 HTTPS Cookie、Vercel Preview 隔离或 Production 回调。
- LiveBoard 的 `improveteach.md`、`teach.md` 是任务前已有未跟踪文件；`improveteach.md` 的既有 Prettier 风格使全量 `pnpm validate` 在 format 阶段退出。本轮未修改它们，改为对任务文件执行格式检查并独立完成 typecheck、test 和 build。
- Vercel Hobby 不支持每分钟原生 Cron；官方 Hobby 部署必须使用仓库内 Cloudflare Worker Cron，且 Vercel 与 Worker 注入相同的独立 `OUTBOX_WORKER_SECRET`。空闲休眠还需要 Worker KV `OUTBOX_PENDING` 与 Vercel `OUTBOX_WAKE_URL`；未绑定 KV 时分钟 Cron 仍会每次打醒 Neon。
- `hsfz.live` 未备案时 EdgeOne 只能选择 `overseas`，不能使用中国大陆节点；静态分发不承诺中国大陆访问速度。
- 自部署关闭邮件时邀请/恢复不可用，风险登录明确降级为密码登录并记录审计；官方生产禁止关闭邮件。
- 普通登录用户的 OAuth client 管理权限仍默认全部拒绝；所有 client 变更必须走平台管理员控制面。
- 仓库默认分支为 `main`；后续改动使用独立分支和 Draft PR。私有 Free 仓库暂不能启用 branch protection/ruleset，需依赖 CODEOWNERS 与人工评审约定。
- 本地 Docker volume 包含 disposable 测试用户与 client，官方部署必须使用全新数据库和 secret。
