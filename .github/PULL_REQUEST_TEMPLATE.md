## 变更内容

<!-- 说明做了什么，以及为什么需要这项变更。 -->

## 用户与运维影响

<!-- 登录、OIDC client、会话、迁移、部署或回滚是否受到影响？ -->

## 验证

- [ ] `pnpm validate`
- [ ] 涉及路由、依赖或构建配置时运行 `pnpm build`
- [ ] 涉及数据库时创建 migration 并验证 `pnpm db:deploy`
- [ ] 涉及认证/OIDC 时运行对应集成测试和 OIDC smoke
- [ ] 涉及 Docker 时实际构建镜像并检查 readiness
- [ ] 涉及 UI 时检查桌面、移动、键盘与错误状态

## 安全检查

- [ ] 未提交密码、OTP、token、client secret、私钥或生产连接串
- [ ] 未放宽注册、redirect URI、scope、权限或账号关联边界
- [ ] 已评估会话、密钥轮换、迁移和回滚影响

## 文档

- [ ] 已同步更新相关架构、开发、部署或协议文档；或本次无需更新
