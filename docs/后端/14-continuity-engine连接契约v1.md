# 14｜Continuity Integration Contract v1

## 1. 文档状态

- 契约名称：`Continuity Integration Contract v1`
- 日期：2026-07-29
- 状态：**连接设计完成，尚未开始实际接入**
- 适用范围：Vio Live 平台后端与独立 `continuity-engine` 的未来服务间连接
- 非适用范围：前端直连、数据库合并、真实模型调用、真实 MCP/Tool/设备执行、连接代码和数据库迁移

本文中的接口和字段必须按以下三种状态阅读：

| 标记 | 含义 |
| --- | --- |
| **已实现** | 已在对应仓库源码、数据库迁移和测试中找到依据 |
| **拟新增** | Vio 后端后续需要实现，本轮只有设计，没有接口、代码或表 |
| **待引擎确认** | continuity-engine 当前没有生产级契约，必须由引擎窗口确认后才能固定 |

“拟新增”和“待引擎确认”均不表示已经可调用。

## 2. 核对基线与真实进度

### 2.1 Vio Live 后端

源码、迁移和测试确认以下能力已经存在：

- User、User Space、Subject、Assistant Global Settings 与复合归属查询。
- Conversation、Message、MessageVersion，以及不可变 ConversationSummary 和来源引用。
- Vio Event 的记录与查询；事件当前没有消费者，也没有投递/回执账本。
- SubjectState 不可变版本、当前指针和来源引用。
- 只读 Context Service，可读取设定、当前状态、未解决事件、近期消息和跨窗口摘要。
- AI Private Space 的独立表、不可变版本、安全读取和独立 Context 投影。
- Permission、Security Policy、Confirmation 和 AuditLog。
- Token Budget 的日/会话预算检查与显式使用记录。

同时确认以下现状不能被误写成已经接入：

- 现有 `POST .../state-updates` 允许开发调用方提交状态并推进当前指针；这与“引擎是 SubjectState 唯一权威源”的目标不兼容，属于**既有但后续必须收口**的接口。
- 现有 Context Service 是平台已有事实的只读投影，但旧文档把它描述为“最终上下文装配”；接入后它只能作为平台事实包来源，不能成为最终认知 Context。
- ConversationSummary 与 SubjectState 的内容都由调用方显式提交，不是模型或引擎生成证明。
- Model Router 只做本地规则匹配；Token 使用记录固定表示平台没有调用模型、没有计费。
- 当前没有生产认证、服务间鉴权、continuity-engine 客户端、请求幂等存储、事件投递、回执、重试或熔断。

### 2.2 continuity-engine

源码和测试确认以下能力已经存在：

- `SubjectState` 六段结构及单调 `revision`。
- Event → StateMutation → Evolution 的受控状态演化；重复引擎 Event 会被拒绝。
- `expected_revision` 并发检查和可审计的状态前后差异。
- Wake、Perception、Thinking、Action、Learning 与状态演化链。
- Perception 只读状态，Thinking 产生结构化结果，Action 只形成计划；状态变化最终仍须转换为引擎 Event 并由 Evolution 应用。
- Learning 先形成候选，经证据验证和需要的确认后才可形成状态事件。
- 引擎内部 Permission 与 ResourceManager；它们保护引擎能力和内部资源，不等同于 Vio 的用户授权与供应商费用账本。
- 本地调试 HTTP 和进程内 API facade；前者只有本地配置、状态和聊天入口，后者没有外部直接写 SubjectState 的能力。
- `revision` / `expected_revision` 是现有状态并发与演化机制，不是一个独立的“Revision 服务模块”。
- 当前 ThinkingService 通过引擎内注入的 provider seam 获取确定性结果，当前没有真实模型。集成后若需要真实模型，该 seam 必须通过 Vio 的安全模型通道协作，不能让引擎绕过 Vio 直接持有供应商密钥或调用外部服务。
- 仓库当前使用本地 JSON repository，没有数据库迁移目录；本地 `frontend`/HTTP 聊天链只用于调试与测试，不能被 Vio 前端直接复用为生产入口。

当前没有源码依据证明以下生产能力已经存在：

