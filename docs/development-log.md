# 开发日志

本文件按日期追加已经发生的开发事实、关键问题和验证结果。当前状态不要从日志推断，应读取 [development-progress.md](./development-progress.md)。

## 2026-08-09 — Phase 0/1 初始化

### 方向确认

- 官方域名和 OIDC issuer 确认为 `https://auth.hsfz.live`。
- 平台限定为 HFLive 内部/批准项目，不开放公共注册或第三方动态 client。
- 确认用户名或邮箱 + 密码为主登录路径，风险登录未来追加邮箱 OTP。
- 确认 PostgreSQL-only、Vercel 官方部署与 Docker 自部署两条路径。
- 确认 LiveBoard 将保留本地会话和应用角色，并在未来增加 `local | hybrid | hflive_oidc`。

### 工程实现

- 初始化 Next.js App Router、React、TypeScript、pnpm 工程。
- 接入 Better Auth、username、JWT/JWKS 和 OAuth Provider。
- 接入 Prisma 7 PostgreSQL driver adapter，生成并应用初始 migration。
- 建立根域 OIDC discovery、OAuth metadata、认证 catch-all 和健康检查。
- 实现用户名/邮箱单输入框登录和 consent 基础界面。
- 增加初版深色科技风 token、安全响应头和 robots noindex。
- 增加 Vercel、standalone Docker、PostgreSQL、MinIO、Mailpit 和 migrator 配置。
- 增加初始唯一用户脚本和完整 OIDC smoke 脚本。

### 验证中发现并修正

- pnpm 11 阻止依赖构建脚本：建立最小 `allowBuilds` 清单，没有全局放开脚本。
- TypeScript 7 与当前 typescript-eslint 不兼容：固定到 TypeScript 6.0.3。
- ESLint 10 与当前 React lint plugin 不兼容：固定到 ESLint 9.39.5。
- Next.js watcher 在本机触发 `EMFILE`：开发命令启用 `WATCHPACK_POLLING=true`。
- OAuth Provider 默认 issuer 包含 `/api/auth`：通过 JWT 配置明确固定站点根域 issuer。
- Docker slim 缺少 OpenSSL：基础镜像安装运行所需 OpenSSL。
- `.pnpm-store` 导致 Docker context 约 848 MB：补充 `.dockerignore`，复测降至小体积增量。
- Docker app 与首次生成 JWKS 使用不同 secret，导致私钥解密失败：Compose 改为统一读取 `BETTER_AUTH_SECRET`。
- 初版 Compose 不自动迁移数据库：增加一次性 migrator，并让 app 等待迁移成功。

### 验收结果

- username 和 email 登录均实际成功。
- OIDC authorization code + PKCE、state、nonce、consent、access/id/refresh token 和 claims 实际通过。
- `pnpm validate`、`pnpm build`、Docker image build 通过。
- migrator 退出码 0，standalone app readiness 返回 HTTP 200。
- 登录用户创建 OAuth client 被拒绝，符合当前默认关闭管理面的策略。
- 浏览器检查首页和登录页无横向溢出或控制台错误。

## 2026-08-09 — Phase 2 安全与领域数据

### 目标

- 冻结管理员权限、邀请、受信设备、风险 challenge、审计、头像元数据和 outbox 模型。
- 把一次性消费、失败计数和事件投递并发语义放入 PostgreSQL。
- 建立敏感值摘要、保留期和关键管理员操作审计契约。

### 实现

- `User` 增加默认 `USER` 的 `platformRole`，数据层角色变更会锁定 actor、验证 `ADMIN` 并记录成功或拒绝审计。
- 增加 `Invitation`、`TrustedDevice`、`LoginChallenge`、`AuditEvent`、`ProfileAsset` 和 `OutboxEvent` 模型及枚举、索引、外键和 check constraint。
- 邀请按规范化邮箱限制一个 pending 记录；邀请和 challenge 通过条件更新只消费一次。
- challenge 失败计数以单条 SQL 原子递增并在上限锁定。
- outbox 使用幂等键、`FOR UPDATE SKIP LOCKED`、有界租约、尝试上限、重试和死信状态。
- 审计事件禁止更新，只有超过 `expiresAt` 才允许删除；actor/subject/client ID 保存为不可变快照。
- 增加用途隔离 HMAC-SHA-256 摘要工具；生产环境强制独立 `SECURITY_HASH_SECRET`。
- 增加 Phase 2 数据参考和 `pnpm test:db` 真实 PostgreSQL 集成测试。

