# 界面信息层级

HFLive Auth 的页面服务三个具体任务：成员登录、成员管理自己的资料、管理员管理成员与应用。协议、部署、状态机和运营规则留在 `docs/`；界面只显示用户当前决策需要的说明、错误和后果。

## 参考与取舍

- [Clerk Account Portal](https://clerk.com/docs/guides/account-portal/overview) 将登录与个人资料分成独立入口，并在完成认证后返回发起应用。HFLive Auth 沿用单独登录页和个人资料页，但只展示实际启用的用户名/邮箱与密码路径，不展示未实现的注册或社交登录入口。
- [Auth0 Universal Login](https://auth0.com/docs/customize/login-pages/universal-login) 将登录流程与页面文案集中管理，并允许按登录步骤调整提示。HFLive Auth 的登录、邮件验证码和授权确认各自只说明眼前动作；风险验证的解释放在验证码步骤。
- [Atlassian Administration](https://support.atlassian.com/organization-administration/docs/explore-an-atlassian-organization/) 按成员和应用组织管理信息。HFLive Auth 的管理页先呈现现有应用与成员，再提供创建和高级设置；最近操作独立放在后面。

上述是信息架构参考，不复制这些产品的注册、组织切换、计费或权限模型。HFLive Auth 仍只允许管理员邀请成员、审批应用。

## 页面约定

| 页面 | 首要动作 | 保留在界面的必要信息 |
| --- | --- | --- |
| 首页 | 访客登录；已登录成员管理资料；管理员进入后台 | 当前登录账号、首次使用的邀请入口提示 |
| 登录 | 输入用户名或邮箱和密码 | 错误反馈、找回密码；风险验证在下一步说明 |
| 个人资料 | 更新显示名、头像和邮箱 | 当前值、验证状态、保存结果；管理员维护用户名的提示 |
| 管理后台 | 查看应用与成员状态，按需创建或编辑 | 状态、操作、保存后的凭据一次性展示和撤销后果 |

敏感操作的后果必须贴近按钮或确认步骤。技术字段（redirect URI、scope、webhook 事件类型）只在管理员编辑区出现；成员入口不承担项目文档功能。