- 面向 Vio 的正式服务端点、服务间鉴权、TLS、租户隔离和部署拓扑。
- `userId`、`assistantId`、`conversationId`、Vio `eventId` 的完整输入契约。
- 外部 Observation 摄取、平台事实包、ConversationSummary 或 AI Private Space 的输入结构。
- 请求幂等状态查询、异步回调、取消、断线恢复和生产错误码。
- 真实模型调用和 Vio 模型安全通道之间的协调协议。
- 生产数据库、迁移与备份契约；引擎当前本地 JSON 存储不能与 Vio SQLite 合并或共享。

## 3. 不可跨越的职责边界

| 领域 | Vio Live 平台后端 | continuity-engine |
| --- | --- | --- |
| 用户、助手、会话 | 权威保存用户、平台助手、会话、消息和版本 | 只接收已绑定的标识和本轮事实 |
| 用户/生活数据 | 权威保存、隔离、授权和审计 | 只接收为当前目的筛选后的事实 |
| 平台事件 | 权威保存 Vio Event，并投影为 Observation | 判断 Observation 是否影响主体，并在需要时生成引擎 Event |
| SubjectState | 只保存引擎投影、快照、缓存和审计记录 | **唯一权威来源**，通过 Evolution 推进 revision |
| Context | 生成经过权限筛选的结构化平台事实包 | 组织最终认知 Context，并决定哪些事实参与思考 |
| ConversationSummary | 保存可追溯平台摘要与来源 | 判断摘要是否采用及其认知权重 |
| AI Private Space | 安全存储、筛选、授权读取和受控回写 | 只能使用 Vio 明确提供的最小投影，并可提出回写建议 |
| 模型/Tool/MCP/设备 | 执行用户权限、安全、确认、路由和外部调用通道 | 决定何时需要能力并提交结构化调用意图，接收执行结果 |
| Token | 用户预算、供应商调用上限和可信实际计量的权威账本 | 内部认知资源分配、降级、等待或放弃 |
| 前端 | 唯一对外业务入口 | 不接受 Vio 前端直连 |

任何一方都不得绕过另一方的权威边界：Vio 不推演 SubjectState；引擎不直接读取 Vio 数据库、不直接放宽 Permission，也不直接向前端返回业务响应。

## 4. 身份与关联标识

| 标识 | 权威方 | v1 用途与规则 |
| --- | --- | --- |
| `userId` | Vio | 用户和 User Space 的稳定 ID；Vio 必须先验证请求身份和所有权。引擎当前仅有可选 `user_id`，生产语义待确认。 |
| `assistantId` | Vio | 平台助手身份，关联全局设定、私域、会话和用户选择。当前 Vio 私域代码把它映射到 `Subject.subjectId`，这只是现状，不自动成为跨系统规则。 |
| `subjectId` | 引擎 | 引擎 SubjectState 的身份键。后续必须有 Vio `assistantId` 与引擎 `subjectId` 的受控绑定记录。 |
| `conversationId` | Vio | 本轮消息所属会话；引擎当前没有正式会话实体，只能将其作为来源/关联 ID，语义待确认。 |
| `eventId` | Vio | Vio 平台事件 ID；不能直接当作引擎 Event ID，也不能携带 StateMutation。 |
| `requestId` | Vio 编排层 | 一次逻辑交互的全链路幂等键和审计关联键；重试必须复用同一个值。 |

后续建议增加但本轮不实现：

- `bindingId` / `bindingVersion`：锁定 `userId + assistantId + subjectId` 绑定及其版本。
- `observationId`：由 Vio 对每个 Event 投影生成的稳定、带命名空间 ID，例如逻辑形式 `vio-event:{eventId}`；具体格式待双方确认。
- `engineUpdateId`：引擎一次状态演化结果的唯一 ID，用于防止重复状态投影。
- `responseId`：引擎一次回复结果的唯一 ID，用于防止重复主体消息。

所有 ID 都是无业务含义的不透明值；日志、路径和错误中不得放入正文或秘密。Vio 与引擎不得仅凭字符串相同就把 `assistantId` 和 `subjectId` 视为同一命名空间。

## 5. 逻辑连接拓扑

```text
Vio 前端
   │  仅连接 Vio 公共 API
   ▼
Vio 平台后端
   ├─ 身份/归属/Permission/Security/Confirmation
   ├─ Conversation/Message/Event/Summary/Private Space
   ├─ 平台事实包、幂等、审计、Token 与安全能力通道
   │
   │  服务间协议（本轮只设计）
   ▼
continuity-engine
   ├─ Wake → Perception → Thinking → Action → Evolution
   ├─ Learning 与 Revision
   ├─ 最终认知 Context
   └─ SubjectState 权威存储
```

