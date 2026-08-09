# Phase 5 头像与部署参考

状态：实现完成，自部署与官方核心基础设施已验收，正式 client 接入验收待完成
最后更新：2026-08-09

## 头像契约

- 已登录且状态为 `ACTIVE` 的用户通过 `/profile` 管理头像；上传端点为 `POST /api/profile/avatar`。
- 浏览器提供居中裁切、缩放和横纵位置调整；服务端不信任客户端编码结果，会重新解码并输出 512×512 WebP。
- 输入只接受 JPEG、PNG、WebP，原文件最大 8 MiB，任一边最大 8192 像素；解码失败、像素炸弹或错误格式统一拒绝。
- 对象键使用 `avatars/{sub}/{uuid}.webp`，bucket 保持私有。应用通过 `GET /api/profile/avatar/{sub}?v={version}` 流式读取，不把对象存储凭据或临时签名 URL 暴露给浏览器。
- `User.image` 与 OIDC `picture` 使用同源、版本化 URL。成功替换后旧 `ACTIVE` 资产转为 `REPLACED`，新资产转为 `ACTIVE`。
- 版本化响应使用一年 immutable cache；旧版本至少保留 30 天，以覆盖已签发 token 和接入应用缓存。后续清理任务只能删除已超过保留期的 `REPLACED/DELETED` 对象。
- 更新事务写入 `user.profile.changed` 审计，并为每个启用且订阅该事件的已批准 client 建立独立 outbox。

## 对象存储环境

| 变量 | 说明 |
| --- | --- |
| `OBJECT_STORAGE_ENABLED` | 是否启用头像；官方生产必须为 `true` |
| `S3_ENDPOINT` | S3 兼容 endpoint；R2 使用账户 endpoint，宿主机 MinIO 使用 `http://localhost:59000` |
| `S3_REGION` | R2/MinIO 默认 `auto` |
| `S3_BUCKET` | 私有 bucket 名，默认示例为 `hflive-auth` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | 最小 bucket 读写凭据 |
| `S3_FORCE_PATH_STYLE` | MinIO 使用 `true`；R2 通常使用 `false` |
| `APP_S3_ENDPOINT` | 仅 Compose app 覆盖；默认使用 `http://minio:9000`，避免宿主机 `localhost` endpoint 泄漏进容器 |

官方生产缺少对象存储时环境校验必须启动失败。自部署可以显式关闭，`/profile` 会展示能力降级且上传 API 返回 503。

## 官方部署检查

1. Vercel production 绑定固定域名 `auth.hsfz.live`，`BETTER_AUTH_URL` 与 `NEXT_PUBLIC_AUTH_URL` 均为 `https://auth.hsfz.live`。
2. `DATABASE_URL` 使用 pooled PostgreSQL URL，`DIRECT_DATABASE_URL` 使用 direct URL；Neon 连接串显式使用 `sslmode=verify-full`（保留 Neon 提供的 `channel_binding=require`），避免依赖 `pg` 即将变化的 `sslmode=require` 兼容语义；部署前单独运行 `pnpm db:deploy`。
3. R2 bucket 保持私有，S3 API token 仅授予该 bucket 的对象读写；Vercel 使用 R2 S3 endpoint，`S3_FORCE_PATH_STYLE=false`。
4. `DEPLOYMENT_MODE=official`、`MAIL_ENABLED=true`、`MAIL_TRANSPORT=http`，并配置邮件 API；同时配置独立的会话、摘要和 worker secret。
5. Vercel Pro 可直接配置每分钟 Cron。Hobby 不支持该频率，必须部署 `infrastructure/cloudflare-outbox-scheduler`，将同一 `OUTBOX_WORKER_SECRET` 作为 Cloudflare Worker secret 注入，并保持 `* * * * *` Cron Trigger。
6. 部署后验证 readiness、邀请邮件、风险 OTP、头像上传/读取、OIDC `picture`、Directory `picture` 和 `user.profile.changed` webhook。

正式验收必须记录实际 deployment URL、migration 结果、R2 对象元数据、邮件 provider 接收结果和完整 OIDC smoke；不能用本地构建替代。

Vercel 使用框架集成生成函数产物，`DEPLOYMENT_MODE=official` 或平台 `VERCEL=1` 时不启用 Next.js `output: "standalone"`。Docker/self-hosted 构建继续生成 `.next/standalone`，供 Dockerfile 的 runner stage 使用。两种产物不能在部署配置中混用。

### Vercel Hobby 的 Cloudflare 调度器

`vercel.json` 不登记 Cron，以免 Hobby 部署因每分钟计划被拒绝。Cloudflare Worker 配置位于 `infrastructure/cloudflare-outbox-scheduler/wrangler.jsonc`，生产域名固定为 `https://auth.hsfz.live`。部署 Worker 前先在 Vercel 设置至少 32 字符的 `OUTBOX_WORKER_SECRET`，再把完全相同的值通过 Cloudflare secret 管理注入 Worker；不得把值写入 Wrangler 配置、命令参数、日志或仓库。

Worker 只向 `/api/internal/outbox/dispatch` 发送带 Bearer 鉴权的 HTTPS `POST`。非 2xx 响应只记录状态码并让本次 Cron 失败，不读取响应正文，也不会输出 secret。Cron Trigger 变更可能需要数分钟传播；验收时应检查 Cloudflare invocation 成功以及应用 outbox 状态，而不能只确认 Worker 已部署。

### 2026-08-09 官方生产验收快照

- Vercel Hobby 从个人私有 fork 部署，固定域名为 `https://auth.hsfz.live`，函数区域为 `hkg1`；readiness 返回数据库 connected。
- Neon Singapore 的 6 个 migration 已应用，pooled/direct URL 显式使用 `sslmode=verify-full`；生产连接串和凭据未写入仓库。
- Resend 真实新设备 OTP 已投递并完成管理员登录；初始管理员、会话和 `/admin` 权限通过验收。
- 私有 R2 通过真实头像上传、同源读取和刷新后持久化验收。
- Cloudflare Worker 使用加密 `OUTBOX_WORKER_SECRET` 和 `* * * * *` trigger；版本 `f4053126-4dd4-4c32-a55a-d2d3cf826a3a` 的真实 scheduled invocation 为 `outcome: ok`、无异常。
- 剩余验收边界为正式 client 的 OIDC smoke、OIDC/Directory `picture`、成员邀请流程和 `user.profile.changed` webhook。

## 自部署检查

`docker compose --profile app up -d --build` 会先等待 PostgreSQL、幂等创建 MinIO bucket、执行 migration，再启动 standalone app。检查 `migrate` 与 `minio-init` 均退出 0、app 持续运行且 readiness 为 200。宿主机专项测试使用 `pnpm test:phase5`。

备份与恢复见 [操作手册](../operations/backup-restore.md)。
