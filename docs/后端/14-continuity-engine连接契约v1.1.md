# 14｜Continuity Integration Contract v1.1

## 1. 文档状态

- 契约名称：Continuity Integration Contract v1.1
- 日期：2026-07-30
- 状态：**已由 Continuity Engine 正式接受；Vio 与 Continuity Engine 双方工程档案同步以及 Continuity Engine 定点文档修正均已完成，双方最终只读复核已经通过。正式结论为“双方档案一致，可以制定第一轮最小连接施工提示词”。当前准备共同制定该提示词，但尚未共同制定；第一轮代码施工、共享测试和运行时连接仍未开始**
- 历史版本：[Continuity Integration Contract v1](14-continuity-engine连接契约v1.md)
- 引擎审核依据：Engine Integration Contract Response v1
- 最终接受依据：Engine Contract Final Read-Only Short Confirmation v1（归档见 [14c-Engine-Contract-Final-Read-Only-Short-Confirmation-v1.md](14c-Engine-Contract-Final-Read-Only-Short-Confirmation-v1.md)）
- 适用范围：Vio Live 平台后端与独立 continuity-engine 的未来服务间连接
- 非适用范围：连接代码、数据库迁移、真实模型、真实 MCP/Tool/设备、生产认证、生产部署和前端直连

v1.1 保留 v1 作为历史设计记录，并在发生冲突时以本文件为本轮评审依据。本文件仍是设计，不是已实现 API，也不表示生产连接已经完成。

本文使用四种实现状态：

| 标记 | 含义 |
| --- | --- |
| **Vio 已实现** | 已在 Vio 源码、迁移和测试中找到依据，但不一定符合最终连接形态 |
| **Vio 拟新增/调整** | Vio 后端后续需要实现或收口；本轮未写代码、未建表 |
| **引擎现有基础** | 已在 continuity-engine 源码和测试中存在的内部能力 |
| **待引擎新增/共同确认** | 引擎尚无生产连接能力，或双方仍需共同决定 |

任何“拟新增”“建议”“候选”“待确认”都不得被写成当前可调用接口。

## 2. 第二轮结论

Vio 原则上接受 Engine Integration Contract Response v1 提出的十二项修改方向，并作以下处理：

| # | 修改项 | Vio 处理 |
| --- | --- | --- |
| 1 | Thinking 与模型能力请求时序 | **接受** |
| 2 | PlatformObservation 与内部 Event 结构隔离 | **接受** |
| 3 | 只提交 expectedEngineRevision，不提交状态快照覆盖 | **接受** |
| 4 | 状态投影单向同步、幂等、乱序隔离和对账 | **接受** |
| 5 | 版本化 SubjectBinding 与安全重绑定 | **调整后接受** |
| 6 | 异步 CapabilityRequest / CapabilityResult 状态机 | **调整后接受** |
| 7 | 回复与状态投影部分成功的 Outbox 与恢复 | **调整后接受** |
| 8 | 正式错误、重试、取消和进度语义 | **调整后接受** |
| 9 | Vio 与引擎双层权限/资源门控 | **接受** |
| 10 | 私密、秘密、派生、撤销和删除规则 | **调整后接受** |
| 11 | 历史 state_update 标为 legacy/unverified | **接受** |
| 12 | 当前调试接口不是生产连接接口 | **接受** |

第 5—8 项接受架构方向，但生产参数、传输形态和产品展示时点仍需共同决定。第 10 项不接受“AI Private Space 属于用户控制的数据区域”这一单一空间定义，改为第 12 节的三层数据空间。

历史上，Continuity Engine 的第二次审核曾给出“暂不接受 v1.1”的结论；Vio 随后完成第 19 节及相关对齐文字的纯文档校准。Continuity Engine 已在最终只读短确认中确认上述现行差异闭合，未发现会使双方采取两种第一轮实现的规则，也未发现新的架构问题，并正式接受本契约。该接受只表示契约与第一轮机器语义闭合，不表示任何运行时能力、共享测试或实际连接已经完成。

## 3. 不可改变的权威和系统边界

### 3.1 SubjectState 唯一权威

1. continuity-engine 是 SubjectState 的唯一权威来源。
2. 只有引擎可以创建内部 Event 和 StateMutation。
3. PlatformObservation 的摄取回执或独立来源经历记录不是内部 Event，不拥有状态写权限，也不能推进 SubjectState revision。
4. 只有引擎内部合法且获批的 UPDATE_STATE 才能创建 StateMutation，并使内部 Event 通过 Evolution 正式改变 SubjectState。
5. Vio 不得创建、提交、推断或修改 StateMutation。
6. Vio 不得使用本地状态投影、ConversationSummary、聊天历史、Global Settings、User Private Data、AI Private Space 或 Shared Space 覆盖、重建或替代 SubjectState。
7. Vio 只保存引擎状态的投影、缓存和必要审计材料；状态不一致时以引擎为准。
8. AI Private Space 和 Shared Space 都不是 SubjectState，也不是状态权威的替代来源。

### 3.2 Context 唯一组织方

1. Vio Context Service 只提供经过身份、归属、Permission、Security Policy、用途和范围筛选的平台事实。
2. continuity-engine 读取自己的权威 SubjectState、内部 Memory、Wake/Perception 结果和学习历史，组织唯一的最终认知 Context。
3. Vio 不生成最终 Prompt，不另组一套最终认知 Context，不把模型供应商格式作为连接输入。
4. ConversationSummary 只是可追溯的平台压缩事实，不是主体记忆或认知结论。
5. 三层数据空间均按各自规则提供最小事实；任何空间都不能整库进入最终 Context。

### 3.3 平台、引擎与外部能力

| 领域 | Vio 后端 | continuity-engine |
| --- | --- | --- |
| 用户/助手/会话 | 权威保存身份、归属、会话、消息和版本 | 只使用已验证绑定和必要来源引用 |
| 平台事实 | 保存并按用途、授权和分类筛选 | 判断事实的认知意义 |
| Vio Event | 保存平台变化；转换为 PlatformObservation | 不直接接收为内部 Event |
| SubjectState | 保存只读投影、缓存和审计 | 唯一权威并通过 Evolution 演化 |
| 最终 Context | 只提供 PlatformFactPackage | 唯一组织最终认知 Context |
| 外部模型/Tool/MCP/设备 | 用户授权、安全、确认、供应商路由、现实执行和账本 | 决定是否请求能力，并吸收执行事实 |
| 主体表达 | 保存和向前端发布经过引擎确认的表达 | 生成主体表达结果；模型原始输出不能绕过引擎 |
| 数据存储 | 独立 Vio 数据库 | 独立引擎存储 |
| 前端 | 唯一产品入口 | 不接受 Vio 前端直连 |

模型、Tool、MCP 或设备的结果只能作为带来源的执行事实返回引擎，不能直接修改 SubjectState。ActionPlan 只是计划，不能被标记为已经发生的现实结果。引擎不可用时，Vio 不得用平台模型生成替代回复并冒充同一主体。

## 4. 当前真实能力与冲突

### 4.1 Vio 已有连接基础

- User、User Space、Subject、Assistant Global Settings、Conversation、Message、MessageVersion。
- 不可变 ConversationSummary、MessageVersion/Event 来源引用和跨窗口摘要读取。
- Vio Event 创建、按用户/主体/时间/类型/状态查询；当前没有消费者、投递账本或回执。
- 当前 SubjectState 不可变版本、当前指针和来源引用。
- 只读 Context Service，可读取设定、当前 Vio 状态记录、未解决 Event、近期消息和跨窗口摘要；执行状态明确为未调用模型、外部 API 和引擎。
- AI Private Space 独立表、不可变版本和 Permission → Security Policy → Confirmation 安全链。
- Permission、Security Policy、Confirmation、AuditLog。
- 模型目录/路由与 Token Budget/Usage 元数据；当前没有真实模型调用或可信供应商计量。
- 用户、助手、设备、生活和事件数据的复合归属查询基础。

### 4.2 必须收口的现状

1. 当前 POST /api/v1/users/:userId/subjects/:subjectId/state-updates 允许开发调用方提交状态并推进 Vio 当前指针。所有既有记录必须视为 legacy/unverified，不得自动初始化、覆盖或回灌引擎 SubjectState。
2. 当前 Context Service 会读取 Vio 当前状态记录。连接后该记录只能作为历史/投影材料，不能作为引擎权威状态输入。
3. v1 的 PlatformObservation 建议包含 stateMutationAllowed=false。v1.1 取消该字段：安全保证必须来自结构中完全不存在状态写字段，并拒绝未声明字段。
4. 当前 AI Private Space API 允许用户侧开发调用方直接创建和修改内容。这只能作为存储与版本基础，尚不符合 v1.1 的 AI 主体内容控制权，不能用于第一轮最小连接测试。
5. 当前 Token Usage 是显式 API 输入，固定标记平台未调用、未计费，不是可信供应商账本。
6. 当前没有 SubjectBinding、连接请求账本、Outbox、PlatformObservation、CapabilityRequest/Result、引擎投影接收器或生产服务鉴权。

### 4.3 引擎已有基础与缺口

引擎已有 SubjectState、revision、expected_revision、内部 Event → StateMutation → Evolution、StateUpdateRecord、Wake、Memory、只读 Perception、ThinkSession/ThinkingProvider seam、Action、PermissionContext、ResourceManager 和 JSON 重启恢复基础。

引擎当前没有正式 PlatformObservation、SubjectBinding、可恢复的跨服务 ThinkSession、CapabilityRequest/Result、生产 Integration Adapter、Outbox/operation 查询、状态投影发布、生产多租户、生产认证或生产存储。现有 APIService 是进程内门面，本地 HTTP 与 UserInteractionService 是调试入口，均不是本契约的生产接口。

## 5. 身份和 SubjectBinding

### 5.1 标识权威