两边数据库保持独立。连接只能经过版本化服务契约，不得跨库查询、共享表或复制整个数据库。

## 6. `ContinuityInteractionRequest`（逻辑请求）

### 6.1 状态

- Vio 侧创建与持久化：**拟新增**。
- 引擎侧接收端点、传输方式和精确字段：**待引擎确认**。
- 下列结构是 v1 的最小语义约束，不是当前可调用 API。

### 6.2 最小请求结构

```json
{
  "contractVersion": "continuity-integration/v1",
  "requestId": "opaque-request-id",
  "requestType": "user_message",
  "identity": {
    "userId": "vio-user-id",
    "assistantId": "vio-assistant-id",
    "subjectId": "engine-subject-id",
    "bindingVersion": 1
  },
  "conversation": {
    "conversationId": "vio-conversation-id",
    "messageId": "vio-message-id",
    "messageVersionId": "vio-message-version-id"
  },
  "expectedEngineRevision": 12,
  "platformFacts": {},
  "observations": [],
  "constraints": {
    "purpose": "reply_to_user_message",
    "tokenBudgetDecisionId": "opaque-decision-id"
  },
  "createdAt": "2026-07-29T00:00:00.000Z"
}
```

要求：

- Vio 必须在创建请求前完成用户身份、复合归属、Permission 与 Security Policy 检查。
- `expectedEngineRevision` 来自 Vio 最近一次**已确认的引擎投影**，只用于并发保护，不能覆盖引擎当前 revision。
- 重试同一逻辑消息必须复用 `requestId` 和相同规范化载荷；同 ID 不同载荷必须返回冲突。
- 传输前必须按允许字段清单构造，不得把数据库行、任意 JSON 列或请求头原样转发。

## 7. 平台事实包

### 7.1 Vio 可以提供的内容

事实包由 Vio 按 `userId + assistantId + conversationId` 复合归属构造，并为每项保留来源、版本、时间和权限依据：

1. 本轮用户消息的稳定 Message/MessageVersion 引用和正文。
2. Assistant Global Settings 的必要字段及版本/更新时间。
3. 当前会话最近消息的有限窗口。
4. ConversationSummary 的有限列表、摘要版本和来源引用。
5. 经过事件类型白名单与脱敏的 Observation。
6. 用户明确标记可进入 Context 的本地记忆投影。
7. 经 `private_domain` Permission → Security Policy → Confirmation 单独批准的 AI Private Space 最小投影。
8. 上一次已确认的 SubjectState 投影元数据，仅作为 revision/缓存提示，不作为权威输入覆盖引擎。
9. 平台安全约束、能力可用性、Token 决策和数据使用目的的结构化元数据。

每个事实项至少应包含：`factType`、稳定来源 ID、来源版本、`occurredAt/createdAt`、`classification`、`authorizationDecisionId` 和内容摘要或最小正文。

### 7.2 明确不包含

- User Space、生活数据、会话历史或 AI Private Space 的整库/整表内容。
- API Key、Token、密码、验证码、设备凭据、第三方认证头或数据库连接信息。
- 未经本次目的授权的财务、健康、生理、亲密、身份或私域数据。
- Vio 侧自行推演的情绪、人格、关系、意图或新的 SubjectState。
- Vio Event 的任意原始 `data` 直通；必须先做类型化映射、字段白名单和脱敏。
- Vio 当前状态投影作为“比引擎更新”的事实。
- 已删除、已撤销、已过期、错用户、错助手或错会话的数据。
- 最终 prompt、最终认知 Context 或模型供应商格式。

## 8. Vio Event → Engine Observation

Vio Event 是“平台发生了什么”的事实；引擎 Event 是“什么应当怎样改变 SubjectState”的权威演化输入。二者不能直接等同。

### 8.1 转换规则

