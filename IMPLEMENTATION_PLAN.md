# HFLive Auth 实施方案

状态：Phase 0–5 已完成；Phase 6 LiveBoard 后端接入进行中
官方域名：`https://auth.hsfz.live`  
首个接入方：HFLive 官方 LiveBoard

## 1. 项目目标

建设一个由 HFLive 自己运营、可开源和自部署的统一认证平台。它只服务于 HFLive 组织内的项目以及经管理员明确批准的成员项目，不开放第三方自助接入。

第一版以用户名或邮箱加密码为主要登录方式；在新设备或命中风险规则时追加邮箱验证码。TOTP 保留扩展能力但默认关闭。HFLive Auth 统一管理用户身份、显示名和头像，各接入应用继续管理自己的业务角色与权限。

## 2. 已确认的产品边界

- 官方实例固定使用 `auth.hsfz.live`，OIDC issuer 上线后保持稳定。
- 不开放公开注册，只允许管理员邀请或创建账号。
- 不提供动态客户端注册；OIDC 客户端必须由管理员审批和配置。
- 官方 LiveBoard 接入 HFLive Auth；非官方部署可以继续使用原有本地登录。
- LiveBoard 采用可配置认证模式：`local`、`hybrid`、`hflive_oidc`。
- 原有约 10 个 LiveBoard 用户不迁移密码，通过邀请重设密码，并显式关联旧账号。
- 用户名冲突绝不依据名称自动合并；需要旧密码证明或管理员人工处理。
- HFLive Auth 统一显示名和头像；邮箱、用户名和全局账号状态也属于身份平台。
- LiveBoard 的成员、管理员等应用角色仍由 LiveBoard 自己保存和授权。
- 全局封禁允许短时间传播延迟，不追求几秒内强制踢出。
- v1 不包含 SAML、SCIM、社交登录、Passkey 和 SQLite。

## 3. 技术路线

### 3.1 核心栈

- Next.js App Router + TypeScript
- Better Auth 作为会话、密码认证和认证插件基础
- Better Auth OAuth Provider 插件提供 OAuth 2.1 / OpenID Connect
- Prisma + PostgreSQL；不支持 SQLite
- Vercel 部署官方 Web/API
- 托管 PostgreSQL 保存关系数据和服务端限流状态
- R2 保存头像等对象；自部署可切换到 S3/MinIO
- 邮件使用 HTTP API 型供应商；本地开发使用 Mailpit
- Docker Compose 提供 PostgreSQL、MinIO 和 Mailpit 的开发/自部署依赖

### 3.2 为什么不支持 SQLite

该项目需要并发会话、OAuth 授权码和 refresh token、审计记录、设备状态、数据库限流以及 Vercel 多实例访问。PostgreSQL 能让官方部署和自部署共用同一套并发与迁移语义。放弃 SQLite 的代价只是成员试玩时需要多启动一个数据库容器，不影响主要目标。

### 3.3 Better Auth 的使用边界

Better Auth 负责成熟的认证基础设施，但邀请制、风险判断、受信设备、组织内应用审批、全局目录 API、头像存储和 LiveBoard 身份关联属于 HFLive 的业务层，不能只靠开启插件完成。

## 4. 稳定协议

### 4.1 OIDC

- issuer：`https://auth.hsfz.live`
- scopes：`openid profile email`
- 标准 claims：`sub`、`email`、`email_verified`、`preferred_username`、`name`、`picture`
- 授权码模式 + PKCE
- 不把 LiveBoard 角色放进全局 token
- Web 客户端使用机密客户端；redirect URI 必须完全匹配白名单
- access token 短时有效，refresh token 支持轮换与撤销
- signing key/JWKS 支持轮换，并保留旧公钥覆盖已签发 token 的验证窗口

### 4.2 内部目录与事件

OIDC 解决登录，另外提供受服务凭据保护的内部能力：

- 用户状态查询：处理封禁、注销和资料刷新
- 用户资料读取：同步显示名和头像
- 账号状态/资料变更事件：接入方可尽快撤销本地会话或刷新缓存

这些接口只对登记过的 HFLive 应用开放，并采用最小权限 scope。

## 5. 登录与风险流程

### 5.1 普通登录

