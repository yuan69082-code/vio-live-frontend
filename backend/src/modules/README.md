# 平台业务模块边界

业务模块职责分类如下，不代替现行阶段顺序；R0 验收后先 R2 再 R1，随后 R3 至 R13，详见 [路线图](../../../docs/后端/13-部署运维测试与路线图.md#r0-r13-order)：

1. 账号与身份
2. 智能体主体与归属
3. 会话、消息和版本
4. 软件事件
5. 权限、确认、撤销和审计
6. 上下文装配与连续性协调
7. 模型与扩展能力管理
8. 设备、AI 私域、生活模块和数据治理

模块负责业务规则和用例；具体数据库、模型服务、continuity-engine 或设备 SDK 通过装配依赖进入。`personal/` 现承载唯一个人所有者初始化、会话、首次设置、资料、多助手选择、访问审计/诊断及配置编排；所有业务身份来自验证会话，不接受客户端 userId。账户级 Provider/Model/凭据及删除操作仍复用 Permission → Security → Confirmation/Audit。`personal-deletion-service.js` 持久化 7/14/30 天政策和限权恢复，`personal-managed-copies.js` 只处理明确登记的单所有者受管文件，不建设 R11 完整备份。

`subject-runtime/` 承载通用合同、状态机、None Adapter、第三方入口和 Engine 专用合同登记。R0-B 已在应用默认装配 None Adapter 及通用只读状态服务，R0-C 已消费该状态；不能再称当前没有应用装配。None Adapter 不伪造 expression、projection、revision 或能力。R1 新增的个人独立聊天不调用该 Adapter，也不把外部运行时伪装成 Vio 自有执行；真实外部适配器选择和联调仍须另行授权，并非 Vio 发布门槛。规则与阶段证据见 [R0矩阵](../../docs/SUBJECT_RUNTIME_PORT_V1.md#r0-evidence)。

`standalone-chat/` 承载 R1/R3 个人独立聊天编排。R1 服务保留原默认会话与执行/恢复事实；R3 在同一 R2 owner/当前助手范围增加多会话目录、选择、分支、消息版本、重新生成、附件、导出和操作查询，并复用 R1 正式模型路由/凭据/Permission/Security/Token Budget/Provider 执行边界。Provider 上下文只读取当前选定会话与分支的有界、已锁定版本；查询、切换、导出与启动不调用模型，明确重新生成才创建新 execution/result，`outcome_unknown` 保持 fail closed。精确合同见 [R1](../../docs/R1_STANDALONE_CHAT_CONTRACT.md) 与 [R3](../../docs/R3_MULTI_CONVERSATION_CONTRACT.md)。本模块不连接或探测 Engine，也不改变历史 V1–V5/S4 合同。

`continuity-integration/` 承载 Continuity Engine Adapter 专用的 V1–V5 连接编排，而不是 Vio Core 合同。V1 提供严格请求；V2 提供结果/投影账本；V3 提供本机 HTTP delivery；V4 提供受控 Capability 模型执行与回传；V5 在固定本地 Profile 下把公共 Conversation Turn API 与用户 Message、V1 请求、V3/V4/V2 结果和最终主体 Message 关联。只有 Engine 最终 `FirstRoundSuccessResult.response.content` 能形成 V5 主体 Message，Provider 原始候选不能直接落入对话。模块不创建 Engine Event/StateMutation、不写 legacy SubjectState；S2/S3、S4 和 V5 shared test 分别验证正式本机链路、Capability 与公共轮次恢复边界。R0-A 没有移动、删除或切换这些既有实现。

User Space 是账号的一对一数据根，只保存开发期身份状态、空间状态和当前助手指针。当前助手是用户导航选择，不是 Subject 状态；切换不会修改 Global Settings、Private Space、SubjectState、对话、事件或生活数据。数据隔离模块只接收预定义资源类型和不透明 ID，先通过仓储复合过滤验证归属，再对私域、设备和生活资源调用既有 Permission/Security 链。它不读取资源正文、不接受任意 SQL/表名，也不执行资源操作。

AI 私域模块只保存调用方显式提交的五类 JSON 记录，Space 与内容版本使用专用表；每次更新追加不可变版本。空 Space 创建用于生成精确 Permission 的资源 ID，其后读取、写入、管理、Context 投影和导出准备都必须经过 Permission → Security Policy → Confirmation。该模块不实现意识、自主行为、内容开放判断、模型生成、机器人或外部连接。

助手全局设定模块把 Subject 中的名称/头像与一对一长期设定投影为单一 API 对象；扩展设定包括人格、表达方式、关系、长期要求和禁止事项。它不保存情绪、未解决事件或动态状态，不会写入 SubjectState。会话模块保持用户—主体—会话复合归属。Message 是稳定逻辑消息，使用会话内 `sequenceNumber` 排序并以 `currentVersionId` 指向当前内容；MessageVersion 只追加 `original`、`edited` 或 `regenerated` 版本，不原地覆盖。ConversationSummary 只追加摘要版本并保存强来源引用，SubjectState 只追加 `state_update` 并由独立当前指针选择。Context 按固定顺序只读装配，不持久化结果、不生成提示词、不调用 AI 或 continuity-engine。当前不实现 Memory、分支、删除或重置。

安全模块保持以下边界：Permission 决定基础权限，Security Policy 与 Security 只能收紧；用户偏好不能降低平台 `high` / `critical` 逐次确认底线。`session_allow` 只形成明确确认后的精确、短时开发期授权，不是认证。SensitiveData 只定义分类元数据并提供只读查询；Confirmation 不代表执行；AuditLog 与 Event 分离且只记录最小字段。

模型配置模块保持以下边界：APIProvider 保存服务来源、Base URL、接口格式与启停元数据；Model 保存名称、类型、能力、费用说明与测试状态；Model Routing Rule 按用户和任务保存默认/备用模型。R2 个人配置可安全写入、轮换和撤销加密凭据，并以受限 `/models` 请求做网络/认证检查；该检查不调用生成、不证明模型生成能力、不产生受控测试之外的供应商调用。V4 的正式生成执行仍是独立既有链路。

扩展能力模块保持以下边界：Registry 只保存用户范围元数据；Capability 按主体预览 Permission，不消费 `allow_once`；Tool Usage 只执行 Security/Confirmation 前置判断并记录 `not_executed`。MCP 未连接，Plugin 未安装，Skill/Tool 没有执行器，任何模块都不接收真实执行输入或调用第三方服务。

设备模块保持以下边界：Device Registry 只保存用户范围的设备类型、品牌、名称、启停和能力声明；主体授权复用 `resource_type=device` 的 Permission。操作准备固定经过 Permission、Security 和 Confirmation，并记录 `device_changed`、AuditLog 和 `not_executed` 操作日志。注册或启用不表示设备已连接，设备状态固定未观测；统一 Adapter 端口和小米、美的、Apple、Android 描述均为 `not_implemented`，不接收控制参数、不加载 SDK、不调用厂商 API。

生活管理模块保持以下边界：财务、预算、月历、身体与本地记忆属于 User Space，并按用户/主体复合隔离；全部使用 `life_data` Permission 与 Security Policy。金额、统计和趋势仅作本地确定性计算；AI 建议只保存显式输入；提醒只保存规则；本地记忆只有用户标记后进入独立 Context 投影。模块不支付、不连接银行/穿戴设备、不调用模型、不输出诊断，也不自动并入通用 Context。

主动交互模块保持以下边界：Wake、主动提示、Token Budget/Usage 与后台策略按用户/主体隔离。`voice` 和应用授权不代表麦克风或系统权限；Event 触发只形成未投递准备记录。需要确认的提示和 Token 超额通过 `proactive_interaction` Permission/Security，并固定不执行。Token 使用仅保存显式上报计量，不验证供应商账单；后台策略不启动调度器或驻留进程。

数据导出模块保持以下边界：Export Schema 固定登记十二类数据范围及版本/类型；导出记录只保存用户/主体范围、选择、计数、完整性结果和安全审计引用，不复制正文。创建记录先检查复合归属、必需字段和数据库外键；真正进入导出准备必须使用精确 `data_export:export` Permission，并由 Security Policy 和高风险逐次 Confirmation 审核。`ready` 只表示未来生成资格，不创建文件、不上传外部存储、不连接机器人或其他载体；迁移契约准备不执行迁移，未来真实执行必须重新安全检查。