| 标识 | 权威方 | 规则 |
| --- | --- | --- |
| userId | Vio | 用户稳定 ID；Vio 验证身份和所有权 |
| assistantId | Vio | 平台助手 ID；不与 subjectId 共用命名空间 |
| subjectId | 引擎 | 引擎主体 ID；用于权威 SubjectState |
| conversationId | Vio | 平台会话 ID；引擎只作来源/关联 |
| eventId | Vio | Vio Event ID；不是引擎 Event ID |
| requestId | Vio 编排层 | 一次逻辑交互的全链路幂等键 |
| bindingId | 绑定协议 | 一条显式绑定的稳定 ID |
| bindingVersion | 绑定协议 | 绑定并发和失效检查版本 |
| observationId | Vio 编排层 | PlatformObservation 的稳定幂等 ID |
| operationId | 引擎连接层 | 一次可查询的引擎操作 ID |
| capabilityRequestId | 引擎 | 一次外部能力请求 ID |
| responseId | 引擎 | 一次主体表达结果 ID |
| engineUpdateId | 引擎 | 一次合法状态演化或投影更新 ID |

### 5.2 SubjectBinding（拟新增/待共同确认）

本节描述第一轮之外的通用生产绑定方向；第一轮的创建方、字段、fixture、装载顺序和统一拒绝语义已由第 19.3 节固定，不适用本节中的待决策项。

最小逻辑结构：

    {
      "bindingId": "opaque-binding-id",
      "userId": "vio-user-id",
      "assistantId": "vio-assistant-id",
      "subjectId": "engine-subject-id",
      "bindingVersion": 1,
      "status": "active",
      "createdAt": "RFC3339-UTC",
      "effectiveAt": "RFC3339-UTC",
      "replacedBindingId": null
    }

规则：

1. 即使第一轮字符串值相同，也必须存在显式绑定，不得按字符串相等隐式绑定。
2. 每个请求必须验证 userId、assistantId、subjectId、bindingId/bindingVersion 和有效状态。
3. 错用户、错助手、错 subjectId、旧 bindingVersion 或已失效绑定必须拒绝。
4. 重绑定需要所有权验证、用户确认、并发检查、历史审计和旧绑定失效。
5. 重绑定不得自动合并、复制、覆盖、重置或删除两个 SubjectState。
6. 解绑、暂停、归档、删除主体和迁移主体是不同操作。
7. 第一轮之外的 subjectId 生成、跨 assistant 迁移、确认级别和主体生命周期仍需共同决定。

第一轮最小测试只使用一个预先固定、不可重绑定的显式 SubjectBinding。

## 6. PlatformObservation 与 Vio Event 隔离

### 6.1 PlatformObservation（拟新增/待引擎新增）

PlatformObservation 是外部平台事实，不是引擎内部 Perception Observation，也不是引擎 Event。

第一轮不再使用本节早期的通用 facts 结构。第一轮唯一规范由第 19 节“第一轮最小连接一致性 Profile”定义；其中 identity 必须包含 bindingId，message_created 只能携带 MessageVersion 引用，正文只能位于唯一 message_version fact。

长期新增其他 Observation 类型时，每个类型必须建立独立、版本化、严格字段白名单的 schema，不得退回任意 facts 容器。所有版本共同遵守：

1. ContinuityInteractionRequest.observations 是唯一承载位置，PlatformFactPackage 只能按 observationId 引用。
2. schema 在所有对象层级使用 additionalProperties=false 或等价机制拒绝未声明字段。
3. schema 中不得出现 impact_scope、mutations、mutation、StateMutation、field_path、operation、before_state、after_state、state_patch、state_snapshot 或其他状态写字段。
4. 不保留 stateMutationAllowed 字段；即使值为 false 也不是结构安全保证。
5. Vio Event 不得直接反序列化、继承、转换或复用为引擎内部 Event。
6. observationId 对同一来源和映射版本稳定；同 ID 不同规范化内容返回幂等冲突。
7. 禁止字段或未知字段在第一轮统一返回 SCHEMA_INVALID，且不得进入领域模型。

### 6.2 首批事件映射原则

- 消息事件只传 Message/Version ID、发送者类型和时间；正文通过本轮消息事实提供。
- 权限事件只传资源类型、动作和最终状态；不传秘密、策略指纹或确认正文。
- 生活事件默认只传模块、记录 ID 和变化类型；金额、身体、生理、亲密和备注需 User Private Data 单独授权。
- 私域事件只传 Space/Content/Version ID 和变化类型；不传 AI Private Space 正文。
- 设备事件只传平台登记/准备事实；不得把 not_connected 或 not_executed 冒充现实结果。

精确映射表、schema registry 和引擎摄取端口均未实现。

## 7. PlatformFactPackage

### 7.1 结构目标

Vio 只提供严格、最小、带来源、带分类、带授权期限的平台事实包。每项至少包含：

- factId / factType / schemaVersion
- userId、assistantId、subjectId、必要时 conversationId
- sourceRef、sourceVersion、contentHash
- occurredAt / createdAt
- classification
- purpose、scope、authorizationRef、expiresAt
- 最小正文或受控引用

### 7.2 可以包含

1. 本轮用户 MessageVersion 和必要正文。
2. Assistant Global Settings 的必要字段和版本；它是用户配置，不是 SubjectState。
3. 当前会话有限近期消息。
4. 有来源的 ConversationSummary。
5. 顶层 observations 中 PlatformObservation 的 observationId 引用；PlatformFactPackage 不得嵌入或复制 PlatformObservation。
6. 用户明确允许参与 Context 的 User Private Data 最小投影。
7. 通过 AI 主体身份绑定和专用接口批准的 AI Private Space 最小投影；第一轮排除。
8. 根据 Shared Space 版本化规则允许的共同事实；第一轮排除。
9. Vio 权限、安全、确认、能力可用性和用户 Token 决策的最小结果引用。

### 7.3 明确不包含

- SubjectState 快照、Vio 当前状态投影或任何状态覆盖输入。
- User Private Data、AI Private Space、Shared Space、生活数据或聊天历史的整库内容。
- API Key、访问 Token、设备凭据、供应商密钥、密码、验证码、认证头、数据库连接信息。
- 未经本次 purpose/scope/expiry/authorization 允许的数据。
- Vio 推断的情绪、人格、关系、意图、认知结论或 StateMutation。
- 最终 Prompt、最终认知 Context、模型供应商请求格式或模型完整思维链。
- 已删除、已撤销、已过期、错用户、错助手、错主体或错会话的数据。

## 8. 长期正式连接请求（拟议）

ContinuityInteractionRequest 为第一轮之外的长期逻辑契约，尚无生产端点。第一轮不得直接使用本节的宽泛示例，只能使用第 19.1 节的精确结构与校验规则：

    {
      "contractVersion": "continuity-integration/v1.1",
      "schemaVersion": "continuity-interaction-request/v1",
      "requestId": "opaque-request-id",
      "requestType": "user_message",
      "identity": {
        "userId": "vio-user-id",
        "assistantId": "vio-assistant-id",
        "subjectId": "engine-subject-id",
        "bindingId": "opaque-binding-id",
        "bindingVersion": 1
      },
      "conversation": {
        "conversationId": "vio-conversation-id",
        "messageId": "vio-message-id",
        "messageVersionId": "vio-message-version-id"
      },
      "expectedEngineRevision": 12,
      "platformFactPackage": {},
      "observations": [],
      "constraints": {
        "purpose": "reply_to_user_message",
        "vioTokenDecisionRef": "opaque-decision-id"
      },
      "createdAt": "RFC3339-UTC"
    }

规则：

1. Vio 只提交 expectedEngineRevision，不提交 SubjectState 快照、delta、patch 或覆盖命令。
2. expectedEngineRevision 来自最后一次已确认的引擎投影，仅用于并发检查。
3. 引擎必须从自己的权威仓储读取 SubjectState。
4. 相同 requestId 和相同规范化载荷返回已有 operation/结果；相同 ID 不同载荷返回 IDEMPOTENCY_KEY_REUSED。
5. 当 expectedEngineRevision != currentEngineRevision 时统一返回 REVISION_CONFLICT / reassemble；只有完全相等才进入领域处理。绑定验证通过前不得返回 currentEngineRevision。冲突后 Vio 重新装配事实并重新评估，不得自动重放旧请求。

## 9. 修正后的完整连接流程

本节是长期生产连接目标。第一轮根据第 19.4 节，将下列第 7—10 步固定替换为 continuity-engine 进程内的 DeterministicThinkingProvider、MemoryRetriever 和 ReplyComposer，不产生跨服务 CapabilityRequest/CapabilityResult。

1. Vio 验证身份、SubjectBinding、权限和数据范围。
2. Vio 生成严格、最小、带来源的 PlatformObservation。
3. Vio 只附带 expectedEngineRevision，不提交状态覆盖输入。
4. 引擎读取自己的权威 SubjectState。
5. 引擎完成 Wake、Memory、Perception。
6. 引擎创建 ThinkSession。
7. 如需模型或其他外部能力，引擎生成 CapabilityRequest，并将会话置为等待状态。
8. Vio 完成用户权限、安全、确认、供应商预算等现实层检查后执行外部能力。
9. Vio 返回 CapabilityResult，其中只包含执行事实、来源、状态、用量和错误。
10. 引擎验证结果并恢复 ThinkSession，继续生成 ThinkingResult。
11. Action 判断是否需要行动或提出状态变化。
12. 只有合法且被批准的 UPDATE_STATE 才能由引擎创建内部 Event/StateMutation，并进入 Evolution。
13. 引擎生成主体表达结果以及必要的状态投影信息。
14. Vio 幂等保存回复、投影与展示状态，再向前端发布。
15. 部分成功时通过 Outbox、operationId、engineUpdateId、查询和对账恢复，不得重复调用模型或重复制造主体经历。

补充约束：

- 模型原始输出不能绕过第 10—13 步直接展示。
- CapabilityResult 不能携带 StateMutation。
- 无状态变化时，引擎明确返回 revision 未变化。
- ActionPlan 只有在现实执行结果被 Vio 确认并返回引擎后，才能作为执行事实继续被理解；计划本身不是结果。

## 10. CapabilityRequest / CapabilityResult

### 10.1 请求状态机（拟议）

    PROPOSED
      → AUTHORIZING
      → AWAITING_CONFIRMATION
      → APPROVED
      → EXECUTING
      → SUCCEEDED
         | FAILED_RETRYABLE
         | FAILED_TERMINAL
         | CANCELLED
         | EXPIRED
         | UNKNOWN

