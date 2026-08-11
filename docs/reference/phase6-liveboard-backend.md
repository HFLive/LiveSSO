# Phase 6 LiveBoard 后端接入设计

状态：后端实现、正式 client 与本机 dev 联调完成，正式部署联调待验收
最后更新：2026-08-11

本文是 Phase 6 的实现基线。它以 2026-08-09 的
`/Users/xiang/Desktop/liveboard` `main` 为事实来源，覆盖认证模式、OIDC
事务、身份映射、JIT、状态同步、事件接收、migration、灰度、回滚与验收。
后续实现如果改变本文的安全边界，必须先更新本文并重新评审。

## 1. 审查范围与实施前基线

本轮只读审查覆盖了 LiveBoard 的认证 controller/service、全局 guard、Cookie
签名、用户管理、共享用户类型、Prisma schema 和 migrations，以及自托管
Compose、`.run` 发布、Vercel Web/API 双项目、同源 rewrite 和环境变量。

以下是 Phase 6 实施前用于冻结兼容边界的事实；当前实现与联调状态以
`development-progress.md` 为准：

- LiveBoard 仅支持登录账号加密码，`User.username` 唯一，尚无邮箱字段。
- `User.passwordHash` 必填并使用 Argon2；管理员创建和批量导入都必须设置密码。
- 登录后签发 7 天 HMAC Cookie。载荷包含 `userId`、`sessionVersion` 和到期时间，
  不存在服务端浏览器 session 表。
- `ActiveUserGuard` 是全局守卫。每个非公开请求都会验签 Cookie、查询用户，并要求
  `User.status = active` 且 Cookie 内版本等于数据库 `sessionVersion`。
- 停用账号、修改密码或修改系统角色会递增 `sessionVersion`；旧会话立即失效。
- HTTP 和 HTTPS 分别使用 `liveboard_session_http` 与 `liveboard_session`。API 才是
  最终会话校验者，Next.js middleware 只根据 Cookie 是否存在做粗粒度跳转。
- `super_admin | admin | member`、课堂角色、标签、容量和业务权限均属于 LiveBoard，
  现有大量业务表以 `User.id` 关联；不能用 HFLive `sub` 替换本地主键。
- 自托管和 Vercel 都是正式支持目标。Vercel 使用两个 Project，Web 将 `/api/*`
  rewrite 到 API；自托管仍必须支持 HTTP、HTTPS 和 `.run` 升级。
- Redis 已是生产依赖，但开发环境允许进程内降级。OIDC 事务不得使用该内存降级。
- LiveBoard 尚未安装 OIDC client 库，也没有 HFLive webhook 接收端点或外部身份表。

## 2. 冻结结论

1. 保留 LiveBoard `User`、本地角色、业务关系、7 天 Cookie 和
   `sessionVersion`，OIDC 回调只把 HFLive 身份解析为一个本地 `User.id`。
2. 官方 issuer 只接受精确值 `https://auth.hsfz.live`。发现文档中的 issuer、授权端点、
   token 端点、JWKS 或 `iss` 不符合预期时失败关闭，不接受运行时任意 issuer。
3. 支持 `local | hybrid | hflive_oidc`。自托管默认 `local`；官方 LiveBoard 先
   `hybrid` 灰度，完成 Phase 8 后才考虑切到 `hflive_oidc`。
4. OIDC 使用 authorization code + PKCE S256 + state + nonce。回调 URI 精确匹配，
   不使用 implicit、密码 grant、通配回调或 dynamic registration。
5. `(issuer, subject)` 是唯一自动登录依据。用户名或邮箱只能检测冲突，永远不能作为
   自动关联依据。
6. JIT 只能创建 `member`。已有管理员只能通过本人显式证明或受控管理员操作关联，
   OIDC claims、Directory 数据和 webhook 都不能授予或提升 LiveBoard 角色。
7. 本地停用和 HFLive 全局停用是两个独立开关；任何一个停用都拒绝访问。全局恢复
   不得自动覆盖 LiveBoard 管理员作出的本地停用。
8. webhook 提供快速撤销，Directory API 提供最终校准。活跃外部身份每 15 分钟刷新
   状态；HFLive 暂时失败可使用最近一次成功的 ACTIVE 结果，最长 60 分钟。
