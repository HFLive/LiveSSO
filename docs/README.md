# HFLive Auth 文档中心

`docs/` 保存应随代码一起审查和演进的长期项目知识。开发规范采用 Docs as Code：Markdown 与代码使用同一版本控制、评审和验证流程。

## 文档地图

| 文档                                                                               | 类型        | 用途                                                                      |
| ---------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------- |
| [architecture.md](./architecture.md)                                               | 解释 / 架构 | 稳定目标、组件关系、协议边界、数据归属和安全不变量                        |
| [development-progress.md](./development-progress.md)                               | 动态状态    | 当前阶段、完成度、验证状态、阻塞项和下一步                                |
| [development-log.md](./development-log.md)                                         | 开发记录    | 按日期追加实现过程、关键问题、修正与验证证据                              |
| [local-development.md](./local-development.md)                                     | How-to      | 本地启动、迁移、验证、容器运行和常见故障处理                              |
| [reference/security-domain-data.md](./reference/security-domain-data.md)           | Reference   | Phase 2 领域模型、状态机、摘要、保留期与并发契约                          |
| [reference/phase3-auth-flows.md](./reference/phase3-auth-flows.md)                 | Reference   | Phase 3 邀请、邮件、风险登录、恢复和受信设备流程                          |
| [reference/phase4-internal-apps.md](./reference/phase4-internal-apps.md)           | Reference   | Phase 4 client 管理、Directory API、事件签名与 worker 契约                |
| [reference/phase5-profile-deployment.md](./reference/phase5-profile-deployment.md) | Reference   | Phase 5 头像处理、版本化 URL、R2/MinIO 与部署契约                         |
| [reference/phase6-liveboard-backend.md](./reference/phase6-liveboard-backend.md)   | Reference   | Phase 6 LiveBoard 认证模式、身份映射、状态同步、migration、回滚与验收基线 |
| [reference/phase7-liveboard-frontend.md](./reference/phase7-liveboard-frontend.md) | Reference   | Phase 7 登录入口、冲突关联、资料归属、可访问性与验收证据                  |
| [operations/backup-restore.md](./operations/backup-restore.md)                     | How-to      | PostgreSQL 与头像对象的一致备份、隔离恢复和回滚                           |
| [../IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md)                             | 路线图      | Phase 0–9 的总体实施基线与验收目标                                        |
| [../PHASE_1_STATUS.md](../PHASE_1_STATUS.md)                                       | 历史快照    | Phase 1 完成时的不可变验收记录                                            |

面向 Codex/AI 开发者的强制规则在 [../AGENTS.md](../AGENTS.md)。`AGENTS.md` 只保存每次任务都应生效的短规则；详细事实和过程记录放在本目录。

## 组织原则

文档按需求而不是按代码目录划分：

- **Tutorial**：未来用于新成员从零完成首次接入。
- **How-to**：解决具体任务，例如本地启动、部署、密钥轮换和故障恢复。
- **Reference**：记录环境变量、OIDC claims、API、数据模型和配置字段。
- **Explanation**：解释架构决策、安全模型和为什么这样设计。

当前初始化阶段先建立架构说明、进度、日志和本地开发 How-to；随着 Phase 2–9 推进，再增加 `reference/`、`operations/` 和接入教程，避免提前制造空目录。

## 维护规则

- 当前状态只更新 `development-progress.md`，不要复制到多个“最新进度”文件。
- `development-log.md` 只追加已发生事实，并记录实际执行过的验证。
- 稳定设计发生变化时更新 `architecture.md`，重大兼容性决定可新增 ADR。
- 命令、端口和环境变量改变时同步更新 `local-development.md` 与 `.env.example`。
- 不写入密码、token、client secret、私钥、真实生产连接串或用户隐私数据。
- 文档中的“已完成”“已验证”必须能由代码、测试、构建或运行结果支持。
