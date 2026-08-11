# Phase 7 LiveBoard 前端接入参考

状态：实现与本机真实 `hybrid` 验收完成
最后更新：2026-08-11

本阶段只完成 LiveBoard 的登录、显式关联、冲突解决和统一资料入口。它不创建或邀请
真实成员，不批量关联旧账号，不切换官方实例默认模式；这些属于 Phase 8。

## 1. 模式驱动的登录页

LiveBoard Web 启动后读取 API 的 `GET /auth/config`，不得用 Web 构建变量推测服务端
模式。响应使用 `no-store`，只包含：

- `mode: local | hybrid | hflive_oidc`；
- `localLogin`、`hfliveOidc`、`breakglass` 三项能力；
- 固定 issuer 与 HFLive 资料页 URL，不包含任何 secret。

界面矩阵：

| 模式          | 普通入口                              | 紧急入口                        |
| ------------- | ------------------------------------- | ------------------------------- |
| `local`       | LiveBoard 本地账号密码                | 不显示                          |
| `hybrid`      | HFLive 为主入口，同时保留本地账号密码 | 不显示                          |
| `hflive_oidc` | 只显示 HFLive                         | 仅 `breakglass=true` 时折叠显示 |

登录能力加载失败时不猜测模式或静默显示本地密码，而是提供重新加载。普通本地登录和紧急
登录使用不同端点；紧急入口只接受最高管理员，并由 Phase 6 审计。

## 2. 冲突与显式关联

首次 OIDC 登录若命中用户名或邮箱冲突，后端仍不自动合并。callback 把浏览器重定向到
`/login/link#ticket=<opaque>`：

1. 票据只存在 fragment，不进入 HTTP 请求、服务端 access log 或 referrer；
2. 页面读入后立即从地址栏移除；
3. 用户输入旧 LiveBoard 普通成员账号与密码证明归属；
4. 票据由 Redis `GETDEL` 单次消费，错误密码、过期或重放都要求重新发起 OIDC；
5. 管理员与最高管理员不能自助合并，必须走 Phase 6 受控管理员关联；
6. 关联不会提升 `systemRole` 或改变课堂角色、权限、标签和配额。

已有本地会话也可在个人设置输入当前密码，调用 `POST /auth/hflive/link/start` 发起
`LOCAL_SESSION` intent。成功回调仍签发 LiveBoard 本地 Cookie。

其他 callback 故障回到 `/login?reason=hflive-failed` 的通用可重试状态，不向浏览器
展示 OIDC 协议错误、claims 或 token 信息。

## 3. 统一资料与本地资料

`GET /auth/hflive/account` 只返回当前登录用户的安全摘要，使用
`private, no-store`，不返回 `sub`、token、Cookie 或 client secret。

已关联且 `AUTH_MODE != local` 时：

| 字段或能力                      | 权威来源    | LiveBoard 前端行为                       |
| ------------------------------- | ----------- | ---------------------------------------- |
| 用户名、邮箱、显示名、头像      | HFLive Auth | 只读；跳转 HFLive `/profile` 修改        |
| bio、Banner、徽章、打开方式     | LiveBoard   | 保持本地可编辑                           |
| 系统/课堂角色、权限、标签、配额 | LiveBoard   | 保持本地，不从 OIDC 自动授予             |
| 本地密码                        | LiveBoard   | 旧账号保留用于 hybrid/回滚；JIT 默认关闭 |

当前用户、应用侧栏和公开个人主页读取 `UserProfile` 时优先使用
`ExternalIdentity.picture`。API 同时拒绝绕过 UI 修改 HFLive 权威显示名或上传本地头像。
`AUTH_MODE=local` 回滚后重新使用旧本地显示名和头像，不删除映射或 JIT 用户。

`PROFILE_CONFLICT` 不解除稳定映射；个人设置显示不含 subject 的处理提示并要求联系
管理员。HFLive 资料页使用固定 `https://auth.hsfz.live/profile`。

## 4. 可访问性与错误状态

- HFLive 主入口、密码可见性、取消关联和资料跳转均为原生 link/button；
- 冲突页账号输入自动获得焦点，错误文本使用 `role=alert` 或 `aria-live`；
- 移动端输入计算字号至少 16px，不禁止用户缩放；
- 过期或缺失票据不渲染密码证明表单；
- 加载身份上下文时显示稳定骨架，不短暂伪装成“本地身份”；
- 桌面与移动端不得产生页面横向溢出。

## 5. 2026-08-11 验收证据

- `pnpm typecheck`、`pnpm test`、`pnpm build` 通过；API 477 项、Web 280 项、Shared
  16 项测试通过，另有发布/HTTPS/legacy baseline 脚本回归通过。
- `pnpm test:phase6` 使用真实 PostgreSQL 与 Redis 验证并发 JIT、webhook 幂等和
  OIDC state `GETDEL`，3 项通过。
- 定向测试覆盖三种模式、break-glass、callback 回跳、fragment 单次票据、关联失败、
  权威字段服务端保护、外部头像优先和 local 回滚。
- 本机真实 `hybrid` 配置与已关联管理员账号通过 1280×720、390×844 浏览器验收：
  登录/冲突/个人设置无横向溢出，移动输入为 16px，外部头像和只读显示名生效，过期
  票据不显示证明表单，浏览器控制台无错误。

生产 Vercel 同源 callback 和正式 webhook 投递仍是 Phase 6 外部部署验收缺口；Phase 7
前端完成不等于 Phase 8 用户迁移或官方实例已切换 `hflive_oidc`。