9. migration 只做向前兼容的扩展，不删除本地密码、旧用户或身份映射。运行时回滚
   通过认证模式完成，不在事故处理中执行 down migration。

## 3. 认证模式

| 模式          | 普通本地登录 | HFLive OIDC | 紧急本地管理员登录       | 适用场景             |
| ------------- | ------------ | ----------- | ------------------------ | -------------------- |
| `local`       | 开启         | 关闭        | 与普通本地登录相同       | 默认自托管、代码回滚 |
| `hybrid`      | 开启         | 开启        | 与普通本地登录相同       | 官方迁移、观察和回滚 |
| `hflive_oidc` | 关闭         | 开启        | 仅显式开启的 break-glass | 官方迁移完成后       |

模式必须由服务端环境变量决定，前端只能读取服务端公开的能力结果，不能自行决定哪些
认证端点可用。

- `POST /auth/login` 在 `hflive_oidc` 下对普通账号返回统一拒绝，不执行用户名查询。
- `GET /auth/hflive/start` 只在 `hybrid` 或 `hflive_oidc` 下可用。
- break-glass 使用独立端点、独立限流和审计，只接受本地 `super_admin`，默认关闭。
  它不能依赖 HFLive、Directory 或 webhook，但仍必须经过现有密码验证、用户状态与
  `sessionVersion` 逻辑。
- 修改模式必须重新部署 API；Web 通过公开配置端点读取当前能力，避免构建时变量与
  API 实际模式分裂。

## 4. 数据模型

### 4.1 `User` 的兼容扩展

保持 `id`、`username`、`displayName`、`passwordHash`、`systemRole`、`status` 和
`sessionVersion` 的现有语义，新增：

| 字段                   | 类型                     | 说明                                |
| ---------------------- | ------------------------ | ----------------------------------- |
| `email`                | `String?`                | 已知邮箱的展示值；旧账号允许为 null |
| `emailNormalized`      | `String? @unique`        | trim 后小写，用于确定性冲突检查     |
| `localPasswordEnabled` | `Boolean @default(true)` | 旧账号为 true，OIDC JIT 为 false    |

`passwordHash` 继续保持非空。JIT 创建时写入由密码学随机值生成的有效 Argon2 哈希，
明文立即丢弃，同时设置 `localPasswordEnabled=false`。这样旧版本代码在回滚后只会
得到普通的密码不匹配，不会因为空哈希产生 500。管理员显式设置本地密码时同时把该
字段改为 true 并递增 `sessionVersion`。

`username` 的现有数据库唯一约束区分大小写。Phase 6 的所有创建、导入、修改、JIT
和关联路径必须统一使用规范化用户名做大小写不敏感检查，并在同一事务中串行化；本期
不静默改变已有账号的用户名语义。部署前预检若发现大小写折叠后的重复账号，必须先由
管理员明确处理。

### 4.2 `ExternalIdentity`

建议字段：

| 字段                       | 约束/含义                                               |
| -------------------------- | ------------------------------------------------------- |
| `id`                       | 本地 cuid 主键                                          |
| `userId`                   | 关联 `User.id`，删除用户时级联                          |
| `issuer`、`subject`        | 联合唯一；OIDC 的唯一信任锚                             |
| `preferredUsername`        | 最近一次 HFLive 用户名快照                              |
| `email`、`emailNormalized` | 最近一次邮箱快照，不用于自动关联                        |
| `emailVerified`            | 最近一次验证状态                                        |
| `displayName`、`picture`   | 最近一次资料快照                                        |
| `externalStatus`           | `ACTIVE                                                 | DISABLED         | UNKNOWN`      |
| `lastStatusConfirmedAt`    | Directory 或可信 webhook 最后确认状态的时间             |
| `statusRefreshLeaseUntil`  | 合并并发 Directory 状态刷新的短租约；不作为状态权威来源 |
| `lastStatusEventAt`        | 最后处理的状态事件 `occurredAt`，用于拒绝乱序覆盖       |
| `lastProfileSyncedAt`      | Directory 资料最后成功同步时间                          |
| `directoryUpdatedAt`       | HFLive Directory 返回的 `updatedAt`                     |
| `syncState`                | `CURRENT                                                | PROFILE_CONFLICT | ERROR`        |
| `syncErrorCode`            | 只保存稳定错误码，不保存 token 或响应正文               |
| `linkMethod`               | `JIT                                                    | LOCAL_PASSWORD   | LOCAL_SESSION | ADMIN` |
| `linkedByUserId`           | 管理员/本人显式关联时的本地 actor，可空                 |
| `createdAt`、`updatedAt`   | 审计时间                                                |

