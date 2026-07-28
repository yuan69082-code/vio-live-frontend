# 后端测试策略

后端测试将至少覆盖：

- 用户与主体隔离
- 会话、消息、当前版本与线性版本历史；分支、删除和重置留待后续阶段
- 软件事件结构与敏感字段脱敏
- 权限五档、会话失效、撤销和高风险确认
- continuity-engine、模型和外部能力边界
- 导出、删除、备份和恢复范围
- 错误结果不泄露密钥或其他用户数据

当前使用 Node.js 内置测试运行器，不连接任何真实外部服务。测试数据库位于操作系统临时目录，每个测试使用独立 SQLite 文件并在结束后清理。

运行：

```bash
pnpm test
```

当前测试结果为 17/17 通过，已覆盖服务启动、统一响应 envelope、User 当前开发上下文、Subject 创建/列表/查询/更新、Dashboard、Subject 更新与 Event 事务回滚、Event、Provider/Model/Router、Permission CRUD、五档三态判断、Security 四级风险、三种确认要求、确认隔离与防重放、AuditLog、`allow_once` 确认前预览与最终消费、软删除、重启持久化、跨用户/主体隔离和密钥字段拦截。

Conversation / Message / MessageVersion 测试覆盖会话与消息创建和查询、会话内 `sequenceNumber`、`currentVersionId` 指针、原始/编辑/重生成版本历史、不可变版本、`baseVersionId` 防陈旧写、发送者限制、复合归属隔离、自动 Event 不含标题或内容，以及 Event 失败时消息/版本/指针/会话活动时间的事务回滚。主体消息和重生成测试内容由调用方显式提交，不调用 AI。所有测试只访问本地测试服务与临时 SQLite，不调用真实模型、支付、设备或外部 API。