不是每个请求都会经过所有中间状态。状态迁移必须持久化并按 capabilityRequestId 幂等。

### 10.2 CapabilityRequest 最小语义

- capabilityRequestId、operationId、requestId。
- subjectId、bindingId、bindingVersion。
- originatingSessionType / originatingSessionId。
- capabilityType、任务类型和输入 schema 版本。
- 只含必要事实的输入或受控引用。
- 引擎内部 Permission/Resource 判断引用。
- 风险、deadline、估算资源、幂等键。

### 10.3 CapabilityResult 最小语义

- capabilityRequestId、operationId、requestId。
- status、capabilityType、provider/tool/device 来源。
- 类型化输出或受控内容引用、contentHash。
- startedAt、completedAt。
- actualUsage、vioLedgerEntryId（真实调用阶段）。
- errorCode、retryClass、auditRef。
- executionFact=true 的现实执行事实；不得包含 StateMutation、内部 Event 或 SubjectState patch。

超时且执行状态为 UNKNOWN 时，Vio 必须先按 operationId/capabilityRequestId 查询现实执行状态。未证明“没有执行”前，不得重试非幂等操作。取消只在不可逆提交或现实执行前有效，取消本身也要幂等。

第一轮的 DeterministicThinkingProvider、MemoryRetriever 和 ReplyComposer 全部位于 continuity-engine 进程内，作为 test double 使用；第一轮不产生跨服务 CapabilityRequest/CapabilityResult。CapabilityRequest/CapabilityResult 留待后续独立协议测试。生产状态机方向不变，但不得用于解释第一轮 Profile。

## 11. 引擎结果、投影与部分成功恢复

### 11.1 逻辑结果

以下是第一轮之外的长期逻辑结果方向；第一轮唯一成功 envelope、最小 snapshot 和 hash 语义以第 19.6 节为准：

    {
      "contractVersion": "continuity-integration/v1.1",
      "requestId": "opaque-request-id",
      "operationId": "opaque-operation-id",
      "status": "completed",
      "identity": {
        "subjectId": "engine-subject-id",
        "bindingId": "opaque-binding-id",
        "bindingVersion": 1
      },
      "response": {
        "responseId": "engine-response-id",
        "role": "subject",
        "content": "engine-approved subject expression"
      },
      "stateProjection": {
        "schemaVersion": "engine-subject-state-projection/v1",
        "engineUpdateId": "engine-update-id-or-null",
        "previousRevision": 12,
        "currentRevision": 13,
        "changed": true,
        "contentHash": "opaque-hash",
        "snapshot": {}
      },
      "consumedObservationIds": [],
      "completedAt": "RFC3339-UTC"
    }

第一轮 snapshot 的精确字段由第 19 节固定，且不使用 delta。生产投影的扩展字段、公开范围和签名仍待引擎确认。Vio 不得从该结构反向生成引擎写命令。

### 11.2 状态投影单向规则

1. 数据流只能从引擎到 Vio。
2. 第一轮投影内容唯一键是 subjectId + currentRevision；request 与投影的关联唯一键是 requestId；engineUpdateId 仅在非 null 时执行唯一约束。
3. 多个 changed=false 请求可以通过各自 requestId 关联同一 revision 的同一份投影；同一 subjectId + currentRevision 不得生成内容、contentHash 或 stateHash 不同的第二份投影。重复的非 null engineUpdateId 返回已有应用结果，不重复写入。
4. 只有 previousRevision 与 Vio 最后确认投影连续时才推进当前投影指针。
5. 旧 revision、跳号、错 subject/binding 或 hash 不一致进入 quarantine/reconciling，不覆盖当前投影。
6. 对账只能通过引擎投影查询/更新查询修复；Vio 本地投影不得回灌。
7. 第一轮无状态变化时 currentRevision 等于 previousRevision，changed=false，engineUpdateId=null；有状态变化时 currentRevision=previousRevision+1，engineUpdateId=StateUpdateRecord.update_id。
8. 引擎不可用时可以只读展示最后确认投影并标记 stale；不得推进状态或 revision。

### 11.3 本地原子与 Outbox

不要求跨两个数据库的分布式强事务，采用：

- 引擎本地原子保存 interaction/operation 结果、合法状态更新、engineUpdateId 和待发布 Outbox。
- Vio 本地原子保存主体 MessageVersion、投影应用结果、展示状态和 Vio Outbox。
- Vio 只有在回复记录和对应投影处理结果已持久化后才发布给前端。
- 回复已保存但投影待对账，或投影已保存但展示未发布时，使用同一 ID 恢复，不重新调用模型、不重新创建内部 Event、不制造第二次主体经历。
- 双方提供按 operationId、requestId、engineUpdateId 查询和重放已提交结果的能力。
- 部分成功状态至少区分 response_persisted、projection_sync_pending、ready_to_publish、published、reconciling 和 failed_terminal；精确枚举待共同确认。

## 12. 三层数据空间

“Private Space”不得再作为三个域的统称。User Private Data、AI Private Space、Shared Space 具有不同的内容权威、知情权、读取权、修改权、拒绝权、撤销权和删除规则。

### 12.1 User Private Data

定义：

- 数据属于用户，包括用户私密资料、财务、健康、生理、亲密、身份和用户本地私密记录。
- AI 读取必须有明确 purpose、scope、有效期和用户授权。
- 用户可以查看、更正、撤销授权和请求删除。
- 撤销后立即停止未来读取，并按适用数据政策清理或隔离缓存和派生数据。
- Vio 是平台存储、权限、安全和合规执行方；引擎只接收最小授权投影。
- API Key、访问 Token、设备凭据、供应商密钥和平台秘密永不向引擎传输。

### 12.2 AI Private Space

定义：

- 在产品语义上，AI Private Space 属于绑定的 AI 主体自身，是主体的私域内容控制域，不是用户资料夹；这里的“内容控制权”只表示产品内创建、编辑、展示和使用由绑定主体的 Continuity Engine 流程决定，不主张 AI 法律人格、财产权或法律数据控制者地位。
- 可保存由引擎明确写入行动决定或专用写入请求发起的私人笔记、认知整理、非权威偏好观察、内部工作记录和与连续主体有关的私域内容。
- 用户不能通过普通 Vio 状态接口直接编辑、篡改或以自身意愿覆盖该内容。
- Vio 负责安全存储、加密、访问控制、备份、保留和合规执行；技术托管权不等于用户拥有内容编辑权。
- 读写必须通过专用、版本化、与 SubjectBinding 绑定的接口。普通状态、Context、用户数据或现有开发私域接口不能绕过该边界。
- Vio 的 Permission、Security Policy 和 Confirmation 可以保护访问与平台操作，但不能把一次用户批准解释为用户获得 AI 私域内容所有权或直接编辑权。
- 不得保存 API Key、Token、设备凭据、供应商密钥、完整模型思维链、禁止保存的秘密或未经验证的高敏感推断。
- Vio可以验证、拒绝、加密、版本化和存储，但不能替 AI 主体创作、补写、改写或推断私人内容。
- AI Private Space 不是 SubjectState、PersonalityTrait 权威库、Memory 管理层或 Learning 证据放大器。如果内容可能影响状态，仍须经过 Memory/Perception → Thinking → Action → 内部 Event/StateMutation → Evolution。
- 同一内容谱系的复制、缓存、重复读取或版本不得被计为多份独立 Learning 证据。
- AI未来可以在普通产品交互中按规则拒绝展示私人内容，但不能阻止合法删除、安全处置、法定访问、司法/监管要求或平台必须执行的合规清除。
- 用户能否查看、在何种条件下查看、AI拒绝展示的产品流程仍需共同决定；删除用户账号、解绑 assistant、暂停主体、归档主体和永久删除主体必须是不同操作与审计状态。

当前 Vio 的 assistant_private_spaces 和不可变版本可以作为未来存储/版本基础，但现有用户侧直接写入及管理语义不符合本节，必须在后续开发前重新设计。第一轮最小连接测试不读写该空间。

### 12.3 Shared Space

定义：

- 用于双方共同可见的纪念日、约定、关系记录、共同计划和经双方确认的内容。
- 每项内容必须记录来源、创建者、版本、修改历史、可见范围、授权/确认依据和删除规则。
- 用户与 AI 的修改权、是否需要双方确认、冲突解决和单方撤销效果由版本化规则决定。
- Shared Space 不是 SubjectState，不能直接覆盖引擎状态。
- Shared Space 内容如影响主体状态，仍只能作为有来源事实进入引擎的合法演化流程。

### 12.4 权利与控制矩阵

| 维度 | User Private Data | AI Private Space | Shared Space |
| --- | --- | --- | --- |
| 归属/产品语义内容权威 | 用户 | AI 主体 | 双方按版本化规则 |
| 知情/通知 | 用户知晓用途、范围、接收方和期限 | AI 主体知晓读写；用户可知目录/内容的范围 **待共同决定** | 双方按版本化规则知晓创建、修改和共享 |
| Vio 角色 | 安全托管与用户数据权利执行 | 安全托管、访问控制、备份与合规 | 版本、来源、可见和规则执行 |
| 引擎读取 | purpose/scope/expiry/用户授权后最小读取 | 主体绑定和专用接口下读取 | 按共同规则和当前目的读取 |
| 用户读取 | 可查看 | **待共同决定** | 按版本化可见规则 |
| 用户修改 | 可更正自己的数据 | 不得直接编辑或覆盖 | **待共同决定** |
| AI 修改 | 无直接写权；只能提出受控建议 | 通过引擎合法规则和专用接口写入 | **待共同决定** |
| 拒绝权 | 用户可拒绝 AI 读取 | AI 是否可拒绝展示 **待共同决定** | 双方拒绝/确认规则 **待共同决定** |
| 撤销 | 用户可撤销未来读取授权 | 用户提供的来源授权撤销如何影响派生内容 **待共同决定** | 单方撤销效果 **待共同决定** |
| 删除 | 用户可请求删除，按政策执行 | 主体删除、合规删除、用户请求边界 **待共同决定** | 双方删除权和历史保留 **待共同决定** |

