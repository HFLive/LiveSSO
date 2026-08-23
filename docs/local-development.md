# 本地开发与验证

## 环境要求

- Node.js `>=22 <23`
- pnpm `11.7.0`
- Docker Desktop / Docker Engine + Compose
- 可用端口：`3000`、`55432`、`51025`、`58025`、`59000`、`59001`

## 首次启动

```bash
pnpm install
docker compose up -d postgres minio mailpit
pnpm db:migrate
pnpm dev
```

访问地址：

- 应用：<http://localhost:3000>
- liveness：<http://localhost:3000/api/health>
- readiness：<http://localhost:3000/api/health/ready>
- Mailpit UI：<http://localhost:58025>
- MinIO Console：<http://localhost:59001>

`.env` 是被 Git 忽略的本地配置；从 `.env.example` 创建时必须更换占位 secret。不要将本地 `.env`、数据库 volume 或测试凭据复制到部署环境。

生产环境必须分别配置 `BETTER_AUTH_SECRET` 与 `SECURITY_HASH_SECRET`。后者用于邀请、OTP、受信设备和请求上下文摘要，不得与会话/JWKS 密钥复用。开发环境可以暂时回退到 `BETTER_AUTH_SECRET`，但不能把该降级带入任何生产部署。

本地验证邮件流程时设置：

```bash
MAIL_ENABLED=true
MAIL_TRANSPORT=smtp
MAIL_SMTP_HOST=localhost
MAIL_SMTP_PORT=51025
```

以上端口适用于宿主机运行 `pnpm dev`。Compose app 容器默认连接 `mailpit:1025`；可通过同名环境变量覆盖为外部 SMTP 或 HTTP provider。

生产 HTTP 邮件供应商使用 `MAIL_TRANSPORT=http`、`MAIL_API_URL` 和可选 `MAIL_API_TOKEN`。自部署关闭邮件会同时关闭邀请与找回密码，并让风险登录以可审计的降级方式继续；官方生产不允许该降级。

