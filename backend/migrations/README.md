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
- `018_create_continuity_v1_contract_foundation.sql` 新建不可变的第一轮固定 SubjectBinding fixture 和规范化逻辑请求输入记录；复合外键绑定 Vio 用户、助手、会话、MessageVersion 与来源 Event，保存 request/hash/revision/引用/规范化请求并支持 V3 交付和跨重启读取。该迁移不保存引擎 operation、response 或 stateProjection。
- `019_create_continuity_v2_result_and_projection_ledger.sql` 新建第一轮不可覆盖结果账本、独立 Engine 投影版本/请求回执/当前指针和非敏感隔离事件表。结果按 V1 requestId 一对一外键保存；投影按 `(subject_id, current_revision)` 唯一，非空 engineUpdateId 唯一；触发器保护结果正文、投影版本、回执和指针身份字段。head 只能由匹配的 changed=false revision 0 回执初始化，之后只允许匹配 changed=true 回执逐一推进。
- `020_create_continuity_http_delivery_outbox.sql` 新建正式本机 HTTP 交付 outbox 与逐次 attempt 账本，固定 `pending`、`in_flight`、`outcome_unknown`、`result_received`、`completed`、`quarantined` 六态，并保存 requestId/hash、首次 operationId、脱敏 transport 结果和恢复原因。该迁移不复制 V1 原请求或 V2 Engine 结果，不保存 token、消息正文或 Engine 私密状态。
- `021_create_continuity_capability_execution_ledger.sql` 新建 CapabilityRequest inbox、决策、0..N execution/usage/result、Result outbox/attempt 与 incident 账本；每个 attempt 不可变，最多一个成功，真实 Provider usage 独立累计，secretRef 只保存在凭据绑定中。
- `022_create_continuity_conversation_turn_ledger.sql` 新建公共轮次协调账本，关联唯一幂等键、固定 Vio/Engine 主体、用户 Message/Version/Event、预分配与已持久化 V1 request、Capability/operation/response 和唯一主体 Message。部分唯一索引只允许同一 Engine subject 存在一个活动轮次；触发器保护轮次身份、历史关联和终态，首次请求前、V1 后、V2 后及主体 Message 后的崩溃均可从持久化事实恢复。
- `023_create_personal_identity_and_access.sql` 在不认领旧开发数据的前提下新增唯一个人所有者安装、限时初始化邀请、口令验证与包装库密钥、HttpOnly 会话、访问审计、幂等操作、助手/资料版本、加密凭据、连接检查及账户级确认事实；同时允许个人身份使用可空 assistant scope，并为 Provider/Model 增加配置版本。旧用户继续保持 `development_unverified`，不会自动成为所有者。迁移 fresh、`001–022` upgrade、失败整体回滚和外键检查由 R2 专项覆盖。该迁移不承担删除治理；政策确认后的账户整体删除通过新 `024` 演进，不重写 `001–023`。
- `024_create_governed_personal_deletion.sql` 新增 `personal_deletion_tasks`、`personal_deletion_access`、`personal_deletion_tombstones`、`personal_deletion_attempts` 与 `personal_managed_copies`。任务保存实际所属行键/依赖清单、确认后的 7 天撤销截止、执行阶段、脱敏失败原因、实际删除后 14 天受管备份期限与 30 天最小凭据期限；专用访问不依赖已删除账户的普通会话，也不授予业务访问。
- `024` 只在“执行中的任务 + 所有者 + 重新核对的准确数据行”限定上下文内允许治理删除。普通 UPDATE 保护不变，普通历史 DELETE 仍默认拒绝；不是关闭全局保护触发器或外键。删除事务按已有循环引用处理并检查外键，未知/变化范围失败回滚。新建库、`001–023` 升级、失败回滚及普通历史保护由对应 R2 专项验收，实际结果在本次日志汇总，不把未运行项计为通过。
- 删除结果分别记录在线逻辑行、SQLite/WAL 检查点、受管文件与备份；用户自存副本不管理，不承诺介质物理擦除。无登记受管副本如实计为 0；只实现 R2 删除治理所需登记/清理/恢复拦截，不新增 R11 完整备份产品。精确接口和期限以 [R2 个人合同](../docs/R2_PERSONAL_CONTRACT.md) 为准。
- `025_create_standalone_chat_ledger.sql` 新增 R1 每助手唯一默认会话映射、独立聊天 turn、每 turn 唯一 logical execution、不可变超预算批准、0..N Provider attempts、每 attempt usage/cost、唯一成功结果及恢复操作幂等账本，共八类持久化事实。用户输入正文仍锁定在原始 MessageVersion，R1 账本只保存其 hash 与复合身份引用；成功候选先以规范化结果和可信 Provider usage 落盘，再发布为唯一 `subject` MessageVersion。部分唯一索引限制同一默认会话只能有一个活动 turn；`outcome_unknown` 禁止新 attempt，只有所有既有 attempt 均明确 `not_sent` 或 `retryable` 才能在重新门控和显式 retry 后增加 attempt。全部事实受复合所有权外键、规定初态、状态转换及治理删除触发器保护；过期或撤销会话不能创建轮次或预算批准。
- `025` 的 fresh、`001–024` upgrade、故障整体回滚、外键、不可变事实、活动 turn、Provider retry/unknown 和治理删除范围由 R1 迁移专项覆盖；最终专项与全量数量在本轮统一验证后登记。本迁移不复用 `continuity_conversation_turns`，不修改 `001–024`，也不创建或读取任何 Engine 数据。request/security/budget hash 由正式 service 从完整已校验输入计算，数据库保护其格式、关联与不可变性；Provider result 的 canonical JSON、result hash 与 response content hash 由 repository 在插入前独立重算。

`018`—`022` 分层服务机器契约、正式交付、Capability 和公共轮次：每层只引用前一层稳定 ID，不复制或覆盖它的 canonical 事实，也不复用 legacy/unverified `state_updates`。`022` 当前仍只支持固定本地 Profile，不提供 Binding CRUD；R2 的 `023` 不把该历史 Profile 迁移或认领为个人身份。因 SQLite 需要重建已被其他表引用的父表，相关迁移首行使用 `-- vio-migration: foreign-keys-off` 显式声明；迁移运行器只对这种声明临时关闭外键，并在记录和提交前强制执行 `PRAGMA foreign_key_check`，任何悬空引用都会整体回滚。已执行迁移不得为适配新阶段而原地修改。