约束：

- `@@unique([issuer, subject])`
- `@@unique([userId, issuer])`，一个 LiveBoard 用户对同一 issuer 最多一个身份
- `@@index([userId, externalStatus])`
- 不对快照邮箱建立跨身份自动合并逻辑

### 4.3 `ExternalIdentityEvent`

接收方必须持久化幂等记录：

| 字段                                 | 说明                                         |
| ------------------------------------ | -------------------------------------------- |
| `eventId`                            | HFLive `x-hflive-event-id`，主键             |
| `eventType`、`subject`、`occurredAt` | 事件最小路由信息                             |
| `payloadDigest`                      | 原始 body 的 SHA-256，不保存完整敏感 payload |
| `outcome`                            | `APPLIED                                     | IGNORED | FAILED` |
| `errorCode`                          | 稳定错误码，可空                             |
| `receivedAt`、`processedAt`          | 处理时间                                     |

插入幂等记录和修改 `ExternalIdentity`/`User.sessionVersion` 必须在同一数据库事务中。
重复 event ID 返回成功但不重复递增会话版本。

### 4.4 `AuthenticationAuditEvent`

LiveBoard 当前没有安全审计表。Phase 6 必须新增最小追加式认证审计，而不能只依赖
应用日志：

| 字段                              | 说明                                                                |
| --------------------------------- | ------------------------------------------------------------------- |
| `id`、`createdAt`                 | cuid 主键与发生时间                                                 |
| `eventType`                       | OIDC login/JIT/link、break-glass、状态刷新、撤销等稳定类型          |
| `actorUserId`、`subjectUserId`    | 本地 actor/目标，可空；删除用户后保留字符串快照                     |
| `issuer`、`externalSubjectDigest` | issuer 与用途隔离 HMAC 后的 subject；不直接展示 sub                 |
| `outcome`、`errorCode`            | `SUCCESS                                                            | FAILURE` 和稳定错误码 |
| `metadata`                        | 经过字段白名单的 JSON，不保存 claims、邮箱、token、Cookie 或 secret |
| `expiresAt`                       | 默认 180 天，后续由运维任务清理                                     |

审计写入与 JIT、关联、解绑或会话撤销尽量位于同一事务。登录失败审计若数据库不可用，
允许只写结构化安全日志，但不得为了写审计而放行认证。

## 5. 字段归属

| 数据                                | 权威来源          | LiveBoard 行为                                                                                    |
| ----------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------- |
| `issuer + sub`                      | HFLive Auth       | 不可由用户或 LiveBoard 管理员改写                                                                 |
| 用户名、邮箱、显示名、头像          | 已关联时为 HFLive | 保存快照；前三项同步到兼容字段，头像由 Phase 7 读取外部 picture；冲突时保留上次安全值并标记待处理 |
| 全局账号状态                        | HFLive Auth       | 与本地状态做 AND 判断，不覆盖本地停用                                                             |
| `systemRole`                        | LiveBoard         | JIT 固定 member；HFLive 不可提升                                                                  |
| 课堂角色、标签、权限、配额、AI 限额 | LiveBoard         | 完全保持现状                                                                                      |
| bio、Banner、打开方式等应用资料     | LiveBoard         | Phase 6 不迁移                                                                                    |
| 本地密码                            | LiveBoard         | 旧账号保留；JIT 默认禁用；不上传到 HFLive                                                         |

旧的 LiveBoard 头像对象在 Phase 6 不删除，供 local 回滚继续使用；已关联账号的正常
界面将在 Phase 7 优先展示 `ExternalIdentity.picture`。同步资料遇到用户名或邮箱冲突
时，身份映射仍以 `issuer + sub` 保持稳定。服务端不得
临时生成另一个映射、改绑用户或覆盖冲突账号；只更新非冲突字段，设置
`PROFILE_CONFLICT` 并向管理端暴露不含隐私的处理状态。资料冲突本身不提升权限，
也不自动停用已经明确关联的用户。

## 6. OIDC 事务与端点

