# 全站视觉更新 · 2026-10

哑光石墨黑、暖白与少量陶土米色。几何 H 沿用已有轮廓；去除绿色主色、霓虹、玻璃面板与背景网格。10 月 16 日进一步将管理后台拆为独立栏目，列表、创建和编辑分开，使用开放版面、紧凑行和细分隔线。布局与配色规则见[设计说明](../../reference/interface-ux.md#2026-10-视觉系统)。

以下截图来自 10 月 16 日的本机生产构建和一次性测试账号，桌面为 1440px，手机为 390px。另检查 1024/768/320px 与编辑状态的横向溢出。图片中的姓名、成员和应用仅为本地验收数据；操作记录截图使用 `oauth.client` 搜索展示真实本地测试事件。

| 页面 | 桌面 | 手机 |
| --- | --- | --- |
| 登录 | [桌面截图](./sign-in-desktop.png) | [手机截图](./sign-in-mobile.png) |
| 个人资料 | [桌面截图](./profile-desktop.png) | [手机截图](./profile-mobile.png) |
| 应用列表 `/admin/applications` | [桌面截图](./admin-desktop.png) | [手机截图](./admin-mobile.png) |
| 添加应用 `/admin/applications/new` | [桌面截图](./application-create-desktop.png) | [手机截图](./application-create-mobile.png) |
| 应用设置 `/admin/applications/[clientId]` | [桌面截图](./application-settings-desktop.png) | [手机截图](./application-settings-mobile.png) |
| 成员列表 `/admin/members` | [桌面截图](./members-desktop.png) | [手机截图](./members-mobile.png) |
| 成员资料 `/admin/members/[userId]` | [桌面截图](./member-settings-desktop.png) | [手机截图](./member-settings-mobile.png) |
| 邀请记录 `/admin/invitations` | [桌面截图](./invitations-desktop.png) | [手机截图](./invitations-mobile.png) |
| 发送邀请 `/admin/invitations/new` | [桌面截图](./invitation-create-desktop.png) | [手机截图](./invitation-create-mobile.png) |
| 操作记录 `/admin/activity` | [桌面截图](./activity-desktop.png) | [手机截图](./activity-mobile.png) |

应用、成员、邀请每页 15 条，操作记录每页 20 条；截图中的简短列表不显示多余翻页控件。已用超过一页的临时数据实测分页、搜索、空状态、筛选保留、直接访问与浏览器前进后退。创建/保存后返回列表更新数据，进入详情后保留来源搜索和页码。手机列表保持紧凑，编辑仅在单项详情中进行。

验证还包括实际应用创建错误重试、一次性凭据焦点、成员重名错误和身份资料保存、停用恢复、邀请撤回与历史记录更新、8 个管理路由的权限限制、登录后返回原筛选页，以及完整 OIDC 回归。邀请邮件停用反馈使用真实响应；成功界面使用模拟响应，未发送邮件。此前登录错误、显示名保存、密码错误和弹窗键盘检查仍适用；头像上传与生产跨应用同步本轮未复测。完整验证结果见[开发进度](../../development-progress.md)。
