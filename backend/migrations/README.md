# 数据库迁移

迁移文件按数字前缀顺序执行，并记录到开发数据库的 `schema_migrations` 表。

- 已执行迁移不得原地修改。
- 新结构通过新的迁移文件演进。
- 当前 SQL 仅服务于开发期 SQLite；迁移正式数据库时需要新的适配与迁移计划。
- 迁移文件不得包含密钥、用户数据或环境专属值。
- `005_create_security_system.sql` 只保存确认作用域和最小审计字段；不得增加任意敏感 payload 或秘密原文列。
- `006_create_conversations_messages_and_events.sql` 新建 `conversations`、`messages` 与 `message_versions`，以复合外键约束用户、主体、会话和消息归属；会话内 `sequence_number` 唯一，`current_version_id` 指向当前不可变版本，数据库触发器禁止直接更新或删除历史版本。
- `006` 通过新表复制并替换 `events`，保留既有事件记录和原索引语义，同时把 Event 类型从五类扩展为九类：新增 `conversation_created`、`message_created`、`message_updated`、`message_regenerated`。
- `007_create_context_summaries_and_subject_states.sql` 新建不可变 ConversationSummary、摘要来源、SubjectState、当前状态指针和未解决 Event 引用；复合外键约束摘要/状态来源必须属于相同用户与主体，MessageVersion 摘要来源还必须属于相同 Conversation。
- `008_create_assistant_global_settings.sql` 新建与 Subject 一对一的助手全局设定表，并为既有主体回填空白默认设定；名称与头像继续保存在 `subjects` 作为唯一身份来源，扩展设定只保存人格、表达、关系、长期要求和禁止事项。
- `009_expand_model_routing_configuration.sql` 为 Provider 增加接口格式和测试状态，为 Model 增加费用说明和测试状态；扩展能力标签，并建立按用户/任务唯一、带默认与可选备用模型的 `model_routing_rules`。
- `010_create_capability_registries.sql` 新建用户范围的 Tool/MCP/Skill/Plugin 注册表，以及复合绑定用户、主体、Tool 与 AuditLog 的使用记录；数据库约束当前执行状态只能为 `not_executed`。
- `011_create_device_adaptation_foundation.sql` 新建设备注册、设备能力和设备操作日志表；复合外键保证用户、主体、设备、审计和事件归属一致，数据库约束设备调用状态只能为 `not_executed`。
- `012_create_custom_security_policies.sql` 新建用户 Security Policy、安全偏好和短时策略会话授权，扩展 Confirmation 的策略/原因/选择字段，并把 Permission 生命周期与确认请求纳入 Event、把策略治理纳入 AuditLog。
- `013_create_ai_private_spaces.sql` 新建用户/助手范围的 AI Private Space 与不可变内容版本表；五类正文与 User Space 分开保存，并把 Event 扩展为十五类，新增私域创建、记忆变化和状态变化事件。
- `014_create_life_management_foundation.sql` 新建财务记录/预算、四类月历、身体指标/目标和本地记忆表；扩展 `life_data` Permission/Security 范围，并把 Event 扩展为十八类。
- `015_create_user_spaces_and_data_isolation.sql` 新建每用户唯一的 User Space，保存开发期身份模式和当前助手复合外键；为既有用户回填空间，并稳定选择最早活动 Subject 作为当前助手。
- `016_create_proactive_interaction_and_token_controls.sql` 新建 Wake、主动提示规则/准备记录、Token Budget/Usage 和助手后台策略；扩展 `proactive_interaction` Permission/Security 范围，并把 Event 扩展为二十四类。
- `017_create_data_export_and_migration_foundation.sql` 新建版本化 Export Schema、十二类范围定义与导出记录；扩展 `data_export` Permission/Security 范围，导出结果固定不生成载荷/文件、不连接外部存储、不执行迁移。
- `018_create_continuity_v1_contract_foundation.sql` 新建不可变的第一轮固定 SubjectBinding fixture 和未发送逻辑请求输入记录；复合外键绑定 Vio 用户、助手、会话、MessageVersion 与来源 Event，保存 request/hash/revision/引用/规范化请求并支持跨重启读取。该迁移不保存引擎 operation、response 或 stateProjection。
- `019_create_continuity_v2_result_and_projection_ledger.sql` 新建第一轮不可覆盖结果账本、独立 Engine 投影版本/请求回执/当前指针和非敏感隔离事件表。结果按 V1 requestId 一对一外键保存；投影按 `(subject_id, current_revision)` 唯一，非空 engineUpdateId 唯一；触发器保护结果正文、投影版本、回执和指针身份字段。head 只能由匹配的 changed=false revision 0 回执初始化，之后只允许匹配 changed=true 回执逐一推进。

`018` 和 `019` 只服务于 v1.1 第一轮固定测试 Profile，不提供 Binding CRUD、生产 transport 或 Engine 网络连接；`019` 不复用 legacy/unverified `state_updates`。`017` 只建立导出/迁移准备元数据，不复制用户正文或秘密，不生成可下载包；`016` 的语音与后台字段只保存平台配置，运行状态固定未连接/未执行。因 SQLite 需要重建已被其他表引用的父表，相关迁移首行使用 `-- vio-migration: foreign-keys-off` 显式声明；迁移运行器只对这种声明临时关闭外键，并在记录和提交前强制执行 `PRAGMA foreign_key_check`，任何悬空引用都会整体回滚。已执行迁移不得为适配新阶段而原地修改。
