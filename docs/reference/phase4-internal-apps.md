# Phase 4 内部应用、Directory API 与事件参考

状态：已实现  
最后更新：2026-09-25

## Client 管理

- `/admin` 与 `/api/admin/*` 只允许 `ACTIVE + ADMIN` 平台账号访问；普通 OIDC 登录和应用角色不会获得该权限。
- 管理员审批并创建 confidential client。OAuth secret 使用 32 字节随机值，响应带 `no-store`，数据库只保存 SHA-256 base64url 摘要；创建或轮换响应结束后不可再次读取。
- 登录 client 使用 authorization code + PKCE，redirect URI 逐字精确匹配。授权请求在进入登录流程前验证 client 已审批、未停用、回调和 scope 均在白名单。
- consent 页面从已审批且启用的 client 记录读取管理员配置的应用名称；用户看到的是 `LiveBoard Production` 这类可信名称，而不是内部 `client_id`。协议请求仍使用真实 `client_id`，但它不作为页面上的应用名称展示。
- 面向用户的权限说明按 Google/GitHub 的授权界面原则展示应用名称和具体数据用途；登录相关 scope 合并为“使用你的 HFLive 账号登录”，`offline_access` 表述为“保持登录状态”，页面不展示协议 scope 标识符。
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

官方 Hobby 部署必须避免空转打醒 Neon：写入 `OutboxEvent` 后应用向 Worker `POST /wake`（`OUTBOX_WAKE_URL`，同一 Bearer secret）设置 KV 标记；分钟 Cron 在标记缺失时直接返回，不请求 Auth、不连接 PostgreSQL。未绑定 `OUTBOX_PENDING` KV 时 Worker 保持旧行为（每次都 dispatch），以免漏投递。UTC 每 6 小时第 7 分钟仍强制巡检一次，用于唤醒失败后的兜底。成功响应可读取 `{ claimed }` 以清除标记；失败响应仍不读取正文。

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

真实 PostgreSQL 测试覆盖：secret 仅存摘要、consent 应用名称解析、越权 scope 拒绝、未审批 client 拒绝、错误 redirect URI 不进入登录、M2M Directory 状态查询，以及签名 outbox 的单次完成。

## 管理员修改登录用户名

- `/admin` → 用户管理 → 修改用户名。只允许有效平台管理员操作，可修改自己或其他成员的登录用户名。
- `PATCH /api/admin/users/{userId}` 接受 `{ "username": "new_username" }`，与 `{ "accountStatus": "ACTIVE" }` 是互斥操作；请求必须提供与请求 URL 同源的 `Origin`。额外字段被拒绝。
- 去除首尾空白后，用户名必须为 3–32 位 ASCII 字母、数字或下划线。`username` 小写存储，`displayUsername` 保留输入大小写；仅大小写变化视为无操作。
- 大小写不敏感检查其他用户及未到期 PENDING 邀请。用户名修改和邀请创建均在 Serializable 事务内读写占用状态，避免并发分配；唯一冲突和序列化冲突返回 409，后者提示重试。
- 返回 400（格式/请求错误）、401（未登录）、403（权限/来源错误）、404（用户不存在）、409（占用或并发冲突）、500（其他写入失败）。成功返回 `id`、规范化 `username` 和 `changed`。
- 修改原子写入 `user.username.changed` 管理员审计及面向有效订阅的 `user.profile.changed` outbox。事件 subject 始终是原 UUID，payload 包含 `preferred_username`；接入方继续以 Directory 的 `preferredUsername` 读取权威资料。
- 原用户名不再登录该账号，邮箱与密码不变；旧用户名可被重新分配。issuer/sub、现有会话、token TTL、JWKS、权限及外部身份映射不变。已签发 token 的用户名保持到过期，新签发 claims 读取新值。
- 无 schema 或 migration 变更。代码回滚不会回滚已修改用户名；需要时由管理员再次改回未占用的原用户名。事件生产与接入方实际消费仍须分别验收。