### 6.1 端点

| 端点                                | 鉴权                        | 作用                                         |
| ----------------------------------- | --------------------------- | -------------------------------------------- |
| `GET /auth/config`                  | public                      | 返回模式和可用登录能力，不返回 client secret |
| `GET /auth/hflive/start`            | public                      | 创建登录事务并跳转 authorization endpoint    |
| `GET /auth/hflive/callback`         | public                      | 消费事务、换 token、验签并创建本地会话       |
| `POST /auth/hflive/link/password`   | OIDC 冲突票据 + 本地密码    | 显式证明旧 member 账号并关联                 |
| `POST /auth/hflive/link/start`      | 本地 session + 近期密码确认 | 本人从本地账号发起关联                       |
| `POST /admin/users/:id/hflive-link` | 管理员                      | 受控人工关联；高权限账号需 super_admin       |
| `POST /internal/hflive/events`      | webhook HMAC                | 状态/资料事件，豁免 Cookie guard             |

前端正式交互属于 Phase 7；Phase 6 必须先提供可自动化测试的后端契约。

### 6.2 临时事务

OIDC `state`、PKCE verifier、nonce、意图、允许的站内 `returnTo`、已有本地
`userId` 和创建时间保存在 Redis，TTL 10 分钟：

- Redis key 使用 state 的用途隔离 HMAC 摘要，不把原始 state 放入日志。
- callback 使用原子 `GETDEL`，同一 state 只能消费一次。
- 只允许相对站内 `returnTo`，拒绝 scheme、host、`//` 和反斜杠变体。
- OIDC 事务禁止进程内 fallback。Redis 不可用时返回 503，不开始授权。
- callback 失败不签发 LiveBoard Cookie，不记录 authorization code、token、verifier
  或完整 claims。

### 6.3 协议验证

使用维护良好的 OIDC client 库完成 discovery、token exchange、JWKS 缓存和声明验证，
不能手写 JWT 验签。至少验证：

- discovery issuer 与固定 issuer 逐字一致；
- authorization response 的 state 一致且只消费一次；
- token endpoint 使用保存的 PKCE verifier；
- ID token 的签名、`iss`、`aud`/`azp`、`exp`、`iat` 和 nonce；
- `sub` 非空且稳定；请求 scope 固定为 `openid profile email`；
- `email_verified=true` 才允许把邮箱写入权威兼容字段；
- callback URI 使用 `HFLIVE_OIDC_REDIRECT_URI` 的精确值。

声明验证成功后，callback 还必须用 Directory client credentials 查询该 `sub` 的状态；
只有明确返回 ACTIVE 才能建立首次映射或签发新会话。新登录没有可使用的旧 ACTIVE
确认，因此 HFLive/Directory 故障时失败关闭；60 分钟宽限只适用于已经成功确认过的
活跃 LiveBoard 会话。

正式 Vercel 回调使用 Web 的同源地址，例如
`https://<liveboard-domain>/api/auth/hflive/callback`，由 Web rewrite 到 API。不要把某次
随机 Deployment URL 注册为生产回调。自托管反向代理也应提供同源 `/api`；若确需
跨站 API 域名，必须单独评审 SameSite、CORS 和 Cookie 域边界。

## 7. 映射、JIT 与冲突规则

callback 完成协议验证后，在可重试的串行化事务中按以下顺序处理：

1. 按 `(issuer, subject)` 查映射。存在则只使用其 `userId`，不再按资料字段匹配。
2. 映射存在但 `externalStatus=DISABLED`，拒绝登录并清理现有 Cookie。
3. 无映射且事务是本人显式关联，验证目标用户、近期密码证明和一对一约束后关联。
4. 无映射且提交冲突票据，只有输入的旧账号密码验证成功才继续；普通管理员角色不能
   通过该自助路径关联。
5. 无映射且是 JIT 登录，先对规范化用户名和已知邮箱做冲突检查。
6. 没有冲突时创建 `member`、随机不可知密码哈希、`localPasswordEnabled=false` 和
   `ExternalIdentity`。
7. 有冲突时不创建第二个用户、不自动合并，签发 10 分钟、单次、只存摘要的冲突票据；
   外部响应使用统一文案，不能列出命中的用户名或邮箱。

