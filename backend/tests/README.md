# 后端测试策略

后端测试将至少覆盖：

- 用户与主体隔离
- User Space、当前助手持久化和五类数据复合归属过滤
- 会话、消息、当前版本与线性版本历史；分支、删除和重置留待后续阶段
- 软件事件结构与敏感字段脱敏
- 权限五档、会话失效、撤销和高风险确认
- 摘要来源、跨窗口读取、SubjectState 版本和 Context 装配边界
- AI Assistant Global Settings 的默认值、读取、更新、Context 投影及与 SubjectState 的边界
- Tool/MCP/Skill/Plugin 注册、Capability 权限投影和 Tool 未执行使用记录
- Device Registry、Capability、Adapter 契约、授权、安全确认、事件和未执行操作日志
- Security Policy、用户安全偏好、生命周期事件、短时会话授权和迁移外键完整性
- AI Private Space 五类内容、不可变版本、复合隔离、安全门、Context 投影和导出结构预留
- 生活管理管账/预算/月历/身体/本地记忆、安全链、事件脱敏与隔离
- Wake、主动提示、Token 日/会话预算、后台策略和零执行边界
- continuity-engine、模型和外部能力边界
- Export Schema、十二类数据范围、完整性预检、安全确认、导出记录和未执行迁移契约
- 错误结果不泄露密钥或其他用户数据

当前使用 Node.js 内置测试运行器，不连接任何真实外部服务。测试数据库位于操作系统临时目录，每个测试使用独立 SQLite 文件并在结束后清理。

运行：

```bash
pnpm test
```

当前测试结果为 49/49 通过，已覆盖服务启动、统一响应 envelope、数据导出/迁移准备、主动交互/Token 控制、账号/User Space/主体、当前助手、五类数据边界、设定/私域、对话/Context、生活管理、Event、模型路由、能力/设备、Permission/Security/Confirmation/AuditLog、事务回滚、重启持久化、迁移升级、跨用户/主体隔离和秘密字段拦截。

Data Export 测试覆盖迁移 `017` 对既有 Permission、Security Policy、Confirmation 与 AuditLog 的保留和外键完整性，三类 Export Schema、十二类范围、归属/字段/关系预检、缺失字段阻止、`data_export` Permission、高风险逐次确认、导出记录持久化和跨用户/主体隔离。机器人/其他载体契约固定未实现、未连接、未执行，接口拒绝服务地址等连接载荷，所有结果均不包含业务数据、不创建文件、不连接外部存储。

Account/Data Isolation 测试覆盖迁移 `015` 对既有用户的空间与当前助手回填、外键完整性、User/Space 原子创建、首个助手选择、助手列表、切换与重启持久化。测试同时验证多助手 Global Settings 与 SubjectState 保持独立，用户/AI/设备/生活/Event 资源只通过固定复合范围命中，错配组合按未找到处理；AI 私域、设备和生活资源在所有权命中后仍经过 Permission 与 Security Policy，全部结果保持 `not_executed`。

Life Management 测试覆盖收入/支出、整数金额精度、预算提醒、分类统计、UTC 月度汇总、四类月历与提醒、身体指标/目标/趋势、显式建议字段、本地记忆上下文/导出标记和 Context 投影。迁移测试从 `013` 结构保留 Permission、Security Policy、Confirmation、AuditLog 和 SessionGrant 关系升级到 `014`。同时验证 `life_data` 安全链、策略拒绝、重启持久化、跨用户/主体隔离、三类 Event 脱敏和外键完整性；不连接支付、银行、穿戴设备、模型或外部服务。

Proactive Interaction 测试覆盖 `015` 权限/策略迁移保留、`proactive_interaction` 安全范围、四类 Wake、应用内授权、后台允许范围、Event 驱动提示、四级优先级、高风险确认与静默抑制。Token 测试覆盖日/会话累计、三种超额策略、显式使用账本和跨用户/主体隔离。所有断言要求麦克风、系统唤醒、消息投递、模型、计费和外部调用保持未执行。

