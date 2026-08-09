# HFLive Auth

[![CI](https://github.com/HFLive/LiveSSO/actions/workflows/ci.yml/badge.svg)](https://github.com/HFLive/LiveSSO/actions/workflows/ci.yml)

HFLive 内部项目的统一身份服务。官方 issuer 计划固定为 `https://auth.hsfz.live`，首个接入方是 LiveBoard。

完整方向与阶段划分见 [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)。Phase 0–4 已完成；Phase 5 的头像、对象存储、Docker/MinIO 和备份恢复已通过本地验收，官方 Vercel + PostgreSQL + R2 + 邮件 API 仍等待真实环境授权验证。LiveBoard 接入将在后续阶段推进。

## 项目文档

- [文档中心](./docs/README.md)
- [架构与关键边界](./docs/architecture.md)
- [当前开发进度](./docs/development-progress.md)
- [开发日志](./docs/development-log.md)
- [本地开发与验证](./docs/local-development.md)
- [Codex/AI 开发约束](./AGENTS.md)
- [安全漏洞报告](./SECURITY.md)

## 本地开发

要求 Node.js 22、pnpm 11 和 Docker。

```bash
pnpm install
docker compose up -d postgres minio mailpit
docker compose up minio-init
pnpm db:migrate
pnpm dev
```

- Web：<http://localhost:3000>
- liveness：<http://localhost:3000/api/health>
- readiness：<http://localhost:3000/api/health/ready>
- Mailpit：<http://localhost:58025>
- MinIO Console：<http://localhost:59001>

仓库内 `.env` 只含本地开发凭据并被 Git 忽略。部署时从 `.env.example` 配置真实秘密；不得复用开发 secret。所有生产部署必须分别设置不同的 `BETTER_AUTH_SECRET` 和 `SECURITY_HASH_SECRET`。

首次启动且数据库中还没有任何用户时，可以创建唯一的初始平台管理员：

```bash
BOOTSTRAP_EMAIL=you@example.com \
BOOTSTRAP_USERNAME=your_name \
BOOTSTRAP_NAME='Your Name' \
BOOTSTRAP_PASSWORD='use-a-long-random-password' \
pnpm user:create-initial
```

该命令在事务内取得 PostgreSQL advisory lock，只允许空数据库创建一个 `ADMIN`，并写入 `platform.admin.bootstrap` SYSTEM 审计。数据库已有任意用户后会拒绝运行；后续账号必须走管理员邀请流程且默认保持 `USER`。

`BOOTSTRAP_EMAIL` 只接受普通邮箱地址，不要包含 shell 引号或 `Name <email>` 显示名。历史版本若已为唯一 bootstrap 管理员写入无效邮箱，可使用 `REPAIR_ADMIN_EMAIL` 配合 `pnpm user:repair-initial-email` 做一次受限修正；命令在现有邮箱有效、用户不唯一或无法验证 bootstrap 审计时都会拒绝执行。

仓库还提供 `pnpm oidc:smoke`，用于对已登记的本地测试客户端执行完整 authorization code + PKCE、consent、token 和 ID token claim 验证。它要求通过 `OIDC_SMOKE_*` 环境变量传入测试账号与客户端凭据，凭据不会写入仓库。`pnpm test:phase3`、`pnpm test:phase4` 与 `pnpm test:phase5` 分别验证邀请/风险登录、内部应用/事件和真实 PostgreSQL + MinIO 头像路径。

## 数据库

Better Auth schema 由 CLI 根据 `src/lib/auth.ts` 生成，但迁移由 Prisma 管理：

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:deploy
```

官方 Serverless 运行时应使用 PostgreSQL pooled URL 作为 `DATABASE_URL`，迁移命令使用直连 `DIRECT_DATABASE_URL`。应用不支持 SQLite。

## 部署模式

- `DEPLOYMENT_MODE=official`：官方生产模式，邮件能力是硬性要求。
- `DEPLOYMENT_MODE=self_hosted`：允许显式关闭邮件和对象存储；依赖这些能力的功能也会被关闭。

Vercel 使用 `vercel.json` 和平台环境变量。Docker 自部署可运行：

```bash
docker compose --profile app up -d --build
```

该命令会先运行一次性 `migrate` 与幂等 `minio-init` 服务；只有数据库迁移和私有 bucket 初始化成功后才启动 Web 容器。

正式自部署前必须替换数据库密码、`BETTER_AUTH_SECRET`、`SECURITY_HASH_SECRET`、外部 URL 和可信 origin，并通过反向代理启用 HTTPS。

## 当前安全边界

- 公开注册已禁用。
- OIDC dynamic client registration 已禁用。
- OAuth client secret、opaque access token 与 refresh token 采用摘要存储。
- OIDC 授权码有效期 5 分钟，access/id token 15 分钟，refresh token 30 天。
- Better Auth 限流状态存入 PostgreSQL，不依赖 Serverless 进程内存。
- 邀请、OTP、受信设备 token 和请求上下文采用用途隔离的 HMAC 摘要。
- 管理员角色变更经过数据库事务授权并写入追加式审计。
- 页面禁止被 iframe 嵌入，站点不允许搜索引擎索引。

当前已提供邀请、风险认证、密码恢复、内部 client、Directory API、可靠事件、管理控制台和头像能力。由于官方生产环境尚未完成真实验收，当前版本仍不可直接投入生产。