### 关键决定或问题

- 并发测试清理用户时发现已接受邀请的 `SET NULL` 与终态约束冲突，修正为以 `acceptedAt` 保留终态事实。
- 审计用户外键会在账号删除时改写追加式历史，因此移除审计外键，只保留 UUID 快照和查询索引。
- Compose 的必填变量插值会阻断 dependency-only 命令，改为由生产应用 env schema 在 app 真正启动时校验摘要 secret。
- 本地 `.env` 未配置新 secret 时，普通 `pnpm build` 按契约拒绝；使用一次性构建占位值验证通过，未修改本地 secret 文件。

### 验证

- 已有 Phase 1 PostgreSQL 数据库原地应用 3 个 Phase 2 migration 通过；全新临时数据库应用全部 4 个 migration 通过。
- `pnpm test:db`：真实 PostgreSQL 并发测试通过。
- `pnpm validate`：通过，6 个普通测试通过，数据库集成套件在该命令中按设计跳过。
- `SECURITY_HASH_SECRET=<build-only> pnpm build`：通过。
- Docker app/migrator 镜像构建通过；容器 migrator 在空库应用全部 migration 后退出 0。
- 新 app 镜像连接空库启动，`/api/health/ready` 返回 `200` 与 `database=connected`。

### 遗留事项

- Phase 3 实现邀请/首次密码、邮件 OTP、风险规则和 30 天受信设备业务流程与界面。
- Phase 4 实现 outbox 投递 worker、Directory API 和客户端管理流程。

## 2026-08-09 — Phase 3 邀请制账号与邮件

### 目标

- 完成管理员邀请、首次设置密码、单输入框登录、邮件 OTP、找回密码和安全提醒。
- 落实可解释风险规则、30 天受信设备、枚举保护和数据库暴力尝试限制。
- 提供登录、验证、邀请、恢复和统一错误页面。

### 实现

- 增加 Better Auth 自定义风险认证端点，关闭可绕过风险层的原始密码登录和公开注册端点。
- 邀请固定创建普通用户，7 天有效；邀请接受在事务中创建 Better Auth credential account 并原子消费 token。
- 新设备、近期失败、异常频率、IP 与 User-Agent 变化触发 10 分钟邮件 OTP；验证成功后才创建会话，可保存 30 天受信设备。
- 增加 `AccountStatus` 和 migration；停用账号与不存在账号、错误密码返回统一错误。
- 增加 SMTP/Mailpit 与通用 HTTP API 邮件 transport、密码恢复、全会话撤销和安全提醒。
- 增加 Phase 3 页面、移动端样式、`test:phase3` 真实 PostgreSQL + Mailpit 集成测试，并更新 OIDC smoke 使用受保护登录端点。

### 关键决定或问题

- 风险登录必须在 OTP 完成前不创建会话，因此由业务端点直接验证 credential，并仅在普通路径或 challenge 原子消费后调用 Better Auth 会话能力。
- 自部署可明确关闭邮件：邀请/恢复不可用，风险登录记录 `mailDegraded` 后继续；官方生产仍由 env schema 强制邮件可用。
- 安全提醒发送失败不能让已经成功的账号创建、密码重置或登录伪装成失败，因此提醒采用不回滚主安全操作的尽力投递；首次邀请和 OTP 发送失败仍会阻断对应流程。

### 验证

- `pnpm validate`：通过，普通套件 9 项通过，数据库专项按设计跳过。
- `SECURITY_HASH_SECRET=<build-only> pnpm build`：通过，13 个页面/路由完成生产构建。
- `pnpm db:deploy`：已有 PostgreSQL 原地应用第 5 个 migration；`pnpm test:db` 4 项通过。
- `pnpm test:phase3`：5 项通过，覆盖受信设备直登、风险 OTP、枚举一致、数据库限流和公开注册关闭。
- `pnpm oidc:smoke`：更新后的风险认证入口完成 authorization code + PKCE、consent、token 与 claims 回归。
- Docker app/migrator 新镜像构建通过；migrator 识别 5 个 migration 并退出 0；readiness 200；公开注册端点 404。
- 浏览器在 1280×720 和 390×844 检查登录、OTP、邀请、恢复和错误页面，无横向溢出或控制台错误；原生控件均在默认 Tab 顺序中。