| Vio 字段 | Observation 字段 | 规则 |
| --- | --- | --- |
| `eventId` | `sourceEventId` | 保留来源；另生成稳定 `observationId` 用于投递幂等 |
| `userId` / `subjectId` | `identity` | 先经过助手—引擎主体绑定解析，错配立即拒绝 |
| `eventType` | `observationType` | 使用版本化映射表；未知类型不自动投递 |
| `source` | `source` | 转为受控枚举，不能信任客户端自称的系统来源 |
| `occurredAt` / `recordedAt` | `occurredAt` / `observedAt` | 保留业务发生时间与平台记录时间 |
| `summary` | `summary` | 经过长度限制和敏感信息检查 |
| `data` | `facts` | 只复制该事件类型允许的最小字段 |
| `status` | 不直接映射 | Vio 状态属于平台记录；投递状态以后由独立账本保存 |

Observation 必须显式标记 `stateMutationAllowed=false`，不得包含引擎 `impact_scope` 或 `StateMutation`。引擎负责在 Wake/Perception/Thinking/Learning 后决定忽略、记忆、等待，或创建自己的引擎 Event 并由 Evolution 推进状态。

### 8.2 首批映射建议

| Vio Event | Observation 最小事实 | 默认敏感处理 |
| --- | --- | --- |
| `appearance_changed` | 变化类别、资源 ID、时间 | 不复制图片二进制或私有地址 |
| `subject_updated` | 变化字段名、设定版本 | 不复制完整人格/禁止事项正文，除非事实包另行授权 |
| `permission_created/changed/revoked` | 资源类型、动作、最终状态 | 不复制确认正文、策略指纹或秘密 |
| `conversation_created` | conversationId、状态、时间 | 不复制标题正文 |
| `message_created/updated/regenerated` | messageId、versionId、senderType | 正文只通过本轮消息/授权消息事实提供 |
| `life_event_created/budget_changed/health_record_updated` | 模块、记录 ID、变化类型 | 不复制金额、身体数值、亲密内容或备注 |
| `private_space_created/private_memory_updated/private_state_changed` | space/content/version ID、变化类型 | 不复制私域正文；正文必须走独立私域投影 |
| `device_changed` | deviceId、变化类型、平台状态 | 不把注册/准备误写成真实连接或执行结果 |

具体映射版本、允许字段和引擎接收格式均为**拟新增/待引擎确认**。

## 9. Context Pipeline 责任分配

| 顺序 | 工作 | 责任方 |
| --- | --- | --- |
| 1 | 接收前端消息，校验认证、用户/助手/会话归属 | Vio |
| 2 | 保存用户 MessageVersion 与最小 Vio Event | Vio |
| 3 | 检查 Permission、Security Policy、Confirmation 与数据使用目的 | Vio |
| 4 | 检查用户日/会话/供应商 Token 预算 | Vio |
| 5 | 读取并筛选消息、摘要、平台事件、允许的本地记忆和私域投影 | Vio |
| 6 | 形成有来源的 `PlatformFactPackage`，不生成最终 prompt | Vio |
| 7 | 加载权威 SubjectState、引擎历史、引擎 Memory 和 revision | 引擎 |
| 8 | Wake 与 Perception，把平台事实解释为当前感知 | 引擎 |
| 9 | 选择相关事实/记忆并组织最终认知 Context | 引擎 |
| 10 | Thinking、Learning 和 Action 决策 | 引擎 |
| 11 | 如需模型/Tool/MCP/设备，向 Vio 提交结构化能力调用意图 | 引擎决定，Vio 审批与执行 |
| 12 | 对真实外部调用再次检查 Token/Permission/Security/Confirmation 并路由 | Vio |
| 13 | 将能力结果返回引擎继续推理，不直接改状态 | Vio → 引擎 |
| 14 | 将获批状态变化转换为引擎 Event，并由 Evolution 更新 SubjectState | 引擎 |
| 15 | 返回回复结果、权威 revision/状态投影和消费回执 | 引擎 |
| 16 | 幂等保存主体回复、状态投影、使用记录和审计，再响应前端 | Vio |

当前双方都没有完整实现第 6—16 步的跨服务协议。本表定义责任，不宣称链路可用。

## 10. 一条用户消息的完整未来流程

