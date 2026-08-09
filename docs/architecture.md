# 架构与关键边界

状态：Phase 5 自部署基线  
最后更新：2026-08-09

## 系统目标

HFLive Auth 是 HFLive 组织内项目的统一身份平台。它提供统一账号、显示名、头像和全局账号状态，但不接管各应用内部的业务角色与权限。

官方实例使用稳定 issuer `https://auth.hsfz.live`。平台不开放公共注册，也不允许第三方动态登记 OAuth client。非官方 LiveBoard 和成员自部署实例仍可选择本地认证。

## 组件关系

```text
用户浏览器
   │
   ├── HFLive Auth / Next.js
   │      ├── Better Auth 密码与会话
   │      ├── OAuth Provider / OIDC
   │      ├── HFLive 邀请、邮件、风险与恢复业务层
   │      └── Prisma
   │             └── PostgreSQL
   │
   ├── 对象存储：R2（官方）或 S3/MinIO（自部署）
   └── 事务邮件：HTTP API Provider（官方）或 Mailpit（开发）

接入应用（首个为 LiveBoard）
   ├── 通过 OIDC 登录并以 issuer + sub 识别全局身份
   ├── 保存自己的本地会话
   └── 保存自己的角色、权限和业务数据
```

## 认证协议

- OAuth 2.1 / OpenID Connect authorization code flow + PKCE。
- scopes：`openid profile email offline_access`。
- 稳定 claims：`sub`、`email`、`email_verified`、`preferred_username`、`name`、`picture`。
- issuer 是站点根域，不包含 Better Auth 的 `/api/auth` base path。
- authorization code 有效期 5 分钟；access/id token 15 分钟；refresh token 30 天。
- 使用 EdDSA JWKS；当前轮换周期和旧 key 宽限均为 30 天。
- client secret、opaque access token 和 refresh token 使用摘要存储。

OIDC token 不携带 LiveBoard 管理员或业务角色。接入应用必须依据本地授权数据做最终权限判断。

## 身份与资料归属

| 数据 | 权威来源 |
| --- | --- |
| `sub`、用户名、邮箱、邮箱验证状态 | HFLive Auth |
| 显示名、头像、全局账号状态 | HFLive Auth |
| LiveBoard member/admin/super_admin | LiveBoard |
| 课堂、内容、通知和其他业务数据 | 对应接入应用 |

LiveBoard 未来以 `(issuer, subject)` 建立 `ExternalIdentity`。用户名或邮箱冲突不得自动合并；需要旧账号密码证明或管理员人工关联。JIT 只能创建普通成员，不能提升管理员权限。

## 数据与运行状态

PostgreSQL 是唯一受支持的关系数据库。认证系统需要跨 Serverless 实例共享会话、限流、OAuth code/token、challenge、设备、审计和 outbox 状态，因此不得使用进程内存充当权威状态，也不支持 SQLite。

当前 Prisma schema 包含 Better Auth 基础表：

- `User`、`Session`、`Account`、`Verification`
- `Jwks`
- `OauthClient`、`OauthRefreshToken`、`OauthAccessToken`、`OauthConsent`
- `RateLimit`

HFLive 领域表已包含邀请、受信设备、风险 challenge、审计、资料资产、outbox、账号状态、管理员权限、client 审批状态和 webhook 订阅。状态机、保留期与并发契约见 [Phase 2 安全与领域数据参考](./reference/security-domain-data.md)，认证流程见 [Phase 3 认证流程参考](./reference/phase3-auth-flows.md)，内部应用协议见 [Phase 4 参考](./reference/phase4-internal-apps.md)。

## 部署模式

### 官方

- Vercel 运行 Next.js Web/API。
- 托管 PostgreSQL：runtime 使用 pooled URL，migration 使用 direct URL。
- R2 保存头像等对象。
- HTTP API 邮件供应商发送认证事务邮件。
- `DEPLOYMENT_MODE=official`；邮件能力不得静默降级。

### 自部署

- standalone Next.js 容器。
- PostgreSQL + MinIO/S3。
- Compose `migrate` 一次性服务成功后才启动 app。
- `DEPLOYMENT_MODE=self_hosted` 可以显式关闭尚未配置的邮件/对象存储功能。

## 安全边界

- 公开注册和 dynamic client registration 始终关闭。
- redirect URI 精确匹配；client 和 scope 由管理员审批。
- OAuth access token audience 固定为单一 issuer `BETTER_AUTH_URL`；资源服务必须精确验证自身 audience，不把 RFC 8707 `resource` 当作额外授权边界。
- 登录响应避免用户枚举，登录路径使用数据库限流。
- 密码、OTP、token、code、secret 和私钥不得进入日志或文档。
- 新设备/风险登录使用邮箱 OTP；受信设备最长 30 天；TOTP 默认关闭。
- 全局封禁采用事件通知 + 接入方周期刷新，不追求数秒内强一致。
- HFLive Auth 故障不能让接入应用自动提升权限；LiveBoard 保留受控回滚和本地紧急入口。

## 当前未完成能力

头像上传、对象存储、版本化资料 URL、资料事件与 Docker/MinIO 路径已经实现并验收。官方 Vercel + 托管 PostgreSQL + R2 + 邮件 API 尚未在真实生产资源上验收，LiveBoard 接入也未开始，当前版本不可直接投入生产。
