# Phase 2 安全与领域数据参考

状态：已实现  
最后更新：2026-08-09

本文冻结 HFLive Auth 的管理员权限、邀请、受信设备、风险 challenge、审计、头像元数据和 outbox 数据契约。Phase 3/4 的业务流程必须复用这些状态机和原子操作，不得在 Serverless 进程内另建权威状态。

## 管理员权限

`User.platformRole` 只有 `USER | ADMIN`。新用户固定默认为 `USER`，OIDC JIT、邀请消费或接入应用角色都不得隐式提升为 `ADMIN`。唯一例外是空数据库 bootstrap 命令：它以 PostgreSQL advisory lock 串行化检查，创建首个 `ADMIN` 并写入 `platform.admin.bootstrap` SYSTEM 审计；数据库已有任何用户后永久拒绝再次 bootstrap。

角色变更必须调用数据层的 `setPlatformRole`：事务会锁定 actor 用户，只有当前 `ADMIN` 能修改角色，并为成功或拒绝结果写入 `platform.role.change` 审计事件。应用角色仍由接入应用管理，不进入该字段或 OIDC token。

## 摘要格式与密钥

邀请 token、受信设备 token、challenge binding、邮箱 OTP、IP 和 User-Agent 使用带用途隔离的 HMAC-SHA-256：

```text
h1:<64 lowercase hex characters>
```

生产环境必须设置与 `BETTER_AUTH_SECRET` 不同的 `SECURITY_HASH_SECRET`。开发环境未设置时仅为本地便利回退到 `BETTER_AUTH_SECRET`。数据库和日志只接收摘要，不接收原值。

轮换 `SECURITY_HASH_SECRET` 会主动失效尚未消费的邀请、challenge 和所有受信设备，并使 Phase 4 已加密的 webhook signing secret 无法解密；应先告知管理员，轮换后将对应活动记录转为撤销/过期、重新验证设备，并为全部 webhook 重新登记 signing secret。IP/User-Agent 的旧摘要保留用于既有审计，但不再与新摘要关联。JWKS 仍按 30 天轮换、旧公钥保留 30 天；两类密钥不得复用。

## 状态机与并发

| 模型 | 状态或有效条件 | 终态/撤销 | 并发保证 |
| --- | --- | --- | --- |
| `Invitation` | `PENDING` 且未过期 | `ACCEPTED / REVOKED / EXPIRED` | 条件更新保证只消费一次；同一规范化邮箱最多一个 pending 邀请 |
| `TrustedDevice` | 未撤销且 `expiresAt > now` | `revokedAt` 或到期 | token 摘要全局唯一；使用时只更新最近使用摘要和时间 |
| `LoginChallenge` | `PENDING`、未过期且尝试数未达上限 | `CONSUMED / LOCKED / CANCELLED / EXPIRED` | OTP 摘要条件更新只成功一次；失败计数由单条 SQL 原子递增 |
| `OutboxEvent` | `PENDING` 到达投递时间，或 `PROCESSING` 租约已过期 | `DELIVERED / DEAD_LETTER` | `FOR UPDATE SKIP LOCKED` 认领；lease ID 保护确认/失败回写；幂等键唯一 |

所有终态时间、尝试次数、租约字段和投递时间都有数据库 check constraint。outbox 单批最多认领 100 条，租约允许 1 秒至 15 分钟；每次认领增加一次尝试，达到 `maxAttempts` 后失败回写进入死信。

## 审计事件

`AuditEvent` 是追加写数据：创建后不可更新，只有超过 `expiresAt` 才允许清理。actor/subject 用户 ID 和 client ID 是不可变快照，不使用会在账号删除时改写历史的外键。

metadata 只保存经调用方白名单筛选的非敏感上下文。禁止写入密码、OTP、原始 token、authorization code、client secret、cookie、私钥和连接串。IP 与 User-Agent 只保存用途隔离摘要。

建议事件保留期：

- 登录、challenge 和设备事件：90 天。
- 邀请、账号状态、管理员权限和客户端管理事件：400 天。
- 调试级请求数据不得进入审计表。

## 生命周期与清理

| 数据 | 在线有效期 | 终态建议保留 |
| --- | --- | --- |
| 邀请 | 最长 7 天 | 接受/撤销/过期后 180 天 |
| 受信设备 | 最长 30 天 | 撤销或到期后 30 天 |
| 登录 challenge | 最长 10 分钟 | 终态后 30 天 |
| 审计事件 | 由事件类型决定 | 由 `expiresAt` 强制，90 或 400 天 |
| 已替换头像元数据 | 活动版本长期有效 | 替换/删除后 30 天再清理对象和行 |
| outbox | 租约最长 15 分钟 | delivered 30 天；dead letter 90 天并告警 |

清理任务在后续阶段实现。当前 schema 保存完成清理决策所需的终态时间；不得通过修改审计 `expiresAt` 提前删除记录。

## 数据库验证

```bash
pnpm db:deploy
pnpm test:db
```

`test:db` 使用真实 PostgreSQL，并只创建随机命名的 disposable 数据；测试结束会删除自己的用户和 outbox 记录。它验证邀请/challenge 的单次消费、失败尝试并发锁定、outbox 并发认领和租约单次确认。