1. 前端只向 Vio 的消息/交互入口发送消息，并携带客户端命令幂等键。
2. Vio 解析生产身份，校验 `userId + assistantId + conversationId` 复合归属。
3. Vio 在本地事务中只保存一次用户 Message/MessageVersion 和 `message_created` Event。
4. Vio 为这次逻辑交互生成或恢复同一个 `requestId`，重复提交直接返回原请求状态。
5. Vio 执行 Permission、Security Policy、需要的 Confirmation 和 Token 预算预检。
6. Vio 生成平台事实包，并把待消费 Vio Event 转为无状态修改能力的 Observation。
7. Vio 使用服务间鉴权把逻辑请求发送给 continuity-engine；网络重试仍使用同一 `requestId`。
8. 引擎校验契约版本、主体绑定、请求幂等和 `expectedEngineRevision`。
9. 引擎加载权威 SubjectState，通过 Wake、Perception 和记忆读取组织最终认知 Context。
10. 引擎运行 Thinking/Action；如果不需要外部能力，直接进入步骤 13。
11. 如果需要模型、Tool、MCP 或设备，引擎只返回/发送结构化调用意图；Vio 再次执行权限、安全、确认、路由和 Token 限制。
12. Vio 将受信的调用结果按同一 `requestId` 返回引擎；引擎继续判断，不允许外部结果直接改 SubjectState。
13. 引擎对获批状态变化创建自己的 Event/StateMutation，通过 Evolution 产生新 revision；也可以明确选择不更新状态。
14. 引擎返回与 `requestId` 关联的 `responseId`、回复、消费的 Observation、权威状态 revision/更新 ID、能力请求结果和使用元数据。
15. Vio 校验响应主体、绑定、request/revision 连续性；重复响应不重复写入。
16. Vio 只保存一次主体 MessageVersion；只保存一次引擎 SubjectState 投影，并记录 AuditLog/Token 使用和请求终态。
17. Vio 返回统一业务响应给前端。前端看不到引擎地址、凭据或内部 Context。
18. 后续重复查询同一 `requestId` 返回已保存结果，不再次生成回复或状态更新。

## 11. 引擎返回结果（逻辑结构）

### 11.1 状态

- 精确端点和同步/异步形式：**待引擎确认**。
- Vio 结果接收、幂等保存和审计：**拟新增**。

### 11.2 最小结果语义

```json
{
  "contractVersion": "continuity-integration/v1",
  "requestId": "opaque-request-id",
  "status": "completed",
  "subjectId": "engine-subject-id",
  "response": {
    "responseId": "engine-response-id",
    "role": "subject",
    "content": "reply text"
  },
  "stateProjection": {
    "schemaVersion": "engine-subject-state/v1",
    "engineUpdateId": "engine-update-id",
    "previousRevision": 12,
    "revision": 13,
    "snapshot": {}
  },
  "consumedObservationIds": [],
  "usage": {},
  "completedAt": "2026-07-29T00:00:01.000Z"
}
```

最低要求：

- 结果必须能证明关联的 `requestId`、`subjectId`、输入 revision 和输出 revision。
- “没有状态变化”也要明确返回，不得让 Vio 猜测。
- 回复与状态投影必须有各自稳定 ID，允许分别去重。
- `snapshot` 或 `delta` 的选型、签名、内容哈希、错误结构、使用计量和异步回调方式待引擎确认。

## 12. SubjectState 投影规则

1. continuity-engine 是唯一权威源；Vio 不接受前端、模型适配器或普通 API 调用方生成权威状态。
2. Vio 只保存引擎返回的完整快照或可验证增量，并记录 `subjectId`、引擎 schema 版本、revision、`engineUpdateId`、`requestId`、来源 Observation/引擎 Event 和内容哈希。
3. 唯一性至少覆盖 `subject binding + engine revision` 和 `engineUpdateId`。
4. 只有 `previousRevision` 与 Vio 最后已确认投影连续时才前移当前投影指针；重复 revision 返回已有记录。
5. 乱序或跳号结果进入隔离/对账状态，不自动覆盖当前投影；Vio向引擎查询权威快照后再修复。
6. 状态不一致时以引擎为准。Vio 的缓存、旧快照或历史 `state_update` 不能回灌覆盖引擎。
7. 引擎不可用时，Vio可以展示最后确认快照并明确 `stale`，但不得自行推进 emotion、intensity、关系、意图或 revision。

现有 `subject_states` 缺少引擎 subject 绑定、engine revision/update ID/schema/hash 和接收状态。后续需要数据库/服务/API 迁移设计，但本轮禁止新增迁移。现有开发调用方 `POST .../state-updates` 在真实接入前必须改为内部受信投影入口或停用；历史数据需要“legacy/unverified”迁移策略，不能自动成为引擎初始状态。

## 13. ConversationSummary 提供规则