并发要求：同一 `issuer + sub` 的两个 callback 最终只能产生一个映射和一个用户；
同一规范化用户名/邮箱的并发 JIT 只能有一个成功。唯一约束冲突必须重新读取映射并
做确定性判断，不能简单返回 500。

管理员人工关联规则：

- `admin` 只能关联 `member`；`super_admin` 才能关联 admin/super_admin。
- 已映射到其他用户的 subject 或目标用户已有同 issuer 映射时拒绝。
- 操作需要显示 subject、目标用户和冲突摘要的二次确认，并写 LiveBoard 审计。
- 解绑不属于 Phase 6 的普通自助能力。紧急解绑只能由 super_admin 执行，必须先使
  目标会话失效，且不能删除历史事件记录。

## 8. 本地会话和状态收敛

OIDC 成功后调用现有 Cookie 生成逻辑，签发当前 `User.sessionVersion` 的 7 天会话。
不要把 HFLive access/refresh token 放入浏览器 Cookie、LiveBoard 数据库或日志；
LiveBoard 浏览器会话生命周期继续独立于 HFLive token 生命周期。

`ActiveUserGuard` 在现有检查后增加外部身份检查：

1. 没有 `ExternalIdentity`：按现有本地规则放行。
2. `externalStatus=DISABLED`：清 Cookie并返回 401。
3. 最近成功状态确认不足 15 分钟且为 ACTIVE：放行。
4. 超过 15 分钟：使用 Directory client credentials 查询
   `GET /api/directory/users/{sub}/status`。
5. 返回 ACTIVE：更新确认时间并放行；返回 DISABLED：事务更新状态、只递增一次
   `sessionVersion`，清 Cookie并拒绝。
6. 超时、5xx 或网络失败：最近成功 ACTIVE 不超过 60 分钟则宽限放行；超过 60 分钟
   返回 503 且不伪装成密码错误。用户可稍后重试，break-glass 管理员不受此依赖。
7. Directory 明确返回 401/403 表示服务凭据失效：立即进入运维告警；在 60 分钟窗口
   内仍按最近状态宽限，窗口后失败关闭。
8. Directory 返回 404：视为外部身份不可用，撤销本地会话，不自动删除用户或映射。

刷新只在 15 分钟边界发生。并发请求使用短租约或条件更新合并同一 identity 的刷新，
避免请求风暴；进程内缓存只能优化，不能成为正确性来源。

## 9. webhook 接收

接收端点不走 Cookie guard，但必须在解析 JSON 前保留原始 body。Nest/Express 启动
配置需显式提供 raw body；不能对重新序列化后的对象验签。

处理顺序固定为：

1. 限制 body 大小和 `Content-Type`。
2. 校验 `x-hflive-timestamp` 为 Unix 秒且与服务器时间偏差不超过 5 分钟。
3. 对 `timestamp + "." + rawBody` 使用 webhook secret 计算 HMAC-SHA256，并常量时间
   比较 `x-hflive-signature` 的 `v1=` 值。
4. 校验 header event ID 与 body `id` 一致，body `clientId` 等于配置的 client ID，
   `type` 在白名单中。
5. 在数据库事务中插入 `ExternalIdentityEvent`；重复主键直接返回 204。
6. `user.status.changed`：先比较 `occurredAt`；不晚于 `lastStatusEventAt` 的乱序事件记为
   `IGNORED`。新的 DISABLED 立即更新外部状态，并仅在状态实际改变时递增
   `User.sessionVersion`。ACTIVE 事件只触发一次 Directory status 校准，只有 Directory
   当前明确返回 ACTIVE 才恢复外部状态；无论如何都不修改本地 `User.status`。
7. `user.profile.changed`：标记资料需要刷新，并异步/短时调用 Directory read；事件
   payload 只作为提示，最终资料以 Directory API 为准。
8. 未知 subject 记录为 `IGNORED` 并返回 204，避免无意义重试；签名或格式错误返回
   4xx，临时数据库错误返回 5xx 让 HFLive outbox 重试。

Secret 轮换采用当前值加一个短期 previous 值的双读窗口。接收端不得记录 secret、
Authorization header、原始签名、完整邮箱或完整 body。

## 10. Directory client

OIDC 登录 client 与 Directory/webhook 可以属于同一个 HFLive client，但凭据按用途
分开看待：

