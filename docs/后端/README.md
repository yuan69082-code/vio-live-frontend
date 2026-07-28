# Vio Live 平台后端规划

## 文档定位

本目录依据《Vio Live 产品与开发总规划 v2.4｜平台后端与前端版》整理，用于描述平台后端的职责、数据边界、接口原则、安全约束和开发顺序。

本目录记录稳定规划。仓库已完成可运行平台后端、开发数据库、账号与数据隔离、对话/Context、Event、模型路由、Permission/Security、扩展/设备/私域/生活数据、主动交互/Token 控制，以及版本化数据导出准备基础；前端已建立独立 API 客户端和真实健康握手。这不代表真实认证、页面数据迁移、正式数据库、事件消费、真实语音/系统唤醒、后台调度、消息投递、导出文件/外部存储/真实迁移、模型连接/测试、API Key、continuity-engine 或真实外部执行已经完成。

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
- 后端可以独立启动，并提供统一响应、健康检查、User/User Space/Subject/Dashboard、当前助手与数据隔离检查、Assistant Global Settings、Conversation/Message/MessageVersion、Event、Provider/Model、Model Routing Rule、扩展/设备、主动交互、Data Export、Permission、Security Policy、安全偏好、Security、Confirmation 和 AuditLog 基础接口。
- 主动交互基础支持四类 Wake、Event 驱动提示、四级消息优先级、每日/会话 Token 预算、显式使用账本和 `idle` / `active` 后台策略；所有运行能力固定未连接或未执行。
- 数据导出基础支持三类版本化 Schema、十二类范围、复合归属/必需字段/外键预检、安全确认和导出记录；载荷、文件、外部存储与迁移固定未生成/未连接/未执行。
- 已完成核心逻辑数据模型，并使用开发期 SQLite 实现账号/主体、设定/私域、对话/摘要/状态、事件、模型路由、能力/设备、主动交互、Export Schema/DataExportRecord、权限/安全/确认/审计及迁移记录。
- 每个用户拥有一个 User Space；首个助手自动成为当前助手，后续可以在本用户助手列表中切换。当前指针不改变任何 Assistant Global Settings、Private Space、SubjectState、对话、事件或生活数据归属。
- 统一数据隔离检查覆盖用户、AI、设备、生活和事件五类资源，先执行数据库复合归属过滤，再对私域/设备/生活资源执行 Permission 与 Security Policy；所有结果固定未执行。
- Conversation 当前只支持主体范围的线性文本流；Message 保存稳定顺序和当前版本指针，MessageVersion 保存不可覆盖的原始、编辑和重生成记录。
- ConversationSummary 按会话不可变追加并引用 MessageVersion/Event 来源；跨窗口只读取同主体其他 Conversation 的最新摘要。
- SubjectState 按版本保存开发调用方提交的 `state_update`，当前指针与历史分离，未解决 Event 和状态来源均校验用户/主体归属。
- AI Assistant Global Settings 一对一绑定 Subject，支持长期身份与偏好读取/更新；它不会创建、覆盖或切换动态 SubjectState。
- Context 接口只读装配主体设定、当前状态、未解决事件、近期消息和跨窗口摘要；系统规则正文与 Memory 仍为明确占位，不调用模型或 continuity-engine。
- AI Private Space 使用专用表和不可变内容版本，支持五类显式输入、受控 Context 投影和导出清单预留；通用 Context 不自动读取私域。
- 生活管理使用独立生活数据表保存财务、预算、四类月历、身体指标/目标和本地记忆，并由 User Space 作为用户归属根；所有敏感访问经过 `life_data` Permission 与 Security Policy。
- Event 当前支持用户/可选主体归属、二十四种事件类型，以及按用户、主体、发生时间、类型和状态筛选；对话、安全、私域、生活和主动交互事件不复制正文、音频或敏感操作数据，尚无事件消费者。
- Model Router 当前支持聊天、长文本、图片、视频、语音、搜索六类默认/备用规则和目录回退，只返回本地模型描述；测试状态固定未测试，API Key 安全存储端口不支持写入，不调用真实模型。
- Permission 当前支持十类资源（含 `proactive_interaction`、`data_export`）、五档权限、精确操作判断和创建/变化/撤销生命周期事件；不执行任何真实外部资源操作。
- Security Policy 支持五种规则、用户默认风险/高风险/自动确认/禁止偏好和 30 分钟精确会话授权；策略只能收紧 Permission，高/极高风险保持逐次确认。
- Security 当前按 Permission → Policy → Confirmation 返回执行资格，明确标记未执行；确认绑定完整作用域、权限/策略版本和开发期安全会话并单次消费。
- SensitiveData 只定义五类分类元数据；AuditLog 与 Event 分离且只保存最小脱敏字段。
- Tool/MCP/Skill/Plugin 当前只保存注册元数据并按主体投影权限；MCP 未连接、Plugin 未安装、Skill/Tool 未执行。Tool 准备记录只表示 Permission 与 Security 门槛结果。
- Device 当前按用户保存七类设备和四类能力元数据，主体授权复用 Permission；统一 Adapter 只有小米、美的、Apple、Android 和通用类型的未配置描述。设备始终标记未连接、状态未观测，操作准备与日志始终标记未执行，不包含厂商客户端或真实控制参数。
- 当前未接入真实认证或正式数据库，基础路由不得直接公开部署。
- 总规划记录的部分连续性底层框架不等于平台后端已经完成。
- 分支、消息删除、窗口重置、真实摘要生成、语义检索、供应商 Token 计量/计费、私域披露/删除、真实导出文件/下载/外部存储、备份恢复、生活记录删除、自动提醒、支付/银行、健康设备、真实语音/系统唤醒、后台调度、消息投递、正式数据库、真实模型、continuity-engine、真实 MCP、插件安装、Skill/Tool 执行、真实设备/机器人连接控制、载体迁移、厂商 API、外部执行和公开运行能力仍处于规划或待接入状态。
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
