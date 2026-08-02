# 平台业务模块边界

未来业务模块按规划逐步建立，初始优先级如下：

1. 账号与身份
2. 智能体主体与归属
3. 会话、消息和版本
4. 软件事件
5. 权限、确认、撤销和审计
6. 上下文装配与连续性协调
7. 模型与扩展能力管理
8. 设备、AI 私域、生活模块和数据治理

模块负责业务规则和用例，不直接依赖具体数据库、模型服务、continuity-engine 或设备 SDK。当前实现账号/User Space/主体、数据隔离、设定/私域、对话/Context、事件、模型/扩展/设备、生活管理、主动交互与 Token 控制、数据导出准备、Permission/Security/Confirmation/AuditLog。Dashboard 只聚合已有事实；Security 只返回安全资格并标记外部执行未发生；Permission Checker 不执行资源操作，Router 也不调用真实模型。

`continuity-integration/` 是第一轮 test-only 机器契约基础。Vio V1 提供三份固定 Schema 的封闭 registry、严格验证、RFC 8785/hash、固定 SubjectBinding fixture 和未发送逻辑请求构造；Vio V2 提供精确 success/error envelope 验证、不可覆盖结果账本编排、独立投影版本/回执/指针、revision 隔离及三阶段恢复。它复用首次持久化请求，不注册 HTTP 路由；默认 transport 明确不可调用，测试 transport 必须显式标记 test-only。该模块不调用 continuity-engine，不创建引擎 Event/StateMutation，不写入 legacy Vio SubjectState，也不把投影回灌 Engine。

User Space 是账号的一对一数据根，只保存开发期身份状态、空间状态和当前助手指针。当前助手是用户导航选择，不是 Subject 状态；切换不会修改 Global Settings、Private Space、SubjectState、对话、事件或生活数据。数据隔离模块只接收预定义资源类型和不透明 ID，先通过仓储复合过滤验证归属，再对私域、设备和生活资源调用既有 Permission/Security 链。它不读取资源正文、不接受任意 SQL/表名，也不执行资源操作。

AI 私域模块只保存调用方显式提交的五类 JSON 记录，Space 与内容版本使用专用表；每次更新追加不可变版本。空 Space 创建用于生成精确 Permission 的资源 ID，其后读取、写入、管理、Context 投影和导出准备都必须经过 Permission → Security Policy → Confirmation。该模块不实现意识、自主行为、内容开放判断、模型生成、机器人或外部连接。

助手全局设定模块把 Subject 中的名称/头像与一对一长期设定投影为单一 API 对象；扩展设定包括人格、表达方式、关系、长期要求和禁止事项。它不保存情绪、未解决事件或动态状态，不会写入 SubjectState。会话模块保持用户—主体—会话复合归属。Message 是稳定逻辑消息，使用会话内 `sequenceNumber` 排序并以 `currentVersionId` 指向当前内容；MessageVersion 只追加 `original`、`edited` 或 `regenerated` 版本，不原地覆盖。ConversationSummary 只追加摘要版本并保存强来源引用，SubjectState 只追加 `state_update` 并由独立当前指针选择。Context 按固定顺序只读装配，不持久化结果、不生成提示词、不调用 AI 或 continuity-engine。当前不实现 Memory、分支、删除或重置。

安全模块保持以下边界：Permission 决定基础权限，Security Policy 与 Security 只能收紧；用户偏好不能降低平台 `high` / `critical` 逐次确认底线。`session_allow` 只形成明确确认后的精确、短时开发期授权，不是认证。SensitiveData 只定义分类元数据并提供只读查询；Confirmation 不代表执行；AuditLog 与 Event 分离且只记录最小字段。

模型配置模块保持以下边界：APIProvider 保存服务来源、Base URL、接口格式与启停元数据；Model 保存名称、类型、能力、费用说明与测试状态；Model Routing Rule 按用户和任务保存默认/备用模型；Router 只执行确定性本地选择。测试状态当前固定为 `not_tested`，API Key 只通过未配置的安全存储端口描述状态，任何模块都不保存密钥或调用供应商。

扩展能力模块保持以下边界：Registry 只保存用户范围元数据；Capability 按主体预览 Permission，不消费 `allow_once`；Tool Usage 只执行 Security/Confirmation 前置判断并记录 `not_executed`。MCP 未连接，Plugin 未安装，Skill/Tool 没有执行器，任何模块都不接收真实执行输入或调用第三方服务。

设备模块保持以下边界：Device Registry 只保存用户范围的设备类型、品牌、名称、启停和能力声明；主体授权复用 `resource_type=device` 的 Permission。操作准备固定经过 Permission、Security 和 Confirmation，并记录 `device_changed`、AuditLog 和 `not_executed` 操作日志。注册或启用不表示设备已连接，设备状态固定未观测；统一 Adapter 端口和小米、美的、Apple、Android 描述均为 `not_implemented`，不接收控制参数、不加载 SDK、不调用厂商 API。

生活管理模块保持以下边界：财务、预算、月历、身体与本地记忆属于 User Space，并按用户/主体复合隔离；全部使用 `life_data` Permission 与 Security Policy。金额、统计和趋势仅作本地确定性计算；AI 建议只保存显式输入；提醒只保存规则；本地记忆只有用户标记后进入独立 Context 投影。模块不支付、不连接银行/穿戴设备、不调用模型、不输出诊断，也不自动并入通用 Context。

主动交互模块保持以下边界：Wake、主动提示、Token Budget/Usage 与后台策略按用户/主体隔离。`voice` 和应用授权不代表麦克风或系统权限；Event 触发只形成未投递准备记录。需要确认的提示和 Token 超额通过 `proactive_interaction` Permission/Security，并固定不执行。Token 使用仅保存显式上报计量，不验证供应商账单；后台策略不启动调度器或驻留进程。

数据导出模块保持以下边界：Export Schema 固定登记十二类数据范围及版本/类型；导出记录只保存用户/主体范围、选择、计数、完整性结果和安全审计引用，不复制正文。创建记录先检查复合归属、必需字段和数据库外键；真正进入导出准备必须使用精确 `data_export:export` Permission，并由 Security Policy 和高风险逐次 Confirmation 审核。`ready` 只表示未来生成资格，不创建文件、不上传外部存储、不连接机器人或其他载体；迁移契约准备不执行迁移，未来真实执行必须重新安全检查。
