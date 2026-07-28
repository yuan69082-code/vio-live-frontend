# Vio Live 平台后端规划

## 文档定位

本目录依据《Vio Live 产品与开发总规划 v2.4｜平台后端与前端版》整理，用于描述平台后端的职责、数据边界、接口原则、安全约束和开发顺序。

本目录记录稳定规划。仓库已完成可运行平台后端、开发数据库、User/Subject/Dashboard、AI Assistant Global Settings、Conversation/Message/MessageVersion、可追溯 ConversationSummary、SubjectState / `state_update`、跨窗口摘要和只读 Context 装配基础 API，以及 Event、Provider/Model、六类任务默认/备用路由、Permission 判断和 Security/Confirmation/AuditLog；前端已建立独立 API 客户端和真实健康握手。这不代表真实认证、页面数据迁移、正式数据库、事件消费、真实摘要生成、模型连接/测试、API Key、Memory、continuity-engine、支付、MCP、设备适配或外部执行能力已经完成。

## 系统边界

Vio Live 由五层协作组成：

1. 用户端前端：承载登录、工作台、对话、连续性、AI 私域、能力、设备和设置页面。
2. 平台后端：负责账号、数据库、模型路由、权限、安全、事件、设备适配和扩展管理。
3. 连续性引擎：负责身份、关系、时间、意图、情绪、记忆影响、状态演化、学习和资源。
4. AI 模型：提供语言、图像、视频和语音等模型能力。
5. 外部能力：包括 MCP、Skill、插件、Tool、手机、家电、穿戴设备和第三方服务。

平台后端与连续性引擎是平行系统。本目录只记录平台后端自身规划，以及平台后端连接连续性引擎时需要遵守的接口边界，不定义连续性引擎的内部实现。

## 当前状态

- 项目当前包含 React + Vite + TypeScript 前端，以及独立的 Node.js 平台后端工程。
- 当前前端页面仍使用模拟数据；独立 API 客户端已通过 Vite 同源代理连接后端并执行启动健康检查，但页面尚未消费真实 User/Subject/Dashboard/Conversation 数据。
- 已建立独立 `backend/` 工程、README、后端 ADR、开发日志和阶段实施路线。
- 后端可以独立启动，并提供统一响应、健康检查、User/Subject/Dashboard、Assistant Global Settings、Conversation/Message/MessageVersion、Event、Provider/Model、Model Routing Rule、Permission、Security、Confirmation 和 AuditLog 基础接口。
- 已完成核心逻辑数据模型，并使用开发期 SQLite 实现 `users`、`subjects`、`assistant_global_settings`、`conversations`、`messages`、`message_versions`、`conversation_summaries`、`conversation_summary_sources`、`subject_states`、`subject_state_heads`、`subject_state_unresolved_events`、`events`、`api_providers`、`models`、`model_capabilities`、`model_routing_rules`、`permissions`、`security_confirmations`、`audit_logs` 和迁移记录。
- Conversation 当前只支持主体范围的线性文本流；Message 保存稳定顺序和当前版本指针，MessageVersion 保存不可覆盖的原始、编辑和重生成记录。
- ConversationSummary 按会话不可变追加并引用 MessageVersion/Event 来源；跨窗口只读取同主体其他 Conversation 的最新摘要。
- SubjectState 按版本保存开发调用方提交的 `state_update`，当前指针与历史分离，未解决 Event 和状态来源均校验用户/主体归属。
- AI Assistant Global Settings 一对一绑定 Subject，支持长期身份与偏好读取/更新；它不会创建、覆盖或切换动态 SubjectState。
- Context 接口只读装配主体设定、当前状态、未解决事件、近期消息和跨窗口摘要；系统规则正文与 Memory 仍为明确占位，不调用模型或 continuity-engine。
- Event 当前支持用户/可选主体归属、九种事件类型，以及按用户、主体、发生时间、类型和状态筛选；对话事件不复制标题或消息正文，尚无事件消费者。
- Model Router 当前支持聊天、长文本、图片、视频、语音、搜索六类默认/备用规则和目录回退，只返回本地模型描述；测试状态固定未测试，API Key 安全存储端口不支持写入，不调用真实模型。
- Permission 当前支持七类资源、五档权限、精确操作判断和权限变化事件；不执行任何真实资源操作。
- Security 当前按 Permission、四级风险和三种确认要求返回执行资格，明确标记未执行；确认绑定完整作用域并单次消费。
- SensitiveData 只定义五类分类元数据；AuditLog 与 Event 分离且只保存最小脱敏字段。
- 当前未接入真实认证或正式数据库，基础路由不得直接公开部署。
- 总规划记录的部分连续性底层框架不等于平台后端已经完成。
- 分支、消息删除、窗口重置、真实摘要生成、Memory、语义检索、Token 预算、正式数据库、真实模型、continuity-engine、MCP、设备、外部执行和公开运行能力仍处于规划或待接入状态。
- GitHub 只保存代码和文档，不保存运行数据、用户数据或密钥。

## 文档目录

- [01-总体架构与系统边界.md](01-总体架构与系统边界.md)
- [02-领域模型与数据库设计.md](02-领域模型与数据库设计.md)
- [数据库设计.md](数据库设计.md)
- [数据关系图.md](数据关系图.md)
- [03-账号认证与数据隔离.md](03-账号认证与数据隔离.md)
- [04-事件总线与审计版本.md](04-事件总线与审计版本.md)
- [05-对话上下文与连续性接口.md](05-对话上下文与连续性接口.md)
- [06-模型路由密钥与Token管理.md](06-模型路由密钥与Token管理.md)
- [07-扩展能力与设备适配.md](07-扩展能力与设备适配.md)
- [08-权限安全与隐私治理.md](08-权限安全与隐私治理.md)
- [09-AI私域后端规则.md](09-AI私域后端规则.md)
- [10-生活管理后端.md](10-生活管理后端.md)
- [11-数据导出备份与迁移.md](11-数据导出备份与迁移.md)
- [12-API与事件契约.md](12-API与事件契约.md)
- [13-部署运维测试与路线图.md](13-部署运维测试与路线图.md)

## 维护规则

- 本目录记录稳定规划和约束，不记录具体实现代码。
- 后端详细工程记录写入 `backend/docs/开发日志.md`，项目级摘要继续写入 `docs/工程日志.md`。
- 版本变化继续写入 `docs/更新记录.md`。
- 后端局部技术取舍写入 `backend/docs/ADR.md`；影响平台总体边界的决策同步到 `docs/决策记录.md`。
- 未经新的产品决策，不在本目录扩展总规划之外的产品功能。
- 密钥、密码、Token、用户原始数据和设备凭据不得写入文档或 GitHub。

## 工程设计入口

- [后端工程 README](../../backend/README.md)
- [后端 API 说明](../../backend/docs/API.md)
- [后端 ADR](../../backend/docs/ADR.md)
- [后端开发日志](../../backend/docs/开发日志.md)
- [第一阶段实施路线](../../backend/docs/第一阶段实施路线.md)