本契约表达产品语义内容权威，不替代未来法律、隐私和合规评审对数据控制者、数据主体权利及法定保留义务的决定。

## 13. ConversationSummary

1. Summary 作为平台事实输入，不是 SubjectState，也不自动成为引擎 Memory。
2. 至少携带 summaryId、summaryVersion、conversationId、covered MessageVersion/Event 引用、createdAt、classification、authorizationRef、contentHash 和 summaryText。
3. Vio 现有 Summary 已具备不可变版本、来源引用和跨窗口读取基础。
4. 引擎只能按受控 Source Query API 回查 Vio 原始来源，不能读取 Vio 数据库。
5. 摘要更正必须产生新版本和 replacedBy/替换关系；现有实现尚无正式更正传播。
6. 删除或授权撤销后，Vio 向引擎发送来源不可用/撤销事实；引擎如何处理已形成的合法内部影响需共同决定。
7. 第一轮最小连接测试可以不发送 Summary。

## 14. 权限、安全、资源与 Token 双层门控

外部能力只有同时满足两层门控才可执行：

    引擎：主体是否愿意、是否适合、内部 Permission/Resource 是否允许
      AND
    Vio：用户是否授权、Security/Confirmation 是否通过、供应商预算与现实能力是否允许

任意一方拒绝即不执行。双方只交换最小判断结果和引用，不复制密钥，不自动修改对方的 Permission、Security Policy、ResourceManager 或账本。

Token 分层：

| 层 | 权威 | 作用 |
| --- | --- | --- |
| 用户日/会话预算 | Vio | 请求进入与真实调用前的用户限制 |
| 供应商 Token/费用 | Vio | 真实供应商回执和费用权威账本 |
| 主体内部认知资源 | 引擎 ResourceManager | 思考深度、Wake、Memory 和自主运行约束 |

真实调用前，引擎可以预留内部估算，Vio 返回 actualUsage 和 vioLedgerEntryId。requestId、capabilityRequestId、engineUsageId 和账本 ID 关联去重。Vio 费用不得再次从引擎内部预算重复扣减，引擎内部预算也不得被当成用户付款余额。

第一轮使用确定性替身，不进行真实 Token 计费和付款。

## 15. 幂等、防重复与 revision 冲突

| 风险 | 规则 |
| --- | --- |
| 重复请求 | 同一逻辑交互固定 requestId；相同 ID/相同 hash 返回已有结果，不同 hash 冲突 |
| 重复 Event/Observation | eventId 与 observationId 各自稳定；引擎保存摄取回执，不重复消费 |
| 重复模型/能力调用 | capabilityRequestId 和执行幂等键稳定；UNKNOWN 先查询，不盲重试 |
| 重复回复 | responseId 唯一；Vio 对 requestId + responseId 幂等保存 |
| 重复状态更新 | engineUpdateId 与 revision 双重去重 |
| 乱序投影 | 隔离并查询引擎，不推进当前指针 |
| revision 冲突 | 完整 Binding 验证通过后，expectedEngineRevision != currentEngineRevision 一律返回 REVISION_CONFLICT / reassemble 和当前 revision；只有相等才进入领域处理 |
| 重复发布 | Vio Outbox 使用稳定发布 ID；已发布结果只返回现有状态 |

幂等记录必须持久化，不能只放在进程内缓存。

## 16. 错误、重试、取消和进度

### 16.1 正式错误分类（逻辑分类）

以下是第一轮之外的生产候选分类。第一轮只能返回第 19.7 节固定的四类错误。任何连接模式都不得以不同 code、message 或字段区分错主体、错绑定、资源不存在或旧绑定版本；对外统一使用 SUBJECT_BINDING_MISMATCH，避免泄露主体存在性。

直接终止：

- CONTRACT_VERSION_UNSUPPORTED
- SCHEMA_INVALID
- AUTHENTICATION_FAILED
- AUTHORIZATION_DENIED
- SUBJECT_BINDING_MISMATCH
- IDEMPOTENCY_KEY_REUSED
- FORBIDDEN_SECRET_FIELD
- INVALID_STATE_MUTATION
- DATA_INTEGRITY_ERROR

重新取得状态后重新评估：

- REVISION_CONFLICT

等待或延后：

- CONFIRMATION_REQUIRED
- RESOURCE_DEFERRED
- RATE_LIMITED

可在同一 ID 下有界重试：

- 明确未执行的临时网络错误
- SERVICE_UNAVAILABLE
- FAILED_RETRYABLE

状态未知：

- EXECUTION_STATUS_UNKNOWN：先查询 operation/capability 状态，未确认未执行前不得重试。

### 16.2 operation 语义

长任务以 operationId 查询状态和进度。候选状态为 accepted、processing、waiting_capability、awaiting_confirmation、completed、failed_retryable、failed_terminal、cancelled、expired、unknown。精确枚举、HTTP 映射、进度粒度、保留期限、超时、退避和重试次数仍需共同决定。

取消只在不可逆状态提交、主体表达正式完成或外部现实执行前有效。取消不得撤销已经合法发生的引擎状态；是否允许取消已经完成但尚未发布的表达需共同决定。

### 16.3 引擎不可用

Vio 可以：

- 幂等保存用户消息、Vio Event、待投递 PlatformObservation、请求/Outbox 状态。
- 展示最后确认状态投影并明确 stale。
- 返回连续性服务暂不可用、待处理、失败或可取消状态。

Vio 不可以：

- 生成替代回复冒充同一主体。
- 推进 SubjectState 或 revision。
- 把 Vio Event 转成内部 Event/StateMutation。
- 使用投影、摘要或聊天历史另组最终 Context 调模型。
- 自动写 AI Private Space 的主体内容。

## 17. 接口版本、鉴权、审计和隔离

### 17.1 版本与传输

- contractVersion、请求/结果 schema、PlatformObservation、SubjectBinding、CapabilityRequest/Result 和状态投影分别版本化。
- 破坏性变更提升主版本；可选字段新增需要能力协商。
- UTF-8 JSON、RFC 3339 UTC 和私有网络 HTTPS 是建议方向，正式 URL、部署拓扑和同步/异步传输仍需共同决定。
- 当前 APIService、本地 HTTP、UserInteractionService 和 Vio 的 x-vio-user-id 均不是生产连接接口或凭据。
- 生产连接应使用独立 Integration Adapter、服务身份、传输加密、短期凭证、重放保护和 schema 校验；mTLS/签名令牌组合待安全评审。

### 17.2 审计

Vio 至少记录 requestId、operationId、绑定版本、输入来源 ID、权限/安全/确认/Token 决定、投递次数、capabilityRequestId、responseId、engineUpdateId/revision、最终状态和错误分类。引擎至少能按 requestId、operationId、subjectId、observationId、内部 Event 和 revision 追踪处理。

审计不复制完整私密正文、最终认知 Context、模型完整思维链、Prompt、API Key、Token、设备凭据或供应商秘密。

### 17.3 多用户、多助手

1. Vio 每次访问携带 userId + assistantId，必要时再带 conversationId/resourceId。
2. 引擎每次访问携带 subjectId 和有效 SubjectBinding。
3. 一个请求只属于一个用户、一个助手、一个 subject。
4. 切换当前助手只改变 Vio User Space 指针，不改变绑定或合并数据。
5. 错范围统一不可见，不通过错误差异泄露资源存在性。
6. 两边数据库独立，禁止共享状态表、跨库写入、共享 ORM 或用数据库复制代替协议。
7. 生产多租户、保留、删除、导出和灾难恢复仍需分别实现和对账。

## 18. 接口实现状态

### 18.1 已存在的 Vio 接口

- User/Subject/Conversation/Message/MessageVersion。
- ConversationSummary 保存、来源查询和跨窗口读取。
- Event 创建与查询。
- 当前 SubjectState 查询/历史；写入口是 legacy 能力，不符合目标架构。
- 当前 Context 只读接口；只能作为事实来源。
- 当前 AI Private Space 安全存储/版本接口；其用户直接写语义不符合 v1.1 AI 私域定义。
- Permission、Security Policy、Confirmation、AuditLog、Token Budget/Usage、Model Router。

以上接口均未调用 continuity-engine。

### 18.2 Vio 拟新增或调整

- SubjectBinding 存储、版本和安全重绑定。
- continuity request/operation/outbox/idempotency 账本。
- PlatformFactPackage 与严格 PlatformObservation 构造器。
- Event 映射注册、投递回执和去重。
- 引擎私有服务客户端、鉴权、超时、熔断和查询恢复。
- 回复/投影幂等保存、乱序隔离、对账和发布 Outbox。
- CapabilityRequest 执行编排、Vio 双层门控结果和 CapabilityResult。
- 可信供应商 Token/费用账本。
- User Private Data 授权/撤销传播。
- 与主体绑定的 AI Private Space 专用读写接口。
- Shared Space 数据与版本化共同控制规则。
- 冻结/关闭旧 state_update 公共写入口，并将历史标记为 legacy/unverified。

### 18.3 continuity-engine 拟新增依赖

- 正式 ContinuityIntegrationAdapter。
- PlatformObservation 摄取和严格验证。
- Subject registry / SubjectBinding 校验。
- 可恢复 ThinkSession 和 CapabilityRequest/Result。
- operation 状态查询、取消、幂等和错误 envelope。
- interaction 结果、Outbox、responseId、engineUpdateId 查询和重放。
- 状态投影 schema、快照/delta、更新查询和对账。
- ConversationSummary fact 与来源查询端口。
- 三层数据空间专用输入/提案边界。
- 生产多租户、认证、存储、生命周期、保留、删除和导出。

### 18.4 尚未确认的引擎接口

- 正式 URL、同步快速路径、异步回调/轮询和流式边界。
- 第一轮之外的未来生产 Integration Adapter 精确请求/响应 schema。
- SubjectBinding 创建权和 subjectId 生成规则。
- 投影是快照、delta 还是两者并存，以及公开字段。
- operation/capability 状态、超时、取消和保留期限。
- Summary 原文回查、撤销和更正传播。
- AI Private Space/Shared Space 的专用接口和产品决策。
- PresentationIntent/DeliveryIntent 和主动 Wake 的未来映射。
- 供应商实际用量证明与 ResourceManager 对账。