- Vio 的摘要是带 MessageVersion/Event 来源的不可变平台事实，**不是引擎认知结论**。
- 每项发送给引擎的摘要必须包含 `summaryId`、`summaryVersion`、`conversationId`、来源引用、创建时间、内容分类和授权依据。
- 默认只发送同一用户/助手范围内、与当前会话相关的有限摘要；不能加载全部历史或跨助手摘要。
- 引擎负责判断采用、忽略、降权或回查来源；Vio 不把摘要直接写入 SubjectState。
- 引擎当前没有 ConversationSummary 输入契约，摘要长度、数量、来源回查和引擎是否生成新摘要均待确认。

## 14. AI Private Space 读取与回写

### 14.1 读取

1. 通用平台事实包默认不包含私域。
2. 引擎若需要私域，必须声明目的、内容类型、最大条数/版本和关联 `requestId`。
3. Vio 依次检查复合归属、`private_domain` Permission、Security Policy 和 Confirmation。
4. Vio 只通过现有独立 Context 投影能力读取当前允许版本，并按字段白名单、大小和分类裁剪。
5. 投影附带授权决定和过期边界；不得把 Space 整体、全部历史或其他助手私域发送给引擎。

### 14.2 回写

- 引擎只能提出结构化 `PrivateSpaceWriteProposal`，不能直写 Vio 数据库。
- Vio 必须重新执行写权限、安全策略和需要的确认，并使用当前 `baseVersionId` 防止覆盖。
- `requestId + proposalId` 必须幂等；重复提案不能追加重复版本或重复事件。
- Event/AuditLog 只记录 ID、版本、类型和结果，不复制私域正文。
- 提案结构、允许内容类型、保留/删除策略和引擎签名均为**待引擎确认**。

## 15. 幂等与防重复

| 风险 | v1 规则 |
| --- | --- |
| 重复请求 | 同一逻辑命令固定 `requestId`；Vio 保存规范化 payload hash。相同 ID/相同 hash 返回已有状态，不同 hash 返回 `409`。 |
| 重复事件 | Vio `eventId` 唯一；`observationId` 由投影稳定产生；引擎保存 Observation 回执并拒绝重复消费。 |
| 重复回复 | 引擎返回稳定 `responseId`；Vio 对 `requestId + responseId` 唯一保存主体 MessageVersion。 |
| 重复状态更新 | 引擎返回 `engineUpdateId + revision`；Vio 对两者分别唯一并执行 revision 连续性检查。 |
| 重复能力调用 | 每个能力意图具有 `capabilityRequestId`，Vio 的安全准备与执行结果可重放查询但不能重复执行。 |
| 重复私域回写 | `proposalId + requestId + baseVersionId` 唯一；版本变化后旧提案冲突。 |

实现时需要持久化请求/投递/回执状态，不得只依赖进程内缓存。具体表结构属于下一阶段，不在本轮创建。

## 16. 超时、失败、重试、断线与不可用

### 16.1 通用原则

- 超时时不得用新的 `requestId` 盲目重放；先查询原请求状态，无法查询时仍以相同 ID 做有界重试。
- 只对明确可重试的网络失败、限流和临时不可用进行指数退避；校验、权限、revision 冲突和不支持版本不得自动重试。
- Vio 必须区分 `pending`、`processing`、`awaiting_confirmation`、`completed`、`failed_retryable`、`failed_terminal` 和 `cancelled/expired` 的逻辑状态；最终枚举待实现确认。
- 引擎返回未知结果时，Vio 不能既写回复又报告失败；必须通过 request status/response ID 对账。

### 16.2 引擎不可用时 Vio 可以做什么

- 保存已经通过本地校验的用户消息、Vio Event 和待处理请求状态。
- 保存尚未投递的 Observation 事实及重试元数据。
- 向前端返回明确的“连续性服务暂不可用/请求待处理”，或允许用户显式重试/取消。
- 只读展示最后一次已确认的 SubjectState 投影，并标注陈旧时间和 revision。
- 继续提供与引擎无关的普通平台数据读写，但仍遵守原有权限和安全规则。

### 16.3 引擎不可用时 Vio 不能做什么

- 不能自行生成 AI 回复并冒充引擎结果。
- 不能自行修改 SubjectState、推进 revision 或把 Vio Event 直接变成状态变化。
- 不能用旧投影组装另一套最终 Context 并偷偷调用模型。
- 不能自动写 AI Private Space 的“认知/状态/偏好”内容。
- 不能把消息已保存误报为 AI 回复已完成。