AI Private Space 测试覆盖五类内容、首版与更新版本、`baseVersionId`、数据库不可变触发器、Space 状态、高风险确认、Permission/Policy 拒绝、独立 Context 投影、无正文 Export Manifest、三类私域 Event 脱敏、重启持久化、复合归属隔离和外键完整性。测试输入均为显式样例，不运行模型、continuity-engine、机器人或外部设备。

Conversation / Message / MessageVersion 测试覆盖会话与消息创建和查询、会话内 `sequenceNumber`、`currentVersionId` 指针、原始/编辑/重生成版本历史、不可变版本、`baseVersionId` 防陈旧写、发送者限制、复合归属隔离、自动 Event 不含标题或内容，以及 Event 失败时消息/版本/指针/会话活动时间的事务回滚。主体消息和重生成测试内容由调用方显式提交，不调用 AI。所有测试只访问本地测试服务与临时 SQLite，不调用真实模型、支付、设备或外部 API。

Context / Summary / SubjectState 测试覆盖摘要保存、MessageVersion/Event 来源、跨窗口最新摘要、`state_update` 三类来源、当前状态指针、未解决 Event、Context 固定顺序、Memory 未实现标记、零模型/外部调用标记、重启持久化、跨用户/主体/Conversation 隔离、不可变触发器以及摘要/状态复合写入回滚。

Assistant Global Settings 测试覆盖创建主体时的默认设定、七类字段局部更新、跨窗口 Context 读取、重启持久化、未知/非法字段拒绝、去重列表、跨用户隔离、无变化不写入，以及 Subject 身份、扩展设定和 Event 的事务回滚；同时验证设定更新不会创建或改变 SubjectState。

Model Routing 测试覆盖 Provider 的 Base URL、接口格式、启停与测试状态，Model 的八类能力标签、费用说明与测试状态，六类任务查询，默认/备用规则创建、读取、更新与重启持久化。测试验证默认 Provider 停用时切换到备用模型、显式规则不可用时明确失败、无规则时稳定目录回退、跨用户或能力不匹配引用被拒绝，以及全部路由结果均标记模型和外部 API 未调用。API Key、Token、Secret、凭据引用和含凭据 Base URL 均被拒绝，安全存储端口明确返回 `writeSupported=false`。

Capability 测试覆盖 Tool/MCP/Skill/Plugin 创建、默认停用、启停、查询、持久化、用户内名称唯一和跨用户隔离；统一能力视图覆盖分类、Permission 允许/询问/拒绝、Plugin 纯元数据状态和 Tool 最近使用。Tool 执行准备覆盖低风险直接准备、中风险确认、确认消费、停用阻止和缺少权限拒绝；全部记录固定 `not_executed`、零外部调用和零 Token。执行载荷、含凭据 MCP 地址与跨主体读取均被拒绝，不连接任何外部服务。

Device 测试覆盖七类设备、四类能力、品牌到未配置 Adapter 的映射、默认停用、查询筛选、启停、持久化和跨用户隔离。授权写入复用 Permission 并产生 `permission_created` 与 `device_changed`；操作准备必须经过 Permission、Security Policy、Security 和 Confirmation，设备控制风险固定为 `critical`，全部结果固定 `not_executed`、`not_connected` 和零厂商调用。测试还覆盖禁用设备、未声明能力、真实控制参数、跨主体访问、日志/审计/Event 关联和事务回滚。

Security Policy 测试覆盖五种规则、默认/高风险偏好、自动确认与禁止范围、CRUD、软删除、持久化和用户隔离；验证策略只能收紧 Permission，高/极高风险不能被自动或会话放行。会话授权测试覆盖确认后创建、精确作用域、30 分钟失效、策略版本失配及跨会话隔离。迁移测试从 `011` 结构保留带 Event/AuditLog 外键的设备日志升级到 `012`，并验证 `PRAGMA foreign_key_check` 为空。