### 遗留事项

- Phase 4 实现 client/用户/审计管理、Directory API 和可靠 outbox 投递。
- Phase 5 完成头像对象存储与官方/自部署正式环境验收。

## 2026-08-09 — Phase 4 内部应用管理

### 目标

- 完成管理员 client 生命周期、用户状态和审计控制面。
- 提供最小权限 Directory API 与可靠、可验签的账号事件。
- 验收未审批 client、错误 redirect URI、越权 scope 和 secret 一次性展示边界。

### 实现

- `OauthClient` 增加显式审批状态、审批人和时间；数据库约束要求未审批 client 必须停用。新增一对一 `ClientWebhook`，签名 secret 使用 AES-256-GCM 加密。
- `/admin` 和 `/api/admin/*` 支持 client 创建、回调/scope 维护、停用/恢复、secret 轮换、用户状态和最近审计。OAuth secret 只在创建/轮换响应中出现，数据库只保存 SHA-256 摘要。
- 授权端点在登录前校验审批、停用状态、精确 redirect URI 与 scope。配置修改、停用和轮换撤销相应 token；配置修改同时撤销旧 consent。
- 增加 `directory:user:read` 与 `directory:user:status`，仅接受 `client_credentials` access token；拒绝 authorization-code 用户 token。
- 用户停用在事务中撤销全局 session，并为每个订阅 client 生成独立 outbox。worker 使用 Phase 2 租约/重试/死信原语、10 秒超时、禁止重定向和时间戳 HMAC 签名。
- Vercel 增加每分钟 cron；生产要求 `OUTBOX_WORKER_SECRET` 或平台 `CRON_SECRET`。增加 Phase 4 参考文档与可自清理的 OIDC smoke fixture。

### 关键决定或问题

- OAuth Provider 的 M2M access token 在当前配置下默认是 opaque token，不应假设总是 JWT。Directory 鉴权同时覆盖数据库摘要 opaque token 与 EdDSA JWT，并在两条路径都重新检查 client、scope、期限和服务主体边界。
- 首次浏览器验收捕获 React hydration 错误：容器 SSR 与浏览器默认时区不同导致审计时间文本不一致。改为显式 `Asia/Shanghai` 格式化后复测无控制台错误。
- 第一次 Docker 构建暴露 smoke 脚本动态 import 带 `.ts` 后缀与容器 TypeScript 配置不兼容；修正为无扩展名 import，宿主与容器构建均通过。

### 验证

- 现有 PostgreSQL 原地应用第 6 个 migration；`pnpm test:db` 4 项通过。
- `pnpm validate`：9 项普通测试通过；`pnpm test:phase3` 5 项和 `pnpm test:phase4` 4 项通过。
- 生产构建与 Docker app/migrator 镜像构建通过；migrator 识别 6 个 migration 后退出 0；readiness 返回 `200` 与 `database=connected`。
- `pnpm oidc:smoke:phase4` 使用自动创建并清理的用户/client 完成 authorization code + PKCE、consent、token 与 claims 回归。
- 浏览器 1280×720 和 390×844 检查 `/admin`：页面无横向溢出；移动表格 `overflow-x:auto`；表单错误可读；修正后无新增控制台错误。

### 遗留事项

- Phase 5 实现头像裁切、对象存储、版本化 URL，并完成 Vercel/R2 与 Docker/MinIO 正式部署验收。

## 2026-08-09 — Phase 5 头像与自部署验收

### 目标

- 完成头像上传、裁切、服务端格式校验、对象存储和版本化资料 URL。
- 接通 `user.profile.changed` 审计/outbox，并验证 Docker + PostgreSQL + MinIO 路径。
- 建立 PostgreSQL 与对象 bucket 的一致备份、隔离恢复和回滚操作手册。

### 实现