静态资源默认继续由 Next.js/Vercel 提供（`STATIC_ASSET_PROVIDER=vercel`）。可选 EdgeOne 上传只在 `VERCEL=1` 且 `VERCEL_ENV=production` 的构建完成后执行；本地、Preview 和 Docker 构建不会访问 EdgeOne。完整变量、未备案区域限制、验证与回滚步骤见 [Phase 5 部署参考](./reference/phase5-profile-deployment.md#edgeone-可选静态资源分发)。

## 创建第一个本地用户

仅当数据库没有任何用户时运行，用于创建唯一的初始平台管理员：

```bash
BOOTSTRAP_EMAIL=you@example.com \
BOOTSTRAP_USERNAME=your_name \
BOOTSTRAP_NAME='Your Name' \
BOOTSTRAP_PASSWORD='use-a-long-random-password' \
pnpm user:create-initial
```

脚本使用 PostgreSQL advisory lock 串行化空库检查，显式创建 `ADMIN` 并写入 SYSTEM 审计。数据库已有用户时脚本会拒绝执行；正式的后续账号必须通过管理员邀请创建，并保持默认 `USER`。

`BOOTSTRAP_EMAIL` 必须是最长 254 字符的普通邮箱地址，不能带 shell 引号或显示名。历史版本如果已经创建了唯一 bootstrap 管理员且其邮箱格式无效，可在确认数据库仍只有该一个用户后运行 `pnpm user:repair-initial-email`；命令通过 `REPAIR_ADMIN_EMAIL` 读取新地址，只允许替换无效邮箱，同时取消遗留的待处理登录 challenge 并写入 CRITICAL SYSTEM 审计。已是有效邮箱或无法证明唯一 bootstrap 管理员时会拒绝执行。

## 常规验证

```bash
pnpm validate
pnpm build
pnpm test:db
pnpm test:phase3
pnpm test:phase4
pnpm test:phase5
```

`pnpm validate` 依次运行 ESLint、Prisma generate + TypeScript 和 Vitest。

`pnpm test:db` 需要本地 PostgreSQL，验证 Phase 2 一次性消费和 outbox 并发租约。数据库结构改动后应同时运行该命令。

`pnpm test:phase3` 还需要本地 Mailpit，验证受信设备直登、风险邮件 OTP、challenge 消费、枚举保护、数据库限流与公开注册关闭。

`pnpm test:phase4` 需要本地 PostgreSQL，验证 client 审批、scope/redirect 拒绝、secret 摘要、Directory M2M token 和签名 outbox 投递。

`pnpm test:phase5` 需要本地 PostgreSQL 和 MinIO，并要求 `minio-init` 已创建 `hflive-auth` bucket；它验证真实对象写入、512×512 WebP 规范化、版本替换和资料事件。

## GitHub CI

`.github/workflows/ci.yml` 对 `main` push 和 pull request 运行三个最小权限 job：

- `validate-and-build`：锁定 Node.js 22 与 pnpm 11.7.0，执行 `pnpm validate` 和生产构建。
- `integration`：启动 disposable PostgreSQL、MinIO、Mailpit，应用 migration 后执行 Phase 2–5 专项测试，并总是删除 CI volume。
- `container-build`：验证 Compose 配置并实际构建 migrator 与 standalone app 镜像。

工作流只使用 GitHub 官方 Action，并固定到完整 commit SHA；`GITHUB_TOKEN` 默认只有 contents read 权限。CI 变量均为 runner 内 disposable 值，禁止把生产 secret 写入 workflow。

事件 worker 端点必须配置至少 32 字符的 `OUTBOX_WORKER_SECRET`；Vercel Cron 也可使用平台注入的 `CRON_SECRET`。自部署需要每分钟以 Bearer token 调用 `/api/internal/outbox/dispatch`。官方 Hobby 若要让 Neon 空闲休眠，还需配置 `OUTBOX_WAKE_URL`（Worker `/wake`）并绑定 KV。两类 secret 都不能写入日志或接收方配置。

认证/OIDC 改动还必须针对已登记的测试 client 运行：

```bash
OIDC_SMOKE_USERNAME=... \
OIDC_SMOKE_PASSWORD=... \
OIDC_SMOKE_CLIENT_ID=... \
OIDC_SMOKE_CLIENT_SECRET=... \
pnpm oidc:smoke
```

不要把这些变量写入文档、脚本或提交。smoke 会验证登录、PKCE、state、nonce、consent、授权码交换、refresh token 和关键 ID token claims。

## 数据库变更

```bash
pnpm db:generate
pnpm prisma migrate dev --name describe_the_change
pnpm db:deploy
```

- 修改 `prisma/schema.prisma` 后必须创建 migration。
- Better Auth CLI generate 可能覆盖 schema；存在 HFLive 自定义模型后必须先生成到临时位置或严格审查 diff。
- 不使用 `db push` 代替正式 migration。

## 完整 Docker 自部署验证

```bash
docker compose --profile app up -d --build
docker compose --profile app ps -a
docker compose logs --no-color migrate app
```

预期结果：

- `migrate` 以退出码 0 结束。
- `postgres`、`minio`、`mailpit` 健康。
- `minio-init` 以退出码 0 幂等创建私有 bucket。
- `app` 持续运行。
- `/api/health/ready` 返回 200 且 `database=connected`。

Compose 内 app 默认通过 `http://minio:9000` 访问对象存储。宿主机 `.env` 的 `S3_ENDPOINT=http://localhost:59000` 不会覆盖容器 endpoint；若容器需要连接外部 S3/R2，使用 `APP_S3_ENDPOINT`。

## 常见问题

### `EMFILE: too many open files, watch`

项目的 `pnpm dev` 已设置 `WATCHPACK_POLLING=true`。如果仍出现问题，先确认运行的确实是 package script，并检查是否有多个 watcher；不要在 Next.js 运行期间删除 `.next/dev`。

### `Failed to decrypt private key`

数据库中的 JWKS 私钥使用 `BETTER_AUTH_SECRET` 加密。应用必须使用生成该 key 时的同一 secret。不要通过关闭私钥加密来绕过；修正 secret 配置或在明确的密钥重建流程中处理旧 JWKS。

### readiness 为 503

依次检查 PostgreSQL 容器健康状态、`DATABASE_URL`、migration 日志和数据库网络。liveness 200 只表示进程活着，不代表数据库可用。

### Compose app 没有启动

查看 `migrate` 容器退出码和日志。app 被设计为只在 migration 成功后启动，不应跳过该依赖。
