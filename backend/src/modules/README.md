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

模块负责业务规则和用例，不直接依赖具体数据库、模型服务、continuity-engine 或设备 SDK。当前实现账号/主体、设定/私域、对话/Context、事件、模型/扩展/设备、生活管理、Permission/Security/Confirmation/AuditLog。Dashboard 只聚合已有事实；Security 只返回安全资格并标记外部执行未发生；Permission Checker 不执行资源操作，Router 也不调用真实模型。

AI 私域模块只保存调用方显式提交的五类 JSON 记录，Space 与内容版本使用专用表；每次更新追加不可变版本。空 Space 创建用于生成精确 Permission 的资源 ID，其后读取、写入、管理、Context 投影和导出准备都必须经过 Permission → Security Policy → Confirmation。该模块不实现意识、自主行为、内容开放判断、模型生成、机器人或外部连接。

助手全局设定模块把 Subject 中的名称/头像与一对一长期设定投影为单一 API 对象；扩展设定包括人格、表达方式、关系、长期要求和禁止事项。它不保存情绪、未解决事件或动态状态，不会写入 SubjectState。会话模块保持用户—主体—会话复合归属。Message 是稳定逻辑消息，使用会话内 `sequenceNumber` 排序并以 `currentVersionId` 指向当前内容；MessageVersion 只追加 `original`、`edited` 或 `regenerated` 版本，不原地覆盖。ConversationSummary 只追加摘要版本并保存强来源引用，SubjectState 只追加 `state_update` 并由独立当前指针选择。Context 按固定顺序只读装配，不持久化结果、不生成提示词、不调用 AI 或 continuity-engine。当前不实现 Memory、分支、删除或重置。

安全模块保持以下边界：Permission 决定基础权限，Security Policy 与 Security 只能收紧；用户偏好不能降低平台 `high` / `critical` 逐次确认底线。`session_allow` 只形成明确确认后的精确、短时开发期授权，不是认证。SensitiveData 只定义分类元数据并提供只读查询；Confirmation 不代表执行；AuditLog 与 Event 分离且只记录最小字段。

模型配置模块保持以下边界：APIProvider 保存服务来源、Base URL、接口格式与启停元数据；Model 保存名称、类型、能力、费用说明与测试状态；Model Routing Rule 按用户和任务保存默认/备用模型；Router 只执行确定性本地选择。测试状态当前固定为 `not_tested`，API Key 只通过未配置的安全存储端口描述状态，任何模块都不保存密钥或调用供应商。

扩展能力模块保持以下边界：Registry 只保存用户范围元数据；Capability 按主体预览 Permission，不消费 `allow_once`；Tool Usage 只执行 Security/Confirmation 前置判断并记录 `not_executed`。MCP 未连接，Plugin 未安装，Skill/Tool 没有执行器，任何模块都不接收真实执行输入或调用第三方服务。

设备模块保持以下边界：Device Registry 只保存用户范围的设备类型、品牌、名称、启停和能力声明；主体授权复用 `resource_type=device` 的 Permission。操作准备固定经过 Permission、Security 和 Confirmation，并记录 `device_changed`、AuditLog 和 `not_executed` 操作日志。注册或启用不表示设备已连接，设备状态固定未观测；统一 Adapter 端口和小米、美的、Apple、Android 描述均为 `not_implemented`，不接收控制参数、不加载 SDK、不调用厂商 API。

生活管理模块保持以下边界：财务、预算、月历、身体与本地记忆属于 User Space，并按用户/主体复合隔离；全部使用 `life_data` Permission 与 Security Policy。金额、统计和趋势仅作本地确定性计算；AI 建议只保存显式输入；提醒只保存规则；本地记忆只有用户标记后进入独立 Context 投影。模块不支付、不连接银行/穿戴设备、不调用模型、不输出诊断，也不自动并入通用 Context。
