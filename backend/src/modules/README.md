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

模块负责业务规则和用例，不直接依赖具体数据库、模型服务、continuity-engine 或设备 SDK。当前实现 User、Subject、Dashboard、Conversation、Message、MessageVersion、ConversationSummary、SubjectState、Context、Event、APIProvider、Model、Model Router、Permission、Security、SensitiveData 分类、Confirmation 与 AuditLog。Dashboard 只聚合已有 User/Subject 状态，不猜测连续性或设备数据；Security 只返回安全资格并标记未执行；Permission Checker 不执行资源操作，Router 也不调用真实模型。

会话模块保持用户—主体—会话复合归属。Message 是稳定逻辑消息，使用会话内 `sequenceNumber` 排序并以 `currentVersionId` 指向当前内容；MessageVersion 只追加 `original`、`edited` 或 `regenerated` 版本，不原地覆盖。ConversationSummary 只追加摘要版本并保存强来源引用，SubjectState 只追加 `state_update` 并由独立当前指针选择。Context 按固定顺序只读装配，不持久化结果、不生成提示词、不调用 AI 或 continuity-engine。当前不实现 Memory、分支、删除或重置。

安全模块保持以下边界：Permission 决定基础权限，Security 只能收紧；SensitiveData 只定义分类元数据并提供只读查询；Confirmation 不代表执行；AuditLog 与 Event 分离且只记录最小字段。