- authorization code 使用 `HFLIVE_OIDC_CLIENT_ID/SECRET`；
- client credentials 使用获批 `directory:user:status` 和 `directory:user:read` 的
  client；若平台创建的是同一 client，可配置相同 ID/secret，但不得在代码中假定；
- 每次需要刷新时获取短期 M2M token，不把 token 持久化。少量用户下优先减少 secret
  缓存复杂度；以后只有在观测到实际压力后才增加受控缓存。
- token 与 Directory 响应使用短超时、禁止重定向、`private/no-store` 语义；失败日志
  只记录稳定错误类别和 HFLive request ID（如果有）。

## 11. 环境变量与部署

新增服务端变量：

```text
AUTH_MODE=local
HFLIVE_OIDC_ISSUER=https://auth.hsfz.live
HFLIVE_OIDC_CLIENT_ID=
HFLIVE_OIDC_CLIENT_SECRET=
HFLIVE_OIDC_REDIRECT_URI=
HFLIVE_DIRECTORY_CLIENT_ID=
HFLIVE_DIRECTORY_CLIENT_SECRET=
HFLIVE_WEBHOOK_SECRET=
HFLIVE_WEBHOOK_PREVIOUS_SECRET=
HFLIVE_BREAKGLASS_ENABLED=false
```

规则：

- `local` 不要求任何 HFLive secret，确保现有自托管升级不被阻断。
- `hybrid/hflive_oidc` 启动时必须验证 issuer、client、redirect 和 Directory 配置；缺失
  时 readiness 失败，不能静默回退为 local。
- secret 只存在 API Project/自托管 API 环境，不进入 Web、`NEXT_PUBLIC_*`、镜像
  build args、文档示例值或诊断输出。
- Vercel Preview 必须使用独立 client、redirect、数据库和 Redis，或者明确关闭 OIDC；
  不允许 Preview 回退 Production client/API。
- 自托管 `.env` 升级器只补 `AUTH_MODE=local` 默认值，不能覆盖管理员已有配置。
- 正式回调和 webhook 都使用稳定 LiveBoard 域名的 `/api` 路径。HFLive 管理端登记
  精确回调和 HTTPS webhook，不登记随机 Deployment URL。

## 12. migration 与发布顺序

### 12.1 部署前预检

1. 备份 LiveBoard PostgreSQL，记录恢复点。
2. 检查 `lower(trim(username))` 是否存在重复；发现重复立即停止，由管理员先改名。
3. 确认至少一位 `active + super_admin` 有已知可用本地密码。
4. 记录 `SESSION_SECRET`，回滚期间必须保留，否则所有会话会无条件失效。
5. 在 HFLive Auth 创建已审批 client，登记精确 redirect、scope 和 webhook；secret 只保存
   到密码管理器和部署环境。

### 12.2 schema migration（扩展阶段）

单个向前 migration 按以下顺序执行：

1. 给 `User` 增加可空邮箱、可空规范化邮箱和
   `localPasswordEnabled NOT NULL DEFAULT true`。
2. 创建外部状态、同步状态、关联方式和事件结果 enums。
3. 创建 `ExternalIdentity`，先建立普通索引和外键，再建立两个联合唯一约束。
4. 创建 `ExternalIdentityEvent`。
5. 创建 `AuthenticationAuditEvent` 及时间、事件类型和目标用户索引。
6. 不回填 ExternalIdentity，不修改现有密码、角色、状态、用户名或 sessionVersion。

migration 必须分别在空数据库和当前生产备份的副本上运行 `prisma migrate deploy`。
禁止用 `db push` 代替。

### 12.3 代码与配置发布

1. 部署兼容新旧 schema 的 Phase 6 代码，保持 `AUTH_MODE=local`。
2. 验收现有本地登录、停用、改密码、HTTP/HTTPS Cookie、自托管和 Vercel。
3. 配置 HFLive secret 和稳定 URL，readiness 仍保持 local；用后台 smoke 验证 discovery、
   client credentials、Directory 和签名事件。
4. 官方实例切换到 `hybrid`，只对内部管理员/测试 member 完成 OIDC、JIT、冲突、关联
   和撤销验收。
5. Phase 8 逐一邀请并显式关联旧用户，观察至少一个完整会话/事件周期。
6. 只有迁移清单全部闭环后才可切换 `hflive_oidc`；break-glass 账号和演练记录必须
   先验收。