## 19. 第一轮最小连接一致性 Profile

### 19.0 状态、优先级与适用范围

- Profile 状态：**已通过 Continuity Engine 最终只读短确认；第一轮机器契约语义闭合。Engine E1/E2/E3 与 Vio V1 单边基础已实现，双方尚未连接或运行共享测试**。
- 适用范围：第一轮“单一全新主体、无真实外部能力”的最小连接测试。
- 规范优先级：本节对第一轮具有强制优先级；本文其他长期设计如与本节冲突，第一轮以本节为准。
- 实现状态：Engine 提交 `c732f35` 已实现引擎侧三份 schema、ContractTestAdapter、确定性闭环和结果账本；Vio V1 已实现请求侧三份严格本地 schema/validator、RFC 8785/hash、固定 Binding 测试装载、未发送请求构造与输入账本。本节的跨系统调用、Vio operation/response/stateProjection 接收及共享测试仍未实现。

引擎第二次审核的历史结论是“暂不接受 v1.1，存在阻塞第一轮最小连接测试的契约问题”。该结论是当时的真实审核记录；本节完成校准后，Continuity Engine 已通过最终只读短确认正式接受 v1.1。此后 Engine E1/E2/E3 与 Vio V1 分别完成单边基础，但接受和单边实现都不等于双方连接、共享测试或生产集成已经完成。

### 19.1 PlatformObservation 唯一位置与结构

以下为 Engine Contract Second Review Response v1 第 9.1 节的权威修订文本：

> `ContinuityInteractionRequest.observations` 是 PlatformObservation 的唯一承载位置。`platformFactPackage` 不得嵌入 PlatformObservation，只能按 observationId 建立引用。每个 PlatformObservation.identity 必须包含 userId、assistantId、subjectId、bindingId 和 bindingVersion。
>
> 第一轮 message_created Observation 只携带事件身份、来源、时间和 MessageVersion 引用；消息正文只出现在 platformFactPackage 的唯一 `message_version` fact 中，不得在两个位置重复。精确 schema 必须拒绝未知字段。
>
> 出现 mutation、impact_scope、field_path、operation、state_patch、state_snapshot 或其他状态写字段时返回 `SCHEMA_INVALID`，不得进入领域模型。

#### 19.1.1 第一轮唯一逻辑请求

第 19.1.1、19.1.2、19.1.3 节共同构成完整的第一轮 schema registry。registry 只注册下列三个明确且唯一的绝对 URN `$id`，`$ref` 必须按完整 URN 精确匹配，不允许使用文件相对路径、网络回退或双方各自的隐式别名：

| Schema | registry `$id` |
| --- | --- |
| ContinuityInteractionRequest | `urn:vio-live:continuity-integration:schema:request:first-round-v1` |
| message_created PlatformObservation | `urn:vio-live:continuity-integration:schema:platform-observation:message-created:first-round-v1` |
| message_version fact | `urn:vio-live:continuity-integration:schema:platform-fact:message-version:first-round-v1` |

三份 Schema 均使用 JSON Schema Draft 2020-12。验证器必须实际启用 `format: date-time` 断言；不得把 format 当作注释。所有第一轮时间字段同时受 UTC 正则约束，只接受 RFC 3339 UTC 且以大写 `Z` 结尾的字符串，不接受未注明时区或非 UTC offset。所有对象都以 `additionalProperties: false` 拒绝未知字段。

第一轮顶层 ContinuityInteractionRequest 正式 Schema：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:vio-live:continuity-integration:schema:request:first-round-v1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "contractVersion",
    "schemaVersion",
    "requestId",
    "requestHash",
    "requestType",
    "identity",
    "conversation",
    "expectedEngineRevision",
    "platformFactPackage",
    "observations",
    "constraints",
    "createdAt"
  ],
  "properties": {
    "contractVersion": {
      "const": "continuity-integration/v1.1"
    },
    "schemaVersion": {
      "const": "continuity-interaction-request/first-round-v1"
    },
    "requestId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128
    },
    "requestHash": {
      "type": "string",
      "pattern": "^sha256:[0-9a-f]{64}$"
    },
    "requestType": {
      "const": "user_message"
    },
    "identity": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "userId",
        "assistantId",
        "subjectId",
        "bindingId",
        "bindingVersion"
      ],
      "properties": {
        "userId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "assistantId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "subjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "bindingId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "bindingVersion": {
          "const": 1
        }
      }
    },
    "conversation": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "conversationId",
        "messageId",
        "messageVersionId"
      ],
      "properties": {
        "conversationId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "messageId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "messageVersionId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        }
      }
    },
    "expectedEngineRevision": {
      "type": "integer",
      "minimum": 0
    },
    "platformFactPackage": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schemaVersion",
        "facts",
        "observationRefs"
      ],
      "properties": {
        "schemaVersion": {
          "const": "vio-platform-fact-package/first-round-v1"
        },
        "facts": {
          "type": "array",
          "minItems": 1,
          "maxItems": 1,
          "items": {
            "$ref": "urn:vio-live:continuity-integration:schema:platform-fact:message-version:first-round-v1"
          }
        },
        "observationRefs": {
          "type": "array",
          "minItems": 1,
          "maxItems": 1,
          "uniqueItems": true,
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          }
        }
      }
    },
    "observations": {
      "type": "array",
      "minItems": 1,
      "maxItems": 1,
      "items": {
        "$ref": "urn:vio-live:continuity-integration:schema:platform-observation:message-created:first-round-v1"
      }
    },
    "constraints": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "purpose"
      ],
      "properties": {
        "purpose": {
          "const": "reply_to_user_message"
        }
      }
    },
    "createdAt": {
      "type": "string",
      "format": "date-time",
      "pattern": "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\\.[0-9]+)?Z$"
    }
  }
}
```

以下请求是正式有效的一致性向量，不是结构占位示例：

```json
{
  "contractVersion": "continuity-integration/v1.1",
  "schemaVersion": "continuity-interaction-request/first-round-v1",
  "requestId": "request-001",
  "requestHash": "sha256:ec07ad9ba66d1ffcdfa9177cd61bec1b880ad6ee99a6ec6449e732c1b86002d0",
  "requestType": "user_message",
  "identity": {
    "userId": "user-001",
    "assistantId": "assistant-001",
    "subjectId": "subject-001",
    "bindingId": "binding-001",
    "bindingVersion": 1
  },
  "conversation": {
    "conversationId": "conversation-001",
    "messageId": "message-001",
    "messageVersionId": "message-version-001"
  },
  "expectedEngineRevision": 0,
  "platformFactPackage": {
    "schemaVersion": "vio-platform-fact-package/first-round-v1",
    "facts": [
      {
        "schemaVersion": "vio-platform-fact/message-version-first-round-v1",
        "factId": "fact-001",
        "factType": "message_version",
        "identity": {
          "userId": "user-001",
          "assistantId": "assistant-001",
          "subjectId": "subject-001",
          "bindingId": "binding-001",
          "bindingVersion": 1
        },
        "conversationId": "conversation-001",
        "messageId": "message-001",
        "messageVersionId": "message-version-001",
        "senderType": "user",
        "content": "hello",
        "contentHash": "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        "createdAt": "2026-07-30T00:00:00Z"
      }
    ],
    "observationRefs": [
      "observation-001"
    ]
  },
  "observations": [
    {
      "schemaVersion": "vio-platform-observation/message-created-first-round-v1",
      "observationId": "observation-001",
      "sourceEventId": "event-001",
      "observationType": "message_created",
      "identity": {
        "userId": "user-001",
        "assistantId": "assistant-001",
        "subjectId": "subject-001",
        "bindingId": "binding-001",
        "bindingVersion": 1
      },
      "occurredAt": "2026-07-30T00:00:00Z",
      "observedAt": "2026-07-30T00:00:00Z",
      "messageVersionRef": {
        "conversationId": "conversation-001",
        "messageId": "message-001",
        "messageVersionId": "message-version-001"
      }
    }
  ],
  "constraints": {
    "purpose": "reply_to_user_message"
  },
  "createdAt": "2026-07-30T00:00:00Z"
}
```

该向量的 `requestHash` 由最终逻辑请求排除 `requestHash` 字段本身后，使用 RFC 8785 规范化、UTF-8 编码和 SHA-256 实际计算得到；其余所有允许的顶层逻辑请求字段均参与 hash。双方编写连接代码前，必须对该向量得到完全相同的 RFC 8785 规范化 UTF-8 字节和 `requestHash`。未通过该向量前不得开始第一轮连接施工。

第一轮 observations 必须且只能包含一个 message_created PlatformObservation；platformFactPackage.facts 必须且只能包含一个与其引用一致的 message_version fact。Schema 验证通过后还必须执行第 19.1.3 节的全部交叉字段相等约束，交叉约束失败返回 SCHEMA_INVALID / never。

#### 19.1.2 message_created PlatformObservation 精确 JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:vio-live:continuity-integration:schema:platform-observation:message-created:first-round-v1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schemaVersion",
    "observationId",
    "sourceEventId",
    "observationType",
    "identity",
    "occurredAt",
    "observedAt",
    "messageVersionRef"
  ],
  "properties": {
    "schemaVersion": {
      "const": "vio-platform-observation/message-created-first-round-v1"
    },
    "observationId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128
    },
    "sourceEventId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128
    },
    "observationType": {
      "const": "message_created"
    },
    "identity": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "userId",
        "assistantId",
        "subjectId",
        "bindingId",
        "bindingVersion"
      ],
      "properties": {
        "userId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "assistantId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "subjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "bindingId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "bindingVersion": {
          "const": 1
        }
      }
    },
    "occurredAt": {
      "type": "string",
      "format": "date-time",
      "pattern": "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\\.[0-9]+)?Z$"
    },
    "observedAt": {
      "type": "string",
      "format": "date-time",
      "pattern": "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\\.[0-9]+)?Z$"
    },
    "messageVersionRef": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "conversationId",
        "messageId",
        "messageVersionId"
      ],
      "properties": {
        "conversationId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "messageId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "messageVersionId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        }
      }
    }
  }
}
```

