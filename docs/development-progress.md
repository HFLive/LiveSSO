# 开发进度

最后更新：2026-08-09  
当前阶段：Phase 5 官方环境验收待执行  
生产状态：不可上线

本文件是项目当前完成度和下一步的唯一动态状态页。总体阶段定义见 [实施方案](../IMPLEMENTATION_PLAN.md)，Phase 1 的完成时证据见 [历史验收快照](../PHASE_1_STATUS.md)。

## 阶段总览

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| Phase 0 基础契约 | 完成 | issuer、claims、scopes、接入边界和部署模式已确认 |
| Phase 1 工程/OIDC 骨架 | 完成 | 本地、生产构建、真实 PostgreSQL、PKCE 和 Docker 均验证 |
| Phase 2 安全与领域数据 | 完成 | 领域模型、数据库约束、摘要策略、原子消费/租约和管理员审计 |
| Phase 3 邀请/邮件/风险登录 | 完成 | 邀请、首次密码、邮件 OTP、恢复、风险规则和 30 天受信设备 |
| Phase 4 内部应用管理 | 完成 | client 生命周期、Directory API、可靠签名事件与审计控制台 |
| Phase 5 头像与正式部署 | 进行中 | 头像与 Docker/MinIO/恢复已验收；Vercel/PostgreSQL/R2/邮件真实环境待凭据 |
| Phase 6 LiveBoard 后端 | 未开始 | 三种认证模式、ExternalIdentity、JIT、状态同步 |
| Phase 7 LiveBoard 前端 | 未开始 | 登录入口、账号关联、统一资料入口 |
| Phase 8 用户迁移 | 未开始 | 邀请、显式关联、hybrid 观察与回滚 |
| Phase 9 上线运维 | 未开始 | 安全测试、备份恢复、轮换与事故流程 |

## 当前可用能力

- 管理员邮件邀请、首次设置密码和普通用户账号创建。
- 用户名或邮箱单输入框登录、可解释风险规则、邮箱 OTP 和 30 天受信设备。
- 统一找回密码、单次 reset token、全会话撤销和安全提醒。
- 禁止公开注册、禁止动态客户端注册。
- OIDC discovery 与 authorization code + PKCE。
- consent、access/id/refresh token、userinfo、introspection、revocation、end-session 基础端点。
- PostgreSQL 持久化限流、会话、JWKS 和 OAuth 数据。
- 根域 issuer 与 EdDSA JWKS 轮换配置。
- 深色基础首页、登录页和 consent 页。
- liveness/readiness、安全响应头和 noindex。
- Vercel 配置、standalone Docker 镜像与 Compose 自动迁移。
- 初始唯一用户命令和 OIDC 端到端 smoke 脚本。
- `/admin` 提供 client 审批/停用/回调与 scope 维护/secret 轮换、用户状态和最近审计。
- Directory API 使用 `client_credentials` 与 `directory:user:read | directory:user:status` 最小 scope。
- 用户状态变化按订阅 client 生成独立 outbox，通过带时间戳 HMAC webhook 可靠投递。
- `/profile` 支持头像选择、裁切与键盘调整，服务端规范化为 512×512 WebP 并写入 R2/MinIO。
- 头像使用同源版本化 URL，旧版本保留，更新会写审计并生成 `user.profile.changed` outbox。

## 最近验证

- `pnpm validate`：通过。
- `pnpm build`：通过。
- PostgreSQL 17 共 6 个 migration：创建和实际应用通过。
- `pnpm oidc:smoke`：authorization code + PKCE、state、nonce、consent、token 和 claims 通过。
- Docker app/migrator 镜像：构建通过。
- Compose migrator：退出码 0；app readiness：HTTP 200。
- `pnpm test:phase3`：正常登录、风险 OTP、枚举保护、限流和关闭注册共 5 项通过。
- `pnpm test:phase4`：secret 摘要、client/scope/redirect 拒绝、Directory 与签名 outbox 共 4 项通过。
- 浏览器 1280×720 与 390×844：管理控制台无页面横向溢出或控制台错误，用户表格在移动端受控横向滚动，错误状态可读。
- `pnpm test:phase5`：真实 PostgreSQL + MinIO 的格式规范化、对象读回、版本替换和资料事件共 2 项通过。
- `pnpm oidc:smoke:phase4`：完整 authorization code + PKCE、consent、token、refresh token 与 claims 回归通过。
- 新 Compose 镜像：migrator/minio-init 退出 0，app readiness 200；浏览器头像真实上传、移动断点、键盘与错误状态通过。
- PostgreSQL custom dump 与 MinIO mirror 已恢复到隔离数据库/bucket，源/恢复计数一致；演练资源已清理。
- GitHub 仓库已初始化并发布到 `HFLive/LiveSSO`；CI、Dependabot、CODEOWNERS、安全策略和 PR 模板已合并到 `main`。

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

## Phase 5 当前验收

已完成：

1. JPEG/PNG/WebP 输入校验、8 MiB/8192 像素限制、服务端 512×512 WebP 规范化。
2. `ProfileAsset` 版本状态、私有 S3 兼容对象、同源 immutable URL、OIDC/Directory `picture` 数据源。
3. `user.profile.changed` 审计和按订阅 client 隔离的可靠 outbox。
4. Compose bucket 初始化、MinIO endpoint 隔离、standalone 镜像和重启后持久化读取。
5. PostgreSQL + 对象 bucket 一致备份、隔离恢复与回滚文档及本地演练。

尚未完成：

- Vercel Hobby 项目已从个人私有 fork 创建并成功部署，`auth.hsfz.live` 已绑定；health、Neon readiness、`hkg1`、OIDC discovery/issuer 与 Ed25519 JWKS 已通过正式域名只读验收。
- Neon 的 6 个 migration 已成功应用；私有 R2 bucket、bucket 级对象读写凭据、Resend 已验证邮件域名及发送专用 API key 已配置，仍须验证真实邮件接收和 R2 对象读写。
- Cloudflare 外部调度器尚未部署。
- 初始管理员已成功 bootstrap，但历史脚本允许无效邮箱值，首次风险登录向 Resend 发送 OTP 时被 `422 invalid to` 拒绝。邮箱输入校验与受限修复命令合并前不得再次登录或直接修改生产数据。

## 已知限制与注意事项

- 官方环境尚未验收，不能将本地构建或 MinIO 结果表述为 Vercel/R2 生产通过。
- Vercel Hobby 不支持每分钟原生 Cron；官方 Hobby 部署必须使用仓库内 Cloudflare Worker Cron，且 Vercel 与 Worker 注入相同的独立 `OUTBOX_WORKER_SECRET`。
- 自部署关闭邮件时邀请/恢复不可用，风险登录明确降级为密码登录并记录审计；官方生产禁止关闭邮件。
- 普通登录用户的 OAuth client 管理权限仍默认全部拒绝；所有 client 变更必须走平台管理员控制面。
- 仓库默认分支为 `main`；后续改动使用独立分支和 Draft PR。私有 Free 仓库暂不能启用 branch protection/ruleset，需依赖 CODEOWNERS 与人工评审约定。
- 本地 Docker volume 包含 disposable 测试用户与 client，官方部署必须使用全新数据库和 secret。