## 13. 回滚边界

### 13.1 可立即执行的运行时回滚

- `hflive_oidc -> hybrid`：恢复所有旧本地账号登录，是首选回滚。
- `hybrid -> local`：完全停止新的 OIDC 入口；已签发的 LiveBoard Cookie仍按本地规则
  工作。
- 停用 HFLive webhook 或轮换错误 secret 不得阻断 local 模式。
- 保留 `ExternalIdentity`、事件幂等记录、随机 JIT 密码哈希和所有业务关系。

### 13.2 代码回滚

本期 schema 只新增表/列，且 JIT 的 `passwordHash` 仍为有效非空 Argon2 哈希，因此旧
代码可以在 local 模式读取同一数据库。旧代码会把 JIT 账号视为密码不匹配，不会因
空值崩溃。代码回滚前必须先把 `AUTH_MODE` 改为 local，并保持原 `SESSION_SECRET`。

### 13.3 不允许的事故操作

- 不在故障处理中删除 ExternalIdentity、JIT User 或业务外键。
- 不把 HFLive `sub` 回填为 LiveBoard `User.id`。
- 不批量覆盖用户名/邮箱来“解决”冲突。
- 不执行 down migration；schema 收缩只能在独立版本、完成数据保留评审后进行。
- 不因 HFLive 恢复 ACTIVE 而自动启用本地 disabled 用户。

## 14. 验收矩阵

| 类别     | 场景                                                    | 预期证据                                                                |
| -------- | ------------------------------------------------------- | ----------------------------------------------------------------------- |
| 兼容     | migration 应用于空库和生产副本                          | `migrate deploy` 成功，旧用户/角色/关系计数不变                         |
| local    | local 模式旧账号登录                                    | 原 Cookie、7 天 TTL、guard 和退出行为不变                               |
| local    | 停用、改密码、改角色                                    | 旧 Cookie 因 sessionVersion 立即失效                                    |
| 模式     | local 调 HFLive start                                   | 明确拒绝且不创建事务                                                    |
| 模式     | hflive_oidc 调普通本地登录                              | 统一拒绝，不查询用户；break-glass 单独可审计                            |
| OIDC     | 正常 code + PKCE                                        | state/nonce/iss/aud 和 Directory ACTIVE 全通过，只签发 LiveBoard Cookie |
| OIDC     | state 重放、nonce 错误、过期 code、错误 issuer/audience | 全部失败且无用户、映射或 Cookie                                         |
| OIDC     | redirect/returnTo 注入                                  | 精确回调；外部 URL、`//`、反斜杠变体被拒绝                              |
| JIT      | 新 HFLive 用户                                          | 创建 member；本地密码未启用；角色不可由 claim 提升                      |
| 并发     | 同一 sub 两个 callback                                  | 仅一个 User/ExternalIdentity，另一请求确定性收敛                        |
| 冲突     | 用户名冲突                                              | 不自动合并、不创建重复用户、不泄露命中账号                              |
| 冲突     | 邮箱冲突                                                | 同上；只有显式证明/管理员关联可继续                                     |
| 关联     | member 正确旧密码                                       | 单次票据成功关联，重放失败                                              |
| 关联     | 错密码或高权限账号自助关联                              | 统一失败；管理员/最高管理员边界正确                                     |
| 角色     | JIT、资料同步、ACTIVE webhook                           | 均不能修改 systemRole、课堂角色或权限                                   |
| 状态     | DISABLED webhook                                        | 签名通过后幂等更新，只递增一次 sessionVersion，旧会话失效               |
| 状态     | 重复 event ID                                           | 返回 204，状态和 sessionVersion 不重复变化                              |
| 状态     | DISABLED 后收到更旧的 ACTIVE                            | 旧事件记为 IGNORED，不能恢复外部状态                                    |
| 状态     | ACTIVE webhook + 本地 disabled                          | 本地仍 disabled，不能登录                                               |
| 状态     | 15 分钟 Directory 刷新                                  | ACTIVE 延长确认；DISABLED 立即撤销                                      |
| 故障     | HFLive 不可用少于 60 分钟                               | 最近 ACTIVE 会话在记录宽限状态后继续                                    |
| 故障     | HFLive 不可用超过 60 分钟                               | 外部身份请求 503 失败关闭；local/break-glass 不受影响                   |
| webhook  | 时间戳超窗、错误签名、body 被改、clientId 不符          | 4xx，无数据库副作用                                                     |
| webhook  | 临时数据库失败                                          | 5xx，HFLive outbox 后续重试可成功                                       |
| 资料     | picture/name/username 变化                              | Directory 为最终来源；无冲突同步，有冲突标记不改绑                      |
| Vercel   | Web 同源 `/api` 回调                                    | Production 稳定域名成功写 Cookie，Preview 不读生产配置                  |
| 自托管   | HTTP 与 HTTPS                                           | 两种 Cookie 名和降级兼容规则保持现状                                    |
| 回滚     | hybrid/hflive_oidc 切回 local + 旧代码                  | 旧用户可登录，JIT 账号安全拒绝密码，无 500/数据删除                     |
| 安全日志 | 全路径失败与成功                                        | 不出现 code、token、secret、Cookie、密码、完整 claims                   |
| 审计     | JIT/link/break-glass/撤销                               | 追加式记录存在，subject 为摘要，metadata 通过白名单                     |

