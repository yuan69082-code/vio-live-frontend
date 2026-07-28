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

模块负责业务规则和用例，不直接依赖具体数据库、模型服务、continuity-engine 或设备 SDK。当前实现 User、Subject、Assistant Global Settings、Dashboard、Conversation、Message、MessageVersion、ConversationSummary、SubjectState、Context、Event、APIProvider、Model、Model Routing Rule、Model Router、Permission、Security、SensitiveData 分类、Confirmation 与 AuditLog。Dashboard 只聚合已有 User/Subject 状态，不猜测连续性或设备数据；Security 只返回安全资格并标记未执行；Permission Checker 不执行资源操作，Router 也不调用真实模型。

助手全局设定模块把 Subject 中的名称/头像与一对一长期设定投影为单一 API 对象；扩展设定包括人格、表达方式、关系、长期要求和禁止事项。它不保存情绪、未解决事件或动态状态，不会写入 SubjectState。会话模块保持用户—主体—会话复合归属。Message 是稳定逻辑消息，使用会话内 `sequenceNumber` 排序并以 `currentVersionId` 指向当前内容；MessageVersion 只追加 `original`、`edited` 或 `regenerated` 版本，不原地覆盖。ConversationSummary 只追加摘要版本并保存强来源引用，SubjectState 只追加 `state_update` 并由独立当前指针选择。Context 按固定顺序只读装配，不持久化结果、不生成提示词、不调用 AI 或 continuity-engine。当前不实现 Memory、分支、删除或重置。

安全模块保持以下边界：Permission 决定基础权限，Security 只能收紧；SensitiveData 只定义分类元数据并提供只读查询；Confirmation 不代表执行；AuditLog 与 Event 分离且只记录最小字段。

模型配置模块保持以下边界：APIProvider 保存服务来源、Base URL、接口格式与启停元数据；Model 保存名称、类型、能力、费用说明与测试状态；Model Routing Rule 按用户和任务保存默认/备用模型；Router 只执行确定性本地选择。测试状态当前固定为 `not_tested`，API Key 只通过未配置的安全存储端口描述状态，任何模块都不保存密钥或调用供应商。