1. 用户在单输入框中输入用户名或邮箱。
2. 服务端规范化输入并定位账号，返回统一错误，避免枚举账号。
3. 校验密码、账号状态和速率限制。
4. 已受信设备直接建立 HFLive Auth 会话。
5. 新设备或命中风险规则时发送邮箱验证码。
6. 验证成功后建立会话，并可将设备信任 30 天。

### 5.2 初版风险规则

- 新设备或设备 cookie 丢失
- 短时间多次密码失败后又成功
- 登录频率异常
- IP/区域发生明显变化时提高风险分数

首版采用可解释规则，不引入不透明模型。设备指纹只使用有限、可轮换的数据，不做跨站追踪。IP 与 User-Agent 等审计数据设置保留期限。

### 5.3 邮件能力

邮件系统是认证平台自己的事务邮件能力，不是 LiveBoard 邮箱服务。会发送：

- 邀请与首次设置密码
- 风险登录验证码
- 找回密码
- 邮箱验证或变更确认
- 高风险安全提醒

官方生产环境缺少邮件配置时启动失败；自部署可以显式关闭邮件能力，此时邮箱验证码、邮箱验证和找回密码同时关闭，并在管理界面提示能力降级。

## 6. 数据模型

在 Better Auth 标准表之外增加：

- `Invitation`：邀请对象、状态、过期时间、邀请人
- `TrustedDevice`：用户、设备令牌摘要、到期与最近使用信息
- `LoginChallenge`：风险原因、验证码摘要、尝试次数、到期与消费状态
- `AuditEvent`：登录、失败、邀请、资料修改、封禁、客户端变更等安全审计
- `OidcClientMetadata`：客户端归属、审批状态、允许的回调地址与 scope
- `ProfileAsset`：头像对象键、版本、内容类型和生命周期状态
- `OutboxEvent`：可靠投递资料与账号状态变更事件
- 数据库限流记录：适配 Vercel 多实例，不依赖进程内存

敏感 token、验证码和设备令牌只保存摘要；OAuth client secret 只在创建/轮换时明文展示一次。

## 7. LiveBoard 接入设计

### 7.1 认证模式

- `local`：完全沿用现有用户名/邮箱和密码登录。
- `hybrid`：同时展示 HFLive 登录和本地登录，适合迁移与回滚。
- `hflive_oidc`：默认走 HFLive Auth；保留受控的紧急本地管理员入口。

### 7.2 本地身份映射

LiveBoard 增加 `ExternalIdentity`，核心唯一键是 `(issuer, subject)`，映射到本地用户。OIDC 登录成功后：

1. 已有映射则进入对应用户。
2. 没有映射且不存在冲突时，按策略即时创建普通成员并建立映射。
3. 若用户名或邮箱与旧账号冲突，不自动合并。
4. 用户可以输入旧 LiveBoard 密码证明所有权，或由管理员人工关联。

LiveBoard 管理员和超级管理员权限不能由 JIT 自动授予。

### 7.3 会话与封禁传播

OIDC 回调完成后仍创建 LiveBoard 自己的 7 天本地会话，以复用现有 guard、cookie 和授权逻辑。LiveBoard 通过以下组合收敛全局状态：

- 接收账号禁用事件后尽快撤销本地会话；
- 活跃会话约每 15 分钟向 HFLive Auth 刷新账号状态；
- HFLive Auth 暂时不可用时允许最长约 60 分钟宽限，超过后要求重新验证；
- 本地应用管理员仍可立即禁用该用户在 LiveBoard 的访问。

## 8. UI/UX 方向

首版只建立设计基础和核心流程，不进行重度视觉打磨：

- 深色优先，低饱和中性色与克制的高亮色
- 参考 Cloudflare 的信息密度、Apple 的空间与动效克制、Claude 的温和排版
- 用网格、终端状态、细边框和轻微辉光表达科技/黑客气质
- 不牺牲对比度、键盘操作、错误可读性和移动端体验
- 登录页、验证页、同意页和管理页共用 token，但不需要复制 LiveBoard 视觉

后续视觉升级不能改变认证协议、表单可访问性或安全反馈语义。

## 9. 分阶段实施与验收

### Phase 0：冻结基础契约