最低自动化组合：

- `pnpm validate` 与 API/Web production build；
- Prisma 空库和生产副本 migration；
- Auth/guard/mode/link/webhook 单元测试；
- 真实 PostgreSQL + Redis 的并发 JIT、事件幂等和 15/60 分钟状态集成测试；
- HFLive 正式测试 client 的 authorization code + PKCE、Directory 与签名 webhook smoke；
- Docker Compose migrator、readiness 和 HTTP/HTTPS Cookie 回归；
- Vercel Preview 隔离及 Production 同源回调验证。

### 14.1 2026-08-11 实现证据与剩余边界

`/Users/xiang/Desktop/liveboard` 已实现 schema/migration、三种认证模式、固定 issuer 的
`openid-client` code + PKCE、Redis 单次 state/冲突票据、JIT member、密码/本地
session/管理员显式关联、追加式认证审计、15/60 分钟状态收敛、短刷新租约、原始 body
HMAC webhook、幂等/乱序处理、资料同步冲突和 break-glass。自托管升级器只补
`AUTH_MODE=local`，Vercel/自托管配置和运行时回滚文档已同步。

已完成的验证：

- 隔离 PostgreSQL 16 的空库 9 个 migration 全量部署，以及 baseline + 旧用户到 Phase 6
  的原地升级；旧用户密码开关和 sessionVersion 不变。
- 真实 PostgreSQL 的双并发 JIT 与双并发同 event ID webhook；分别收敛为一个映射和
  一次 sessionVersion 递增。首次测试发现 `P2034` 写冲突后，加入最多 3 次的
  Serializable 有界重试并复测通过。
- LiveBoard typecheck、API/Web/shared 全量测试、发布脚本测试与 production build；
  Phase 6 单元测试覆盖 local 回滚、模式配置、returnTo 注入、Redis fail-closed、
  `GETDEL` 单次消费、签名修改、外部禁用和 15/60 分钟故障窗口。
- 对正式 discovery/readiness 的只读探测，以及编译后 CommonJS API 产物动态加载
  `openid-client`、生成 state/nonce/PKCE S256 授权请求。

尚未完成且不得伪装为通过的外部验收：本机没有 `redis-server` 且 Docker Desktop 未
运行，真实 Redis、Compose/HTTP/HTTPS Cookie 未复验；仓库也没有正式 HFLive client
secret，因此完整 code callback、Directory/webhook、Vercel Preview 隔离和 Production
同源回调必须在配置 client 与部署后继续执行。Phase 7 前可用后端 smoke 闭环这些项目。

## 15. Phase 6 与后续阶段边界

Phase 6 实现后端模式、协议、映射、JIT、显式关联 API、状态同步、事件和自动化测试。
Phase 7 才调整登录页、冲突/关联界面、统一资料只读提示和 HFLive 资料入口。Phase 8
负责约 10 个旧用户的邀请、逐一关联、迁移清单和 hybrid 观察。Phase 9 负责全面安全
测试、生产演练、密钥轮换和事故手册。

在 Phase 7 前可以通过后端 smoke 验收 Phase 6，但不能把“后端可用”表述为最终用户
迁移完成或官方 LiveBoard 已切换统一登录。
