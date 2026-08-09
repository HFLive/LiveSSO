# Phase 4 内部应用、Directory API 与事件参考

状态：已实现  
最后更新：2026-08-09

## Client 管理

- `/admin` 与 `/api/admin/*` 只允许 `ACTIVE + ADMIN` 平台账号访问；普通 OIDC 登录和应用角色不会获得该权限。
- 管理员审批并创建 confidential client。OAuth secret 使用 32 字节随机值，响应带 `no-store`，数据库只保存 SHA-256 base64url 摘要；创建或轮换响应结束后不可再次读取。
- 登录 client 使用 authorization code + PKCE，redirect URI 逐字精确匹配。授权请求在进入登录流程前验证 client 已审批、未停用、回调和 scope 均在白名单。
- Directory client 使用 `client_credentials`。停用、scope/回调修改或 secret 轮换会撤销该 client 的既有 access/refresh token；配置修改还撤销旧 consent。
- dynamic client registration 和普通登录用户的 OAuth client 管理端点继续关闭。数据库约束要求非 `APPROVED` client 必须处于 disabled 状态。

## Directory API

服务凭据从 `/api/auth/oauth2/token` 获取 access token。只接受 client 自身获批的最小 scope：

| Scope | API | 返回内容 |
| --- | --- | --- |
| `directory:user:status` | `GET /api/directory/users/{sub}/status` | `subject`、全局账号状态、更新时间 |
| `directory:user:read` | `GET /api/directory/users/{sub}` | 用户名、显示名、头像、邮箱验证和全局状态 |

接口拒绝 authorization-code 用户 token，即使对应 client 同时拥有 Directory scope；调用必须来自 `client_credentials`。opaque token 通过数据库摘要、到期、client 状态和 scope 联合校验，JWT 路径验证 EdDSA 签名、issuer、audience、期限、client 与 scope。成功、认证失败和未找到响应均显式使用 `private, no-store`。

## 可靠事件

Phase 4 当前投递：

- `user.status.changed`
- `user.profile.changed`（Phase 5 资料修改流程已接入并通过本地与生产头像链路验收）

管理员为 client 登记 HTTPS webhook（本地/自部署开发可使用 HTTP）。独立 webhook secret 使用 AES-256-GCM 加密保存，只在创建时返回。每个订阅 client 对应独立 `OutboxEvent`，避免一个接收方失败影响其他接收方。

worker 由 `GET|POST /api/internal/outbox/dispatch` 触发，使用 `OUTBOX_WORKER_SECRET` 或 Vercel `CRON_SECRET` Bearer 鉴权。Vercel Pro 可配置每分钟 Cron；Hobby 官方部署使用 `infrastructure/cloudflare-outbox-scheduler` 的 Cloudflare Cron Trigger，以独立 Worker secret 每分钟调用同一端点。自部署也应以该端点配置外部 scheduler。worker 复用 Phase 2 的租约、`FOR UPDATE SKIP LOCKED`、指数退避和 10 次后 dead letter 语义。

投递请求包含：

- `x-hflive-event-id`：全局幂等 ID；接收方应持久化去重。
- `x-hflive-timestamp`：Unix 秒。
- `x-hflive-signature`：`v1=HMAC-SHA256(webhook_secret, timestamp + "." + raw_body)`。
- 10 秒超时、不跟随重定向；仅 2xx 视为成功。

接收方应先限制时间戳偏差，再对原始请求体做常量时间签名比较，最后按 event ID 幂等处理。不得在日志中记录 OAuth secret、webhook secret 或 Bearer token。

## 审计

client 创建、配置、停用/启用、secret 轮换、用户状态修改和 Directory 资料读取写入追加式 `AuditEvent`。管理控制台只展示白名单 metadata，不返回 token、secret、cookie、OTP 或连接串。

## 自动化验收

```bash
pnpm test:phase4
```

真实 PostgreSQL 测试覆盖：secret 仅存摘要、越权 scope 拒绝、未审批 client 拒绝、错误 redirect URI 不进入登录、M2M Directory 状态查询，以及签名 outbox 的单次完成。