- 固化 issuer、claims、scopes、客户端审批边界和认证模式。
- 建立环境变量分类、秘密管理与本地开发约定。
- 验收：本文档与示例配置覆盖官方部署和自部署差异。

### Phase 1：可运行骨架与技术验证

- 创建 Next.js、TypeScript、Prisma/PostgreSQL、Better Auth 工程。
- 接入 OAuth Provider、OIDC discovery、授权端点和 JWKS 的最小路径。
- 创建基础登录/授权同意页面和深色设计 token。
- 增加健康检查、结构化日志边界和环境变量校验。
- 验收：本地可启动；数据库可迁移；测试客户端可完成一次 OIDC code + PKCE 流程。

### Phase 2：安全与领域数据

- 增加邀请、受信设备、风险挑战、审计、头像元数据、outbox 和数据库限流模型。
- 完成加密/摘要策略、数据保留规则、密钥/JWKS 轮换约定。
- 验收：迁移可重复执行；并发消费 challenge/token 不会重复成功；关键操作有审计。

### Phase 3：邀请制账号与邮件

- 实现邀请、首次设置密码、单输入框登录、邮箱 OTP、找回密码和安全提醒。
- 实现风险规则和 30 天受信设备。
- 提供定制登录、验证、恢复和错误页。
- 验收：公开注册不可用；正常与风险登录路径均有自动化测试；账号枚举和暴力尝试被限制。

### Phase 4：内部应用管理

- 管理员创建/停用客户端、维护 redirect URI、轮换 secret、查看审计。
- 完成用户状态 Directory API 与可靠事件投递。
- 验收：未审批应用、错误 redirect URI、越权 scope 全部拒绝；secret 不可再次读取。

### Phase 5：头像与部署

- 实现头像上传、裁切、格式/大小校验、对象存储和版本化 URL。
- 官方路径验证 Vercel + PostgreSQL + R2 + 邮件 API。
- 自部署路径验证 Docker + PostgreSQL + MinIO；开发邮件使用 Mailpit。
- 验收：Serverless 多实例下无内存状态依赖；容器重启不丢身份数据；备份恢复文档可执行。

### Phase 6：LiveBoard 后端接入

- 增加认证模式、OIDC start/callback/link、`ExternalIdentity` 和 JIT 普通成员。
- 保留本地会话和应用授权，加入状态刷新与事件撤销。
- 验收：三种认证模式都可运行；冲突账号不误合并；HFLive Auth 故障时符合宽限与回滚策略。

### Phase 7：LiveBoard 前端接入

- 登录页根据模式展示入口；增加账号关联与冲突解决界面。
- 统一资料字段改为只读或跳转 HFLive Auth 编辑，应用私有资料留在本地。
- 验收：桌面和移动端路径完整；用户能理解账号归属和修改位置。

### Phase 8：现有用户迁移

- 发出邀请、建立新 HFLive 身份、逐一显式关联旧 LiveBoard 用户。
- 先启用 `hybrid`，观察完成率和错误，再切换官方实例默认入口。
- 验收：全部保留账号有明确迁移状态；管理员可安全回退到本地登录。

### Phase 9：上线与运维

- 覆盖单元、集成、OIDC 协议、端到端、安全和故障演练。
- 建立数据库备份恢复、密钥轮换、客户端 secret 轮换、账号事故处理文档。
- 验收：预发布清单通过；可观测性不记录密码、OTP、授权码、token 或 secret。

## 10. 当前实现状态

Phase 0–5 已完成基础契约、工程/OIDC 骨架、安全领域数据、邀请制账号、事务邮件、风险 OTP、受信设备、密码恢复、内部 client 管理、Directory API、可靠事件投递、头像对象存储、版本化 URL、Docker/MinIO 和备份恢复。官方 Vercel、Neon PostgreSQL、R2、Resend、Cloudflare outbox 调度与 EdgeOne 静态分发均已通过真实生产验收，HFLive Auth 核心平台已上线。当前进入 Phase 6：审查 LiveBoard 现有认证和数据模型，冻结接入设计，再实现三种认证模式、`ExternalIdentity`、OIDC start/callback/link、JIT 普通成员、状态同步与故障回滚。