- 新增 `/profile` 与头像上传/读取 API；浏览器提供缩放和横纵裁切控制，服务端使用 Sharp 重新解码并统一生成 512×512 WebP。
- S3 兼容存储适配 R2/MinIO；bucket 保持私有，`User.image` 使用同源版本化 API URL，响应使用 immutable cache。
- 头像替换复用 `ProfileAsset` 状态机；激活时锁定用户、替换旧版本、写入审计，并为每个订阅 client 创建独立资料事件。
- 官方生产环境强制启用对象存储并校验完整 S3 配置；自部署允许明确降级。
- Compose 增加幂等 `minio-init`，并用独立 `APP_S3_ENDPOINT` 区分宿主机 `localhost:59000` 与容器 `minio:9000`。
- 增加 Phase 5 专项真实集成测试、资料/部署参考和备份恢复操作手册。

### 关键决定或问题

- 第一次浏览器上传失败暴露宿主机 S3 endpoint 被原样注入容器；容器中的 `localhost` 指向 app 本身，因此改用 Compose 专用 endpoint 变量。
- 第一次宿主机备份演练暴露 MinIO 必须启用 path-style；补充 `S3_FORCE_PATH_STYLE=true` 后真实 SDK 写入和清理通过。
- 测试清理不能删除未到保留期的追加式审计事件；专项测试保留审计快照，只清理自己创建的用户、client、outbox 和对象。

### 验证

- `pnpm validate`：11 项普通测试通过，专项按开关跳过。
- `pnpm test:phase5`：2 项通过；真实 PostgreSQL + MinIO 验证 PNG/JPEG 解码、512×512 WebP、对象读回、版本替换、用户 URL 和按 client 资料事件。
- `pnpm build` 与 Compose app/migrator 镜像构建通过；migrator 与 minio-init 退出 0，readiness 返回 200。
- `pnpm oidc:smoke:phase4`：authorization code + PKCE、state、nonce、consent、token、refresh token 与关键 claims 回归通过。
- 浏览器真实上传通过；键盘滑杆、成功/错误状态、390×844 无横向溢出且无控制台错误；头像响应为 200、WebP、512×512、immutable cache。
- PostgreSQL custom dump 与 MinIO mirror 恢复到隔离数据库/bucket；源/恢复用户数均为 3、头像元数据均为 2，两个对象均恢复。隔离资源和测试对象已删除。
- 重启 PostgreSQL 与 MinIO 容器后用户数保持 2，disposable 对象内容一致，app readiness 仍为 200；对象随后删除。

### 遗留事项

- 当前工作区没有 Vercel、托管 PostgreSQL、R2 和生产邮件 API 的授权配置，因此官方真实环境验收尚未执行。Phase 5 不能标记全部完成，也不能开始生产上线。
- 获得官方资源后按 Phase 5 参考清单执行 migration、邮件、头像、OIDC/Directory `picture` 和 webhook 全链路验收。

## 2026-08-09 — GitHub CI 与仓库治理

### 目标

- 为新发布的 `HFLive/LiveSSO` 建立最小权限 CI、依赖更新、安全报告和评审入口。
- 让普通校验、真实依赖集成测试和容器构建在 pull request 上自动回归。

### 实现

- 增加 `validate-and-build`、`integration`、`container-build` 三个 GitHub Actions job；工作流只有 contents read 权限。
- 仅使用 GitHub 官方 `checkout` 与 `setup-node` v7 Action，并固定完整 commit SHA；pnpm 由 Corepack 锁定到 11.7.0。
- 集成 job 使用 disposable PostgreSQL、MinIO、Mailpit 和 volume，应用正式 migration 后运行 Phase 2–5 专项。
- 增加 pnpm/GitHub Actions 每周 Dependabot 更新、CODEOWNERS、中文 PR 模板和私密漏洞报告策略。
- README 增加 CI 状态和安全入口；开发文档同步仓库、CI 与私有 Free 分支保护限制。

### 验证

- CI 与 Dependabot YAML 可由本地 YAML parser 读取；Compose 配置校验通过，`minio-init` 实际退出 0。
- `pnpm validate`：11 项普通测试通过，专项按开关跳过。
- 生产构建通过，20 个 Next.js 路由完成生成。
- Draft PR #1 首轮 GitHub Actions 中，`validate-and-build` 与 `container-build` 通过；`integration` 因全新 runner 未生成 Prisma Client 而失败。
- 已在集成任务安装依赖后增加 `pnpm db:generate`，并把两个官方 Action 更新到当前 v7 稳定版本的完整 SHA。
- 修正后本地 Prisma Client 生成、YAML 解析、Compose 配置及 Phase 2–5 四组真实集成测试全部通过。
- Draft PR #1 第二轮 GitHub Actions（run `31306012397`）三项全部通过：`integration` 1 分 14 秒、`validate-and-build` 1 分 22 秒、`container-build` 1 分 53 秒。