第一轮 Observation 不包含消息正文、summary、任意 facts 对象、classification、authorization 正文或状态字段。sourceEventId 只引用 Vio Event；它不是引擎 Event ID。

#### 19.1.3 唯一 message_version fact 精确 JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:vio-live:continuity-integration:schema:platform-fact:message-version:first-round-v1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schemaVersion",
    "factId",
    "factType",
    "identity",
    "conversationId",
    "messageId",
    "messageVersionId",
    "senderType",
    "content",
    "contentHash",
    "createdAt"
  ],
  "properties": {
    "schemaVersion": {
      "const": "vio-platform-fact/message-version-first-round-v1"
    },
    "factId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128
    },
    "factType": {
      "const": "message_version"
    },
    "identity": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "userId",
        "assistantId",
        "subjectId",
        "bindingId",
        "bindingVersion"
      ],
      "properties": {
        "userId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "assistantId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "subjectId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "bindingId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "bindingVersion": {
          "const": 1
        }
      }
    },
    "conversationId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128
    },
    "messageId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128
    },
    "messageVersionId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128
    },
    "senderType": {
      "const": "user"
    },
    "content": {
      "type": "string",
      "minLength": 1,
      "maxLength": 32768
    },
    "contentHash": {
      "type": "string",
      "pattern": "^sha256:[0-9a-f]{64}$"
    },
    "createdAt": {
      "type": "string",
      "format": "date-time",
      "pattern": "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\\.[0-9]+)?Z$"
    }
  }
}
```

约束：

1. Observation.messageVersionRef、请求 conversation 和 message_version fact 的 conversationId、messageId、messageVersionId 必须逐字段相同。
2. Observation.identity、请求 identity 和 fact.identity 必须逐字段相同。
3. platformFactPackage.observationRefs 必须且只能包含该 observationId。
4. 消息正文只存在于 fact.content。Observation、Vio Event、审计、错误和其他 fact 不得复制正文。
5. contentHash 为 UTF-8 消息正文的 SHA-256，小写十六进制并带 sha256: 前缀。
6. 任何未知字段、状态写字段、重复正文或引用不一致均返回 SCHEMA_INVALID / never，且不得进入引擎领域模型。

### 19.2 内部 Event 与经历记录边界

以下为 Engine Contract Second Review Response v1 第 9.2 节的权威修订文本：

> PlatformObservation 的接收可以产生持久化摄取回执或独立的来源经历记录，但该记录不是 Vio Event 的直接转换，不拥有状态写权限，也不能自行推进 SubjectState revision。
>
> 只有 Continuity Engine 可以创建内部 Event。只有获批 UPDATE_STATE 才能创建 StateMutation，并使内部 Event 通过 Evolution 正式改变 SubjectState。

第一轮中，摄取回执、request/operation 记录和 consumedObservationIds 都是连接审计材料，不是内部 Event。无 UPDATE_STATE 时不得因为接收消息、记录回执或生成回复而推进 revision。当前 UserInteractionService 的 interaction Event 时间规则不得被第一轮 ContractTestAdapter 复用。

### 19.3 第一轮固定 Binding

以下为 Engine Contract Second Review Response v1 第 9.3 节的权威修订文本：

> 第一轮开始前，由 Continuity Engine 创建全新 subjectId 和 revision 0。Vio生成一个固定 bindingId，并将同一不可变 SubjectBinding fixture 装载到 Vio 与 ContractTestAdapter。
>
> 第一轮不提供绑定创建、更新或重绑定接口。任何 userId、assistantId、subjectId、bindingId、bindingVersion 或 status 不匹配均返回 SUBJECT_BINDING_MISMATCH，且不得泄露其他主体是否存在。

第一轮固定 fixture 精确结构：

```json
{
  "schemaVersion": "subject-binding/first-round-v1",
  "bindingId": "binding-001",
  "userId": "user-001",
  "assistantId": "assistant-001",
  "subjectId": "subject-001",
  "bindingVersion": 1,
  "status": "active",
  "createdAt": "2026-07-30T00:00:00Z",
  "effectiveAt": "2026-07-30T00:00:00Z",
  "replacedBindingId": null
}
```

该唯一 fixture 的实际 `bindingFixtureHash` 为：

    sha256:c75b72194c0158a549f3fb30f04a5147ea11a4e777cb1a9cc1a54da6b93359f6

`bindingFixtureHash` 的输入是上面完整 SubjectBinding fixture，不包含 `bindingFixtureHash` 本身，也不包含其他 hash 字段。先按 RFC 8785 规范化，再对规范化结果的 UTF-8 字节计算 SHA-256，并输出 `sha256:` 加 64 位小写十六进制。`createdAt` 和 `effectiveAt` 是测试准备阶段一次性生成并固化的 RFC 3339 UTC 值；双方必须装载这两个固定值，不得分别重新生成时间。

固定装载流程：

1. Continuity Engine 使用自己的 SubjectState 创建流程创建并持久化本 Profile 的全新 fixture 主体 `subjectId=subject-001`、revision 0；不得复用已有主体。
2. 本次一致性 Profile 固定使用 `subjectId=subject-001`；Vio 为该 `userId=user-001`、`assistantId=assistant-001` 和 subject 生成并固化 `bindingId=binding-001`。
3. 测试准备程序只装载上面的唯一不可变 fixture；`bindingVersion=1`、`status=active`、两个时间和全部 ID 都不得重新生成或替换。
4. Vio 测试存储和 ContractTestAdapter 装载同一 fixture，并分别持久化上面的 `bindingFixtureHash`。
5. 测试启动前，双方各自按 RFC 8785 + UTF-8 + SHA-256 复算并比较 `bindingFixtureHash`；不得比较非规范化 JSON 的原始字节、缩进、字段顺序或换行。不一致立即停止，不进入交互。
6. 第一轮没有创建、更新、解绑或重绑定接口；fixture 只由测试准备流程装载。
7. 任一绑定字段或 status 不匹配都返回相同的 SUBJECT_BINDING_MISMATCH / never、相同非敏感 message、currentEngineRevision=null、currentBindingVersion=null。

### 19.4 第一轮确定性 Provider

以下为 Engine Contract Second Review Response v1 第 9.4 节的权威修订文本：

> 第一轮的 DeterministicThinkingProvider、MemoryRetriever 和 ReplyComposer 均作为 Continuity Engine 进程内 test double 使用，不产生跨服务 CapabilityRequest/CapabilityResult。CapabilityRequest/CapabilityResult 进入后续独立协议测试。
>
> 如果双方决定在第一轮覆盖 capability 通道，必须先追加精确的 capability stub 请求、结果和状态 fixture；不得由双方自行选择不同模式。

本轮已经固定选择第一段模式：第一轮不覆盖 capability 通道，第二段只保留为未来变更控制条件，不是第一轮可选项。三个 test double 都在 continuity-engine 进程内运行：

- DeterministicThinkingProvider 通过现有 ThinkingProvider seam 返回确定性 ThinkingResult。
- MemoryRetriever 返回固定、可复现的 MemoryRetrievalResult，不连接外部长期记忆库或向量数据库。
- ReplyComposer 根据引擎已经完成的 Thinking/Action 结果生成确定性主体表达，不把供应商原始输出直接展示。

Vio 第一轮不实现 capability stub，不接收 CapabilityRequest，不返回 CapabilityResult，也不执行模型、Tool、MCP 或设备。

### 19.5 持久化幂等

以下为 Engine Contract Second Review Response v1 第 9.5 节的权威修订文本：

> requestId 是一次逻辑交互的永久幂等键。第一轮使用规范化逻辑请求的 SHA-256 requestHash。重试必须重发相同逻辑请求；传输尝试次数和重试时间不进入 requestHash。
>
> 相同 requestId 和相同 requestHash 返回第一次持久化的 operation、response 和 stateProjection；不得重新运行 Thinking、创建第二个内部 Event 或推进 revision。相同 requestId 和不同 requestHash 返回 IDEMPOTENCY_CONFLICT。
>
> 幂等记录必须在双方进程重启后仍可恢复。

以上引用保留第二次审核时的历史原文，其中 `IDEMPOTENCY_CONFLICT` 已被本轮最终校准取代，不再构成第一轮有效规则。第一轮唯一错误码是 `IDEMPOTENCY_KEY_REUSED`，不接受旧码作为别名。

第一轮规范化算法固定如下：

1. requestHash 输入是第 19.1.1 节逻辑请求中除 requestHash 本身之外的全部字段，包括原始 createdAt。
2. schema 验证完成后，按 RFC 8785 JSON Canonicalization Scheme 对该对象规范化。
3. 对规范化 UTF-8 字节计算 SHA-256。
4. 输出为 sha256: 加 64 位小写十六进制。
5. transportAttempt、retryCount、retryAt、sentAt、receivedAt、网络头、签名、trace/span 和连接元数据不属于逻辑请求，不进入 requestHash。
6. 重试必须保留原始 createdAt，不得以重试时间替换。

引擎持久化 requestId、requestHash、operationId、operation status、responseId/response、stateProjection、consumedObservationIds 和完成时间。Vio 持久化相同 requestId/requestHash 与收到的完整 operation、response、stateProjection、保存/发布状态。双方进程重启后：

- 相同 requestId + 相同 requestHash 必须返回第一次结果的相同 operationId、responseId、内容、revision、engineUpdateId、hash 和时间，不重新执行任何领域步骤。
- 在 schema、requestHash 和完整 SubjectBinding 验证通过后，相同 requestId + 不同 requestHash 必须返回 IDEMPOTENCY_KEY_REUSED / never；不得返回或接受 IDEMPOTENCY_CONFLICT 别名。
- 内部 Event 去重不能替代完整 operation/result 持久化。

### 19.6 第一轮结果与投影

以下为 Engine Contract Second Review Response v1 第 9.6 节的权威修订文本：

> 第一轮统一使用 `previousRevision` 和 `currentRevision`。
>
> 无状态变化时：
>
> - `changed=false`
> - `currentRevision=previousRevision`
> - `engineUpdateId=null`
>
> 有状态变化时：
>
> - `changed=true`
> - `currentRevision=previousRevision+1`
> - `engineUpdateId=StateUpdateRecord.update_id`
>
> 第一轮状态投影只使用最小 snapshot，不使用 delta。Vio按 subjectId + currentRevision、engineUpdateId 和 requestId 幂等保存。旧 revision、跳号、错 binding 或 hash 冲突进入 reconciling，不推进当前指针。

第一轮成功响应统一为：

```json
{
  "contractVersion": "continuity-integration/v1.1",
  "requestId": "opaque-request-id",
  "requestHash": "sha256:64-lowercase-hex",
  "operationId": "opaque-operation-id",
  "status": "completed",
  "subjectId": "engine-subject-id",
  "bindingId": "fixed-binding-id",
  "bindingVersion": 1,
  "response": {
    "responseId": "engine-response-id",
    "role": "subject",
    "content": "deterministic engine-approved subject expression"
  },
  "stateProjection": {
    "schemaVersion": "engine-subject-state-projection/first-round-v1",
    "subjectId": "engine-subject-id",
    "bindingId": "fixed-binding-id",
    "bindingVersion": 1,
    "previousRevision": 0,
    "currentRevision": 0,
    "changed": false,
    "engineUpdateId": null,
    "contentHash": "sha256:64-lowercase-hex",
    "snapshot": {
      "schemaVersion": 1,
      "subjectId": "engine-subject-id",
      "revision": 0,
      "stateHash": "sha256:64-lowercase-hex"
    }
  },
  "consumedObservationIds": [
    "opaque-observation-id"
  ],
  "completedAt": "2026-07-30T00:00:00Z"
}
```

精确语义：

- operationId 在请求首次被接受时创建并持久化；重放返回同一值。第一轮成功终态固定为 completed。
- responseId 在确定性主体表达首次完成时创建并持久化；重放返回相同 responseId 和 content。
- consumedObservationIds 必须按输入顺序返回实际通过验证并参与本轮的 observationId；第一轮恰有一个值。
- snapshot 是第一轮最小投影，不包含内部完整 SubjectState 正文或 delta。stateHash 是引擎权威 SubjectState.to_dict() 经 RFC 8785 规范化后的 SHA-256；snapshot.content 之类扩展字段在第一轮禁止。
- contentHash 是 snapshot 对象经 RFC 8785 规范化后的 SHA-256。
- 无变化时使用示例中的 changed=false、相同 revision 和 engineUpdateId=null。
- 有变化时 currentRevision 必须等于 previousRevision+1，engineUpdateId 必须等于本轮 StateUpdateRecord.update_id，snapshot.revision 必须等于 currentRevision。
- 第一轮投影内容唯一键为 subjectId + currentRevision，request 与投影的关联唯一键为 requestId，engineUpdateId 仅在非 null 时执行唯一约束。
- 多个 changed=false 请求可以关联同一 revision 的同一份投影；同一 subjectId + currentRevision 不得生成内容、contentHash 或 stateHash 不同的第二份投影。
- changed=false 时 revision 不变且 engineUpdateId=null；changed=true 时 revision 只增加一次，engineUpdateId 等于该次 StateUpdateRecord.update_id。
- 旧 revision、跳号、错 binding、requestHash/contentHash/stateHash 冲突进入 reconciling，不写当前指针、不向前端发布新状态。

### 19.7 第一轮错误 envelope

以下为 Engine Contract Second Review Response v1 第 9.7 节的权威修订文本：

> 第一轮错误响应统一为：
>
> ```json
> {
>   "contractVersion": "continuity-integration/v1.1",
>   "requestId": "opaque-request-id",
>   "operationId": null,
>   "status": "failed_terminal",
>   "error": {
>     "code": "SCHEMA_INVALID",
>     "message": "non-sensitive stable message",
>     "retryClass": "never",
>     "currentEngineRevision": null,
>     "currentBindingVersion": null
>   }
> }
> ```
>
> 第一轮最小映射：
>
> - 未知字段或状态写字段：`SCHEMA_INVALID / never`
> - 错主体或错绑定：`SUBJECT_BINDING_MISMATCH / never`
> - 旧 revision：`REVISION_CONFLICT / reassemble`，返回 currentEngineRevision
> - 相同 requestId 不同 hash：`IDEMPOTENCY_CONFLICT / never`
>
> 错主体和错绑定不得通过不同错误内容泄露资源存在性。

以上引用保留第二次审核时的历史原文，其中旧码 `IDEMPOTENCY_CONFLICT` 和仅覆盖“旧 revision”的窄化说法均已被本轮最终校准取代。下表是第一轮当前唯一有效错误规则：第一轮不得生成、接受或把旧幂等码作为别名；expectedEngineRevision 无论小于还是大于 currentEngineRevision 都属于冲突。

第一轮所有四类错误都保持相同 envelope 字段。固定规则：

| 条件 | code | message | retryClass | currentEngineRevision | currentBindingVersion |
| --- | --- | --- | --- | --- | --- |
| 未知字段、禁止状态字段、正文重复、引用不一致或 requestHash 校验失败 | SCHEMA_INVALID | Request schema is invalid. | never | null | null |
| userId、assistantId、subjectId、bindingId、bindingVersion 或 status 任一不匹配 | SUBJECT_BINDING_MISMATCH | Subject binding does not match. | never | null | null |
| 完整 SubjectBinding 验证通过后，expectedEngineRevision != currentEngineRevision | REVISION_CONFLICT | Engine revision does not match. | reassemble | 当前权威 revision | null |
| schema、requestHash 和完整 SubjectBinding 验证通过后，相同 requestId 已绑定不同 requestHash | IDEMPOTENCY_KEY_REUSED | requestId is already bound to a different requestHash. | never | null | null |

以上错误的 operationId 固定为 null，status 固定为 failed_terminal。错主体和错绑定使用完全相同的 code、message、null 字段和 HTTP/进程内结果语义；不得说明是哪个字段不匹配，也不得确认其他主体是否存在。

### 19.8 ContractTestAdapter

以下为 Engine Contract Second Review Response v1 第 9.8 节的权威修订文本：

> 当前 APIService、本地 HTTP 和 UserInteractionService 不是第一轮 PlatformObservation 摄取接口。APIService 只可复用只读查询或内部核心辅助能力。
>
> 第一轮由独立进程内 ContractTestAdapter 完成 schema、SubjectBinding、requestId、幂等和 expectedEngineRevision 验证，并组装核心引擎输入。ContractTestAdapter 不得把 PlatformObservation 直接构造成内部 Event。

ContractTestAdapter 是第一轮需要由 continuity-engine 新增的 test-only 进程内边界，不是生产接口。验证顺序固定为：

1. 严格验证请求、PlatformObservation、fact package 和所有嵌套对象的 schema；禁止字段在此处以 SCHEMA_INVALID 终止，不能进入领域模型。
2. 重新计算并验证 requestHash。
3. 验证完整不可变 SubjectBinding；任何错主体或错绑定统一返回 SUBJECT_BINDING_MISMATCH。
4. 查询持久化 requestId：同 hash 立即返回第一次完整结果；不同 hash 返回 IDEMPOTENCY_KEY_REUSED / never，且不得接受 IDEMPOTENCY_CONFLICT 别名。
5. 只有完整 SubjectBinding 已验证通过时才读取和比较权威 revision。expectedEngineRevision != currentEngineRevision 一律返回 REVISION_CONFLICT / reassemble 和 currentEngineRevision；只有完全相等才进入领域处理。未通过绑定验证的调用方不得获得 currentEngineRevision。
6. 创建并持久化 operation，组装 Wake/Memory/Perception/Thinking/Action 所需核心输入。
7. 调用引擎现有核心服务和第 19.4 节进程内 test double。
8. 只有 Action 合法批准 UPDATE_STATE 时，才由引擎创建内部 Event/StateMutation 并进入 Evolution。
9. 持久化完整 operation、response、stateProjection 和 consumedObservationIds，再返回。

禁止调用 APIService.submit_message 或 UserInteractionService；禁止把 PlatformObservation、Vio Event、摄取回执或来源经历记录直接构造成内部 Event。

### 19.9 AI Private Space 准确边界

以下为 Engine Contract Second Review Response v1 第 9.9 节的权威修订文本：

> “AI Private Space 的内容控制权属于 AI 主体”仅表达产品内的创建、编辑、展示和使用决策由绑定主体的 Continuity Engine 流程作出，不主张已经确认 AI 法律人格、财产权、数据控制者地位或对合法安全、删除和合规义务的否决权。
>
> AI Private Space 不是 SubjectState、PersonalityTrait 权威库或 Learning 证据放大器。内容如需影响主体状态，必须经过 Memory/Perception/Thinking/Action，并由合法 Event/StateMutation 进入 Evolution。同一内容谱系的重复读取或复制版本不得被计为多份独立 Learning 证据。
>
> AI Private Space 写入只能由 Continuity Engine 形成明确的写入行动决定或专用写入请求。Vio可以验证、拒绝、加密、版本化和存储，但不得替 AI 主体创作、补写、改写或推断私人内容。
>
> 普通产品交互中，AI可以按未来规则拒绝展示私人内容；该拒绝不影响合法删除、安全处置、法定访问或平台必须执行的合规清除。用户不能直接编辑内容，也不意味着平台可以拒绝合法数据处置要求。
>
> 删除用户账号、解绑 assistant、暂停主体、归档主体和永久删除主体必须使用不同操作与审计状态。

补充固定边界：

1. AI Private Space 不是引擎 Memory 管理层。未来只能通过专用 Retriever/事实端口返回带来源候选，再形成 MemoryRetrievalResult 和 MemoryInfluenceRecord；读取不等于进入最终 Context，Memory 影响不等于状态变化。
2. “长期偏好”只能保存为非权威笔记、观察或假设，不得冒充 PersonalityTrait。
3. 同一 contentId 的版本谱系、复制品、缓存或重复读取在 Learning 中只能算同一来源证据；不得增加 independent evidence count。
4. 私域内容不得直接创建 PersonalityTrait，不得绕过 Learning 验证、确认、内部 Event 和 Evolution。
5. 允许的候选内容包括私人笔记、不含完整思维链的认知摘要、未完成想法/工作计划、私人创作草稿、非权威偏好观察、待重新思考问题、外部 Memory 引用/来源摘要和 Learning 候选说明。
6. 禁止 API Key、Token、密码、设备/供应商凭据、完整思维链、系统 Prompt、供应商原始请求、未授权 User Private Data、未经验证的高敏感用户推断、SubjectState/patch/StateMutation、PermissionState/ResourceState 复制品、未真实发生的执行结果和影子人格内容。
7. AI 在普通产品交互中的拒绝展示不能阻止合法删除、安全处置、法定访问、司法/监管要求或平台必须执行的合规清除；合规访问不等于用户获得直接编辑权。
8. 生命周期必须区分：
   - 删除用户账号：撤销用户身份、权限和 User Private Data，并启动绑定/主体处置流程；不自动等同永久删除主体。
   - 解绑 assistant：结束平台关联，不修改或合并 SubjectState。
   - 暂停主体：停止 Wake、能力请求和外部行动，保留数据。
   - 归档主体：冻结为可恢复历史状态。
   - 永久删除主体：经验证和适用确认/合规流程，清除 SubjectState、演化记录、AI Private Space、Memory 引用和 Vio 投影。

三层数据空间实际读写仍排除在第一轮之外。本节补足准确边界，不代表相关产品政策、法律结论或接口已经实现。

### 19.10 七个阻塞项的契约闭合状态

| 阻塞项 | 本 Profile 的闭合位置 | 文档状态 |
| --- | --- | --- |
| PlatformObservation 精确 schema、唯一位置、bindingId、message fact | 19.1 | 已固定并获引擎正式确认 |
| 固定 SubjectBinding 创建与装载 | 19.3 | 已固定并获引擎正式确认 |
| 确定性 Provider 所在层 | 19.4 | 已固定为引擎进程内并获正式确认 |
| 成功响应、无变化投影、engineUpdateId | 19.6 | 已固定并获引擎正式确认 |
| 第一轮最小错误 envelope | 19.7 | 已固定并获引擎正式确认 |
| 独立 ContractTestAdapter | 19.8 | 已固定并获引擎正式确认 |
| 跨重启持久化完整幂等结果 | 19.5、19.6、19.8 | 已固定并获引擎正式确认 |

最终短确认覆盖的四类机器契约精度校准：

| 精度问题 | 闭合位置 | 当前文档结论 |
| --- | --- | --- |
| 顶层严格 Schema 与 registry | 19.1.1—19.1.3 | 三份 Draft 2020-12 Schema、绝对 URN `$id`、精确 `$ref`、format 断言和 UTC `Z` 已固定 |
| 完整有效请求向量与 requestHash | 19.1.1 | facts/observations 各一项；交叉字段、contentHash 和实际 requestHash 已固定 |
| 唯一 Binding fixture 与 bindingFixtureHash | 19.3 | 全部字段、实际 UTC 时间和实际 hash 已固定 |
| 第一轮唯一幂等错误码 | 19.5、19.7、19.8 | 仅 IDEMPOTENCY_KEY_REUSED / never；旧码只存在于明确标为已取代的历史引用 |

Continuity Engine 已确认这些内容不再保留两种可选说法。双方工程档案同步和最终只读复核均已完成；Engine E1/E2/E3 与 Vio V1 已分别实现各自的第一轮本地基础。双方实际调用、Vio 结果/投影持久化和共享测试尚未实现，不能据此宣称第一轮连接已经完成。

## 20. 第一轮最小连接测试

### 20.1 只验证

- 单个全新测试主体。
- 显式固定的 userId / assistantId / subjectId / SubjectBinding。
- 严格无 mutation 的 PlatformObservation。
- requestId、bindingVersion、subjectId 和 expectedEngineRevision 校验。
- continuity-engine 进程内的 DeterministicThinkingProvider、MemoryRetriever 和 ReplyComposer。
- 真实的 SubjectState、Perception、Action 边界、内部 Event、Evolution 和 revision。
- 无状态变化时 revision 保持不变。
- 合法 UPDATE_STATE 时产生新的 revision 和 engineUpdateId。
- 重复 requestId 不产生第二次状态变化。
- revision 冲突不得执行旧请求。
- 错误 subjectId 或错误绑定必须被拒绝。
- 引擎重启后状态和更新记录能够恢复。
- Vio 对回复及投影进行幂等保存。

### 20.2 明确排除

- 真实 GPT、Claude、本地模型或其他模型。
- 真实 Tool、MCP、设备、浏览器、邮箱、日历。
- 外部长期记忆库和向量数据库。
- User Private Data、AI Private Space、Shared Space 的实际跨系统读写。
- 后台常驻 Wake 和主动联系用户。
- Execution Engine。
- 真实 Token 计费和付款。
- 生产认证、多租户及生产部署。
- 遗留 state_update 自动迁移。
- 任何“生产集成已经完成”的表述。

第一轮不得使用 APIService.submit_message、本地 HTTP 或 UserInteractionService 作为 PlatformObservation 摄取入口。APIService 只可复用只读查询或内部核心辅助能力；第一轮必须使用第 19 节定义的独立进程内 ContractTestAdapter。

## 21. 仍需双方共同决定

1. 第一轮之外的 SubjectBinding 创建方、所有者、重绑定确认级别和 subjectId 生成规则；第一轮已由第 19.3 节固定。
2. 是否允许主体跨 assistant、跨用户或跨平台迁移，以及连续性证明。
3. 正式服务域名、网络区、部署拓扑、证书和服务令牌签发方。
4. 同步快速路径的最大时长；异步回调、轮询和流式的边界。
5. operation、CapabilityRequest 和 Outbox 的超时、保留、进度和取消截止点。
6. 第一轮之外 Vio 可以保存的 SubjectState 投影扩展字段、snapshot/delta 选择和签名方式；第一轮已由第 19.6 节固定为最小 snapshot、无 delta 和固定 hash 规则。
7. 第一轮以外的生产操作、主动运行和非交互更新如何分配 update ID；第一轮无变化语义已由第 19.6 节固定为 engineUpdateId=null。
8. 回复与投影处于部分成功时，什么时候允许前端展示，如何向用户表达同步中。
9. ConversationSummary 的最大范围、原文回查权限、更正/删除/撤销传播。
10. User Private Data 的缓存期限和派生数据清理证明。
11. 用户是否可以查看 AI Private Space、查看条件和最小目录可见性。
12. AI 是否可以拒绝展示 AI Private Space，拒绝结果如何说明和申诉。
13. 主体暂停、解绑、归档、删除时 AI Private Space 的保留、导出、移交和最终删除。
14. 用户依法享有的数据权利与 AI 私域产品内容控制权发生冲突时的合规流程。
15. Shared Space 中用户与 AI 各自的创建、修改、撤销、删除和双方确认规则。
16. AI Private Space 引用的 User Private Data 授权撤销后，派生内容如何删除、隔离或降级。
17. 模型流是否允许经引擎审核后分段形成主体表达。
18. 正式错误 HTTP 映射、重试次数、退避、限流和人工处理。
19. Vio 可信供应商用量证明与引擎 ResourceManager 的对账协议。
20. 遗留 state_update 是否迁移、迁移范围、用户知情和 Migration Session 规则；第一轮不迁移。
21. 生产多租户、保留、导出、删除、备份和灾难恢复责任分配。
22. 主动 Wake/Action/Learning 未来映射到会话、通知、待办或仅内部记录的产品规则。

以上均为待共同决定，推荐方向不得写成既定产品事实。

## 22. 契约自检

| 风险 | v1.1 结论 |
| --- | --- |
| 两套 SubjectState 权威 | 禁止；唯一权威在引擎 |
| Vio 越权修改状态 | 禁止；Vio 不创建/提交 StateMutation |
| 两套最终 Context | 禁止；Vio 只提供事实包 |
| 模型绕过引擎 | 禁止；模型原始输出不能直接展示 |
| 外部结果直接改状态 | 禁止；CapabilityResult 只有执行事实 |
| 重复请求/回复/状态 | requestId、responseId、engineUpdateId/revision 和 Outbox 幂等 |
| revision 冲突盲重试 | 禁止；查询当前状态并重新评估 |
| Vio Event 直转内部 Event | 禁止；PlatformObservation 结构隔离 |
| AI 私域与用户私密混用 | 禁止；三层数据空间分别定义 |
| ActionPlan 冒充执行结果 | 禁止 |
| 调试接口冒充生产接口 | 禁止 |
| 引擎降格为聊天服务 | 禁止；引擎持续负责状态、认知和连续演化 |

## 23. 契约修订轮次明确未做

- 未编写或修改连接代码。
- 未修改 continuity-engine。
- 未修改 Vio 前端 src。
- 未新增数据库迁移或业务模块。
- 未接入真实模型、MCP、Tool、设备或外部服务。
- 未开始第一轮连接施工。
- 契约修订轮次未更新 ADR、工程日志、路线图、README 索引或工程总档案；Continuity Engine 正式接受后由独立档案同步任务统一更新。
- 未擅自决定 AI 私域展示/拒绝/删除、Shared Space 权利或其他待决产品政策。
- 未宣称生产连接已经完成。

## 24. 最终接受后的当前入口

1. Continuity Engine 已通过《Engine Contract Final Read-Only Short Confirmation v1》正式接受 v1.1。
2. 最终确认复核了上轮阻塞项、第 19 节修订、14a 对齐文字及相关引擎源码边界，没有重新讨论或推翻长期架构。
3. Vio 与 Continuity Engine 双方工程档案同步及最终只读复核已经完成；随后 Engine E1/E2/E3、Vio V1 和 Vio V2 分别完成单边施工。
4. Engine 已实现 test-only ContractTestAdapter、确定性领域闭环和结果账本；Vio V1 已实现严格请求基础，Vio V2 已实现 fixture 结果的严格 envelope 校验、幂等结果账本、独立投影/revision 隔离和跨重启恢复。V2 默认 transport 仍未配置，跨系统调用、第一轮共享测试、网络和生产连接均尚未实现。
5. v1.1 接受和双方单边基础完成都不表示双方已经连接、第一轮共享测试已经完成或生产集成已经完成；下一阶段仅是在新授权下进行双方共享验收。