具体超时阈值、重试次数、熔断窗口、状态查询和取消端点需要压测及引擎确认，本契约不虚构数值。

## 17. 接口版本、鉴权、权限和审计

### 17.1 版本

- 连接层使用独立 `contractVersion`，不复用 Vio 公共 `/api/v1` 的版本含义。
- 破坏性变更必须提升主版本；新增可选字段需要能力协商和向后兼容窗口。
- 请求与响应必须校验 JSON Schema/等价结构，并拒绝未知的必需语义。
- SubjectState schema、Observation 映射和平台事实包也分别带版本。

### 17.2 鉴权与授权

- 现有 `x-vio-user-id` 不是生产认证，也不能用于服务间鉴权。
- 未来连接需要服务身份、传输加密、短期凭证、请求时间/nonce 和重放保护；采用 mTLS、签名 Token 或组合方案仍待安全评审。
- 引擎只信任经过服务鉴权的 Vio 调用，但仍要校验 `subjectId` 与绑定；Vio 负责最终用户身份、所有权、Permission、Policy 和 Confirmation。
- 引擎内部 Permission 不能替代 Vio 用户权限，Vio 许可也不能绕过引擎自身演化规则。

### 17.3 审计

Vio 至少记录：`requestId`、用户/助手/引擎主体绑定、输入来源 ID、权限/策略/确认决定、Token 决定、投递次数、引擎状态、`responseId`、`engineUpdateId/revision`、最终结果和错误类别。审计不得复制完整消息、私域正文、密钥、最终认知 Context 或模型原始敏感响应。

引擎侧至少需要可按 `requestId`、`subjectId`、Observation、引擎 Event 和 revision 追踪处理历史；精确保留周期和对账导出待确认。

## 18. 多用户、多助手与数据隔离

1. Vio 每次读写和事实选择都带 `userId + assistantId`；会话数据再带 `conversationId`。
2. `assistantId` 必须属于 `userId`，绑定的引擎 `subjectId` 必须处于同一个有效 binding。
3. 切换当前助手只改变 User Space 指针，不改变或合并绑定、状态、摘要、私域、事件和 Token 账本。
4. 一个请求只能包含一个用户、一个助手、一个引擎主体；跨主体汇总必须另立明确产品和权限决策。
5. 错用户/助手/会话的资源统一按不可见处理，不能通过错误差异泄露存在性。
6. 引擎必须按 `subjectId` 隔离状态、Memory、Wake、Action、Learning 和资源；当前引擎缺少完整生产多租户保证，属于接入阻塞依赖。
7. 两边禁止共享数据库、目录或本地 JSON 存储；备份、导出和删除必须分别按契约协调。

## 19. Token Budget 分层

| 检查点 | 权威方 | 作用 |
| --- | --- | --- |
| 用户每日/会话限额 | Vio | 在请求进入引擎前决定允许、确认、延后或阻止 |
| 模型/供应商路由与费用上限 | Vio | 每次真实模型调用前再次检查，真实返回后记可信使用量与费用 |
| 引擎认知资源 | 引擎 ResourceManager | 约束 Wake/Thinking/Memory 深度，允许降级、等待或停止 |
| 估算 | 双方各自负责本层 | 必须标明估算来源，不得当成实际计费 |
| 实际计量对账 | Vio 为供应商账本权威；引擎返回关联元数据 | 同一 `capabilityRequestId` 只能记一次，避免双重扣减 |

Vio 当前 Token 记录仍是调用方显式上报并固定“平台未调用/未计费”；真实调用前必须新增受信执行回执。引擎当前 ResourceManager 已存在，但双方如何交换预算、实际使用和降级原因仍待确认。

## 20. 接口清单与实现状态

### 20.1 Vio 已实现、可作为连接基础的接口

- User/User Space/Subject/Conversation/Message/MessageVersion 读写接口。
- ConversationSummary 保存、来源查询和跨窗口读取接口。
- Vio Event 创建与查询接口。
- 当前 SubjectState 版本查询和历史接口；**现有公开写入口不符合未来权威边界，不能直接用于接入**。
- 当前 Context 只读接口；接入后仅能视为平台事实来源，不是最终认知 Context。
- AI Private Space 独立安全投影接口。
- Permission、Security Policy、Confirmation、AuditLog、Token Budget 和 Model Router 基础接口。