### 遗留事项

- 私有 GitHub Free 仓库无法启用 branch protection/ruleset；当前以 CODEOWNERS、Draft PR 和人工评审约定补足，升级 Team 或公开后再启用强制规则。

## 2026-08-09 — 依赖安全基线

### 目标

- 处理仓库启用 Dependabot 后发现的 16 个 npm 告警，同时避免为清零告警把认证核心直接升级到预发布版本。

### 实现

- 移除代码、脚本和文档均未使用的 `@better-auth/cli@1.4.21`；继续使用 Prisma CLI 管理当前手写并审查的 schema 与 migration。
- 锁文件删除该 CLI 带入的旧 Better Auth、Drizzle ORM、Lodash 和相关工具链，共减少 66 个安装包。
- OAuth Provider 显式固定单一 `validAudiences: [BETTER_AUTH_URL]`；Directory JWT 校验继续只接受 issuer audience。
- Dependabot 忽略 `@types/node` 主版本更新但继续接收 24.x minor/patch，避免 Node.js 22 项目被自动升级到 Node 26 类型基线。

### 关键决定或问题

- `@better-auth/oauth-provider@1.6.26` 的 GHSA-p2fr-6hmx-4528 仅在 1.7 beta/RC 中修复，且升级需要 schema migration 和 claims API 变更，本轮不采用预发布认证依赖。
- 当前部署不配置多 audience，资源服务也不依赖客户端选择的 `resource` 做授权；按公告 workaround 固定单一 audience，并保留告警直至稳定版修复可用。

### 验证

- 移除前 `pnpm audit` 为 1 critical、9 high、4 moderate、1 low；移除后仅剩上述 1 个 moderate runtime 告警。
- `pnpm install --frozen-lockfile`、`pnpm validate` 和使用一次性构建占位 secret 的生产构建通过；20 个 Next.js 路由完成生成。
- Phase 4 真实集成测试通过，并新增非白名单 `resource` 被 400 拒绝、M2M opaque token 继续通过 Directory 最小权限校验的回归断言。
- 在独立 3100 端口运行新生产构建，完整 OIDC authorization code + PKCE、state、nonce、consent、token、refresh token 与 claims smoke 通过；临时服务已停止。
- migrator 与 app Docker 镜像实际构建通过，容器内 frozen lockfile 安装和供应链策略检查通过。

### 遗留事项

- Better Auth 1.7 稳定版发布后，单独评估 schema migration、`customAccessTokenClaims` API、授权码/刷新令牌 resource 绑定和回滚，再关闭 GHSA-p2fr-6hmx-4528。

## 2026-08-09 — Hobby 官方部署调度方案

### 目标

- 在不升级 Vercel Pro 的前提下保留可靠事件每分钟分发，并解除 Hobby 部署对高频原生 Cron 的限制。

### 实现

- 从 `vercel.json` 移除 Hobby 不支持的每分钟 Cron。
- 增加 Cloudflare Worker Cron 配置，每分钟以 HTTPS `POST` 和 Bearer secret 调用既有 outbox worker 端点。
- Worker 强制 HTTPS、禁止跟随重定向，失败时只暴露 HTTP 状态码，不读取响应正文或记录 secret。
- 更新 Phase 4/5 契约和进度，明确 Vercel 与 Cloudflare Worker 必须注入同一个独立 `OUTBOX_WORKER_SECRET`。

### 关键决定或问题

- Vercel Hobby 仅支持低频原生 Cron，不能满足当前每分钟 outbox 契约；外部调度只替换触发器，不改变数据库租约、重试、dead letter 或 webhook 签名语义。
- Cloudflare Worker Free 每分钟约 1,440 次调用，低于当前免费请求配额；生产验收仍需检查实际 invocation 和 outbox 状态。

### 验证

