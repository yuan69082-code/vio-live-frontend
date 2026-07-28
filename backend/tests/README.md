# 后端测试策略

后端测试将至少覆盖：

- 用户与主体隔离
- 会话、消息、当前版本与线性版本历史；分支、删除和重置留待后续阶段
- 软件事件结构与敏感字段脱敏
- 权限五档、会话失效、撤销和高风险确认
- 摘要来源、跨窗口读取、SubjectState 版本和 Context 装配边界
- AI Assistant Global Settings 的默认值、读取、更新、Context 投影及与 SubjectState 的边界
- continuity-engine、模型和外部能力边界
- 导出、删除、备份和恢复范围
- 错误结果不泄露密钥或其他用户数据

当前使用 Node.js 内置测试运行器，不连接任何真实外部服务。测试数据库位于操作系统临时目录，每个测试使用独立 SQLite 文件并在结束后清理。

运行：

```bash
pnpm test
```

当前测试结果为 24/24 通过，已覆盖服务启动、统一响应 envelope、User 当前开发上下文、Subject 创建/列表/查询/更新、Assistant Global Settings、Dashboard、Subject 更新与 Event 事务回滚、Event、Provider/Model/默认备用路由、009 旧库升级、Permission CRUD、五档三态判断、Security 四级风险、三种确认要求、确认隔离与防重放、AuditLog、`allow_once` 确认前预览与最终消费、软删除、重启持久化、跨用户/主体隔离和密钥字段拦截。

Conversation / Message / MessageVersion 测试覆盖会话与消息创建和查询、会话内 `sequenceNumber`、`currentVersionId` 指针、原始/编辑/重生成版本历史、不可变版本、`baseVersionId` 防陈旧写、发送者限制、复合归属隔离、自动 Event 不含标题或内容，以及 Event 失败时消息/版本/指针/会话活动时间的事务回滚。主体消息和重生成测试内容由调用方显式提交，不调用 AI。所有测试只访问本地测试服务与临时 SQLite，不调用真实模型、支付、设备或外部 API。

Context / Summary / SubjectState 测试覆盖摘要保存、MessageVersion/Event 来源、跨窗口最新摘要、`state_update` 三类来源、当前状态指针、未解决 Event、Context 固定顺序、Memory 未实现标记、零模型/外部调用标记、重启持久化、跨用户/主体/Conversation 隔离、不可变触发器以及摘要/状态复合写入回滚。

Assistant Global Settings 测试覆盖创建主体时的默认设定、七类字段局部更新、跨窗口 Context 读取、重启持久化、未知/非法字段拒绝、去重列表、跨用户隔离、无变化不写入，以及 Subject 身份、扩展设定和 Event 的事务回滚；同时验证设定更新不会创建或改变 SubjectState。

Model Routing 测试覆盖 Provider 的 Base URL、接口格式、启停与测试状态，Model 的八类能力标签、费用说明与测试状态，六类任务查询，默认/备用规则创建、读取、更新与重启持久化。测试验证默认 Provider 停用时切换到备用模型、显式规则不可用时明确失败、无规则时稳定目录回退、跨用户或能力不匹配引用被拒绝，以及全部路由结果均标记模型和外部 API 未调用。API Key、Token、Secret、凭据引用和含凭据 Base URL 均被拒绝，安全存储端口明确返回 `writeSupported=false`。