### 20.2 Vio 后端拟新增（均未实现）

- Assistant ↔ engine Subject 绑定、绑定版本和生命周期。
- Continuity 请求/结果持久化、payload hash、状态查询和取消。
- 类型化 `PlatformFactPackage` 构造器及逐字段来源/分类/授权元数据。
- Event → Observation 映射注册、投递账本、回执和去重。
- 服务间 continuity client、超时、同 ID 重试、熔断和对账。
- SubjectState 权威投影接收、revision CAS、乱序隔离和快照修复。
- 引擎回复到 MessageVersion 的幂等落库。
- 模型/Tool/MCP/设备能力意图的安全回调通道和结果回送。
- 可信 Token 实际使用与供应商账单对账。
- 服务间认证、密钥管理、最小审计、指标与告警。
- 契约、幂等、故障、隔离、安全和兼容性测试。

建议的 Vio 内部逻辑操作名为 `createContinuityRequest`、`getContinuityRequestStatus`、`buildPlatformFactPackage`、`dispatchObservations`、`applyEngineProjection`。这些不是当前 HTTP 路径，也不应在实现前对前端公开。

### 20.3 continuity-engine 侧依赖（当前未确认）

- 正式、版本化、可部署的服务端点和健康/就绪语义。
- 服务身份验证、授权、租户/主体隔离和审计。
- `ContinuityInteractionRequest`、平台事实包和 Observation 摄取契约。
- 请求幂等、状态查询、重试、取消和结果回放。
- Assistant/Subject 绑定或 Subject 创建/查询生命周期。
- ConversationSummary、受控私域投影和来源回查方式。
- 模型/Tool 等能力意图与 Vio 执行结果的往返协议。
- 权威 SubjectState 快照/增量、schema、revision、update ID 和恢复接口。
- 错误码、超时、限流、负载和兼容政策。
- Token 估算、引擎资源消耗和供应商实际使用的关联字段。

### 20.4 尚无代码或文档依据、必须等待引擎窗口确认

1. 生产接口是同步、异步、流式还是多阶段回调。
2. 具体 URL、协议、序列化格式、认证方案和网络部署位置。
3. Vio `assistantId` 与引擎 `subjectId` 是否允许初期使用同值，及后续重绑定规则。
4. 引擎如何接受外部 Observation，而不是带 mutation 的内部 Event。
5. 引擎是否接收完整状态快照、只接收期望 revision，或提供独立状态查询。
6. ConversationSummary 与来源原文的请求/回查协议。
7. AI Private Space 哪些内容类型可读、哪些提案可写，以及用户如何获知。
8. 引擎请求 Vio 模型/Tool 通道的状态机、超时和结果格式。
9. 一次交互中回复和状态更新是否原子完成，部分成功如何恢复。
10. 主动 Wake、定时 Wake、Action 和 Learning 产生的异步结果如何映射到 Vio 会话/通知。
11. 引擎错误分类、重试安全范围、取消和长任务进度。
12. 引擎生产多用户/多助手隔离、数据保留、删除和导出能力。
13. 实际 Token/费用由哪一层获得供应商签名或可信计量。
14. 历史 Vio `state_update` 的迁移、废弃和首次引擎状态建立方式。

## 21. 下一阶段建议（不在本轮实施）

下一阶段应先由规划窗口和引擎窗口共同确认第 20.4 节，再做最小“无模型、无外部能力”的连接骨架：

1. 固定身份绑定、请求/响应、Observation 和状态投影 schema。
2. 设计新增迁移和内部服务接口，但另行审核后才写代码。
3. 先以确定性测试适配器验证一条消息、一次 Observation、一次回复和一次 revision 投影。
4. 覆盖重复请求、重复 Event、重复回复、乱序状态、引擎断线和跨用户隔离。
5. 完成后仍不接真实模型，待安全、Token 和能力通道单独评审。

## 22. 本阶段明确未做

- 未修改前端 `src/`。
- 未修改 continuity-engine。
- 未编写任何连接代码或新业务模块。
- 未新增数据库迁移或改变既有表。
- 未接入真实模型、API Key、MCP、Tool 或设备。
- 未让前端连接 continuity-engine。
- 未合并数据库。
- 未宣称引擎已经接通。