- `pnpm validate` 通过：Lint、类型检查和常规测试均成功；新增 3 个 Worker 测试覆盖 Bearer 请求、HTTPS 限制、禁止重定向和不读取失败响应正文。
- 使用一次性构建占位 secret 的 `pnpm build` 通过，20 个页面/路由完成生产构建；未配置生产专用摘要和 worker secret 时构建继续按安全门禁失败。
- Wrangler 4.120.0 `deploy --dry-run` 通过，正确识别 `AUTH_ORIGIN` binding，未创建远程 Worker 或触发器。
- Vercel 部署与 Cloudflare Cron 真实触发仍待验收。

### 遗留事项

- 正式域名可用且 Vercel 环境变量生效后部署 Worker，并记录首次成功调度证据。

## 2026-08-09 — Vercel 与 Docker 双构建产物

### 目标

- 修复 Vercel 首次部署在收集 Next.js tracing 产物时缺少 `.next/next-server.js.nft.json` 的构建错误，同时保留 Docker standalone 镜像。

### 实现

- Vercel 平台或 `DEPLOYMENT_MODE=official` 构建交由 Vercel Next.js 框架集成生成函数产物，不再强制 `output: "standalone"`。
- 非 Vercel/self-hosted 构建继续生成 `.next/standalone`，Dockerfile runner stage 无需改变。

### 关键决定或问题

- Vercel 首次构建已完成 Next.js 编译，但平台收集阶段读取不存在的 standalone tracing 清单并以 `ENOENT` 失败；数据库 migration 已在部署前成功应用，不属于本次错误原因。
- 两类部署共享业务代码，但使用各自原生的打包产物，避免 Vercel 函数收集器与 Docker standalone 目录互相干扰。

### 验证

- `VERCEL=1 DEPLOYMENT_MODE=official` 的生产构建通过，20 个页面/路由生成完成；`.next/standalone` 不存在且 `.next/next-server.js.nft.json` 存在。
- `DEPLOYMENT_MODE=self_hosted` 的生产构建通过，`.next/standalone` 与 server tracing 清单均存在。
- `pnpm validate` 通过：Lint、类型检查和常规测试均成功。
- `docker build -t hflive-auth:vercel-output-fix .` 通过，runner stage 成功复制 standalone 与静态产物；仅报告既有 build-only 占位 ENV 的 Docker secret lint 警告，不包含生产 secret。
- 真实 Vercel 重新部署仍待验收。

### 遗留事项

- 修复合并并同步个人 fork 后重新部署，记录 deployment URL 与 readiness。

## 2026-08-09 — 初始平台管理员闭环

### 目标

- 修复角色模型加入后 bootstrap 用户仍继承默认 `USER`、导致空生产实例没有任何管理员的阻塞缺陷。

### 实现

- 将空数据库 bootstrap 明确为唯一初始 `ADMIN` 创建路径；邀请、JIT 和普通用户默认角色不变。
- 使用 PostgreSQL transaction advisory lock 串行化“空数据库”检查，防止两个初始化进程并发创建多个管理员。
- 在同一事务写入 `platform.admin.bootstrap` SYSTEM/CRITICAL 审计，保留 400 天；成功日志不再输出用户名或邮箱。
- 更新初始化说明、Phase 2 角色不变量和 Phase 5 当前状态。

### 关键决定或问题

- 正式域名、readiness、OIDC discovery 和 JWKS 已通过真实生产只读检查，但在此修复合并前不会创建生产用户。

### 验证

- 新增 2 个单元测试，覆盖 advisory lock 先于空库检查、显式 `ADMIN`、SYSTEM/CRITICAL 审计和已有用户拒绝；`pnpm validate` 全部通过，共 16 个常规测试成功。
- 在独立临时 PostgreSQL 数据库应用 6 个 migration 后执行真实 bootstrap，验证结果为 `ADMIN|platform.admin.bootstrap|SYSTEM|CRITICAL`；第二次执行按设计失败，临时数据库已删除。
- 首次临时验证发现 Prisma 7 driver adapter 不能反序列化 advisory lock 的 `void` 返回列；查询改为保留锁副作用但只返回整数后再次完整验证通过，失败尝试未写入用户。
- Vercel managed-output 与 self-hosted standalone 两类生产构建均通过，20 个页面/路由完成生成。
- GitHub CI 待验证。

### 遗留事项

- 修复合并后仅在确认生产 `user` 表为空时执行一次 bootstrap，并验证管理员登录与审计记录。

