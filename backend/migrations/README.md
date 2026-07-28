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

`015` 不重写既有业务表，当前助手只是 User Space 指针，不改变任何 Subject 数据归属。`014` 使用整数最小货币单位保存金额，生活表不含支付/银行/设备引用；重建安全与 Event 父表只为加入 `life_data` 和两类事件。`013` 的内容表触发器禁止更新或删除历史版本，Event 重建不复制私域正文。因 SQLite 需要重建已被其他表引用的父表，相关迁移首行使用 `-- vio-migration: foreign-keys-off` 显式声明；迁移运行器只对这种声明临时关闭外键，并在记录和提交前强制执行 `PRAGMA foreign_key_check`，任何悬空引用都会整体回滚。已执行迁移不得为适配新阶段而原地修改。
