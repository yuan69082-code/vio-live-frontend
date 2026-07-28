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

`007` 只建立摘要、状态和只读 Context 所需的持久化基础，不生成摘要、不实现 Memory、不调用模型或连续性引擎。`006` 仍只建立当前线性消息版本和最小事件记录结构，不实现分支、删除或重置。已执行的 `001` 至 `006` 不得为适配本阶段而原地修改。