## 2026-08-09 — Neon 生产 bootstrap 事务等待窗口

### 目标

- 修复初始管理员命令连接 Neon Singapore direct endpoint 时无法在 Prisma 默认等待窗口内开始事务的问题。

### 实现

- 仅将 bootstrap interactive transaction 的 `maxWait` 和 `timeout` 显式设为 15 秒；不改变 Web、认证或其他数据库请求的连接与超时策略。
- 官方 Neon 部署说明改为显式使用 `sslmode=verify-full`，并保留 Neon 提供的 channel binding 参数，避免依赖 `pg` 下一主版本将变化的兼容语义。
- 单元测试新增 bootstrap 事务选项断言。

### 关键决定或问题

- 首次生产执行在事务开始前以 Prisma `P2028` 失败，因此没有创建用户或审计记录；同次输出的 SSL mode 警告不是该失败的直接原因。
- 初始化事务包含 advisory lock、空库检查和两次写入；提高的是等待取得连接/开始事务的窗口，不移除并发保护。

### 验证

- bootstrap 单元测试通过，覆盖 15 秒事务等待/执行窗口以及既有管理员创建与重复执行拒绝契约。
- `pnpm validate` 通过：Lint、类型检查和 16 个常规测试全部成功。
- Vercel managed-output 生产构建通过，20 个页面/路由生成完成；`.next/standalone` 不存在且 server tracing 清单存在。
- self-hosted standalone 生产构建通过，standalone server 与 server tracing 清单均存在。
- 第一次本地 Vercel 构建模拟未注入 build-only 生产必需变量，被环境校验按设计拒绝；加入非生产占位值后重新构建通过，未使用生产 secret。

### 遗留事项

- 修复合并并重新部署后，使用 direct URL 重试一次 bootstrap，再验证管理员登录和审计记录。

## 2026-08-09 — 初始管理员无效邮箱修复

### 目标

- 修复 bootstrap 只检查邮箱非空、允许无效值进入生产数据库并导致首次风险登录 OTP 被 Resend 拒绝的问题。

### 实现

- bootstrap 入口与领域函数都使用最长 254 字符的邮箱格式校验，拒绝 shell 引号、显示名和其他非普通邮箱值。
- 新增受限修复命令：只允许唯一用户、有效 bootstrap SYSTEM 审计、`ACTIVE ADMIN` 且现有邮箱格式无效时更新邮箱。
- 修复与 bootstrap 共用 advisory lock；事务内取消该管理员遗留的 `PENDING` 登录 challenge，并写入不包含邮箱值的 CRITICAL SYSTEM 审计。

### 关键决定或问题

- 正式登录已通过密码验证并进入新设备 OTP 路径；Resend 日志明确返回 `422 validation_error: Invalid to field`，因此不重新 bootstrap、不关闭风险登录，也不直接执行宽泛 SQL。

### 验证

- 新增专项单元测试覆盖无效 bootstrap 邮箱拒绝、受限修复、challenge 取消、审计和已有效邮箱拒绝；`pnpm validate` 通过，共 19 个常规测试成功。
- 在独立临时 PostgreSQL 数据库应用 6 个 migration，模拟唯一 bootstrap ADMIN、无效邮箱和 `PENDING` challenge；修复后验证邮箱精确匹配、`emailVerified=true`、challenge=`CANCELLED`、`platform.admin.bootstrap_email_repaired|SYSTEM|CRITICAL`，第二次修复按设计拒绝，临时数据库已删除。
- Vercel managed-output 与 self-hosted standalone 两类生产构建均通过，20 个页面/路由完成生成，产物模式断言通过。

### 遗留事项

- 修复合并后在生产 direct 连接上执行一次受限邮箱修复，重新登录并验证 Resend OTP、会话与管理页面。

## 2026-08-09 — Phase 5 官方核心基础设施验收

### 目标

- 完成 Vercel、Neon、Resend、R2 与 Cloudflare 外部调度器的真实生产闭环，并明确仍待正式 client 验证的边界。

### 实现

- 将 Neon pooled/direct 连接串显式切换为 `sslmode=verify-full` 并重新部署，保留既有 channel binding 参数。
- 使用受限命令修复唯一 bootstrap 管理员的历史无效邮箱，取消遗留 challenge；通过 Resend OTP 完成首次新设备登录。
- 部署 `hflive-auth-outbox-scheduler`，以 Cloudflare secret binding 注入与 Vercel 相同的独立 worker secret，并启用每分钟 Cron。

### 关键决定或问题

- 首次 Cloudflare 注入时发现随机值被误用为 binding 名称；在启用正式调度后立即撤下 Cron、删除错误 binding，并同时轮换 Vercel 与 Cloudflare 两端密钥。旧值不再有效，仓库和文档未记录任何 secret 值。
- Worker 首次创建使用无 Cron 临时配置；仅在确认 binding 名称为 `OUTBOX_WORKER_SECRET` 后才部署仓库正式 trigger，临时文件随后删除且未进入 Git。

### 验证

- 多次正式 redeploy 后 `https://auth.hsfz.live/api/health/ready` 均返回 200、数据库 connected，`x-vercel-id` 显示 `hkg1`。
- 管理员密码验证、Resend 6 位 OTP、会话、根路径回跳、`/admin` 权限均通过真实浏览器验收。
- R2 真实头像上传、应用读取和刷新后持久化通过。
- Cloudflare 正式版本 `f4053126-4dd4-4c32-a55a-d2d3cf826a3a` 已绑定 `* * * * *`；实时 tail 捕获 scheduled event `outcome: ok`，无 exception 或错误日志。

### 遗留事项

- 创建正式接入 client，运行 authorization code + PKCE OIDC smoke，验证 OIDC/Directory `picture` 与 `user.profile.changed` webhook。
- 使用真实成员邮箱验收邀请邮件与接受流程；不在生产创建 disposable 测试账号。

## 2026-08-09 — EdgeOne 可选静态资源分发

### 目标

- 参考 LiveBoard 的静态资源发布边界，把 Next.js 内容哈希资源作为可选路径发布到 EdgeOne，同时保持认证和用户数据仍由原有 Vercel/R2 链路提供。

### 实现

- 新增 `vercel | edgeone` 静态资源 provider 配置；默认 `vercel`，EdgeOne origin 只接受无凭据、路径、查询或 fragment 的 HTTPS origin。
- Next.js 使用受校验的 `assetPrefix`；Production postbuild 只暂存 `.next/static` 并通过固定版本 EdgeOne Makers CLI 上传到 `overseas` 项目。
- 上传内容设置 immutable/CORS 响应头；脚本从公开 origin 回读代表性资源，验证 HTTP、JavaScript MIME 与精确字节，失败时阻止 Production 部署。
- 增加环境变量示例、配置单元测试，以及未备案区域限制、启用、验收和一键回滚文档。

### 关键决定或问题

- `hsfz.live` 未备案，不能使用 EdgeOne 中国大陆或全球可用区；实现固定为 `overseas`，不把该能力描述为确定的中国大陆加速。
- EdgeOne 只接收公开 `/_next/static/*`。HTML、API、认证 cookie/token、头像和私有 R2 对象均不迁移。
- 上传只在 Vercel Production 执行；Preview、本地和 Docker 构建无外部副作用。默认 provider 不改变现有生产部署。

### 验证

- `pnpm validate` 通过：Lint、类型检查及 22 个常规测试成功，15 个需外部服务的测试按条件跳过。
- Vercel managed-output 构建通过，20 个页面/路由生成完成；静态 HTML/RSC 已引用测试 EdgeOne origin，server tracing 清单存在且 `.next/standalone` 不存在。
- self-hosted standalone 构建使用非生产 build-only 占位值通过；standalone server 与 tracing 清单均存在，产物不包含测试 EdgeOne origin。
- Production 默认 `vercel` 路径确认跳过上传；选择 `edgeone` 但缺少 token 时确认以非零状态拒绝构建。

### 遗留事项

- 创建真实 EdgeOne Makers `overseas` 项目、绑定静态域名并在 Vercel Production 注入 token 后完成首次真实上传和公开回读。
- 分别进行中国大陆与境外网络测量，再决定是否长期启用；若结果不佳则切回 `STATIC_ASSET_PROVIDER=vercel`。

## 后续记录格式

新增日期条目时使用以下结构，并只写实际发生的内容：

```markdown
## YYYY-MM-DD — 阶段或主题

### 目标
### 实现
### 关键决定或问题
### 验证
### 遗留事项
```
