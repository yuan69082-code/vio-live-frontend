# 12｜API 与事件契约

## 状态

- 文档状态：基础契约持续实现
- 实现状态：已建立统一响应、健康检查、User/Subject/Assistant Global Settings/Dashboard、Conversation/Message/MessageVersion、Event、Provider/Model、默认/备用模型路由规则、Tool/MCP/Skill/Plugin Registry、Device Registry/Capability、Permission、Security、Confirmation 和 AuditLog 基础；前端独立 API 客户端已完成首次健康连接，完整平台 API 未建立
- 当前限制：真实认证、授权、分页、完整契约、兼容治理和生成代码尚未实现

## 目标

建立前端、平台后端、连续性引擎、AI 模型和外部能力之间的稳定边界。接口变化不能依赖页面内部状态，也不能让前端直接持有数据库、密钥或设备厂商协议。

## 接口关系

### 前端与平台后端

前端通过平台接口处理：

- 登录与当前主体
- 工作台摘要和最近变化
- 会话、消息、版本和分支
- 连续性页面可见数据
- AI 私域目录、申请和开放结果
- 模型、MCP、Skill、插件和 Tool 状态
- 设备、权限和访问日志
- 生活管理数据
- 数据导出、备份、恢复和删除入口

### 平台后端与连续性引擎

平台后端传递主体、事件、消息、授权记忆和状态更新；连续性引擎返回当前状态、连续性约束和允许读取的相关内容。

平台接口不暴露连续性引擎内部算法或存储结构。

### 平台后端与模型服务

平台后端最终负责选择模型、装配上下文、发送本轮内容并接收 `reply` 与 `state_update`。当前只实现规则选择、只读 Context 投影和显式 `state_update` 保存，不发送模型请求。模型服务不直接操作数据库、设备或用户权限。

### 平台后端与外部能力

平台后端负责适配、授权、调用和日志。MCP、Tool 和设备不能绕过平台权限层直接被前端或模型执行。

## 契约中的通用信息

不同接口按需要表达以下信息：

- 当前用户
- 当前智能体主体
- 数据或事件来源
- 创建或发生时间
- 当前版本或状态
- 权限与可见范围
- 与会话、消息、事件、设备或生活模块的关系

秘密密钥和不必要的敏感原文不作为普通接口返回值。

## 统一 HTTP 响应

所有 JSON 响应至少包含：

- `success`：HTTP 2xx 时为 `true`，其他结果为 `false`
- `data`：成功数据；失败时固定为 `null`
- `error`：失败时包含 `code`、`message`、`requestId` 和可选 `details`；成功时固定为 `null`
- `timestamp`：服务端生成的 UTC ISO-8601 响应时间

列表接口可以额外返回 `meta.count`。HTTP 状态码仍表达 200、201、400、404、409、413、415、500 等结果；创建响应保留 `Location`，全部响应保留 `x-request-id`、`no-store` 和 `nosniff`。统一 envelope 不替代 HTTP 状态语义。

开发前端使用同源 `/api` 与 `/health` 代理，不要求后端开放通配 CORS。`VITE_BACKEND_PROXY_TARGET` 只配置本地代理目标，不承载密钥。

## User、Subject 与 Dashboard 契约

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `POST` | `/api/v1/users` | 创建基础用户；当前不是注册或登录验证 |
| `GET` | `/api/v1/users/:userId` | 按稳定 ID 查询用户 |
| `GET` | `/api/v1/users/current` | 使用 `x-vio-user-id` 查询开发期当前用户；不是认证 |
| `POST` | `/api/v1/users/:userId/subjects` | 创建属于该用户的 AI 主体 |
| `GET` | `/api/v1/users/:userId/subjects` | 查询该用户主体列表，返回 `meta.count` |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId` | 按用户/主体双重归属查询单项 |
| `PATCH` | `/api/v1/users/:userId/subjects/:subjectId` | 更新名字、头像引用或基础设定 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/global-settings` | 读取助手长期全局设定 |
| `PATCH` | `/api/v1/users/:userId/subjects/:subjectId/global-settings` | 局部更新助手长期全局设定 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/dashboard` | 聚合用户、主体和基础活动状态 |

Subject PATCH 只接受 `name`、`avatarRef`、`basicSettings`，至少提供一个字段；`basicSettings` 使用整对象替换。只有实际变化才与最小 `subject_updated` Event 同事务提交，无变化请求不更新时间或重复发事件。

Global Settings PATCH 只接受 `name`、`avatarRef`、`personalityDescription`、`expressionStyle`、`relationshipDefinition`、`longTermRequirements` 和 `prohibitions`。名称/头像复用 Subject 唯一身份字段，其他长期设定保存于一对一扩展表。实际变化与只含 `changedFields` 的 `subject_updated` Event 原子提交；无变化不写库。设定正文不复制到 Event，长期要求和禁止事项不能削弱平台最低安全规则。

Global Settings 是用户明确配置、允许更新的长期静态层；SubjectState 是带来源、不可变追加的动态层。任一 Global Settings 更新都不得创建、覆盖或切换 SubjectState，也不表示模型或 continuity-engine 已运行。

Dashboard 只返回现有 User、Subject 与 `basicStatus`。`ready` 仅表示用户和主体均为 `active`；连续性固定返回 `not_available`，不从 mock、设定或模型配置猜测未实现状态，也不返回设备、待办、提醒或模型结果。

`x-vio-user-id` 与路径中的 `userId` 都只是当前开发请求范围，不是可信身份。服务不会自动选择数据库首位用户；真实认证前不得公开这些路由。

## Conversation、Message 与 Version 契约

所有对话路由完整携带 `userId`、`subjectId` 和 `conversationId`，消息/版本路由继续携带稳定 `messageId`，跨用户、主体或会话组合统一返回 `404`。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `POST` / `GET` | `/api/v1/users/:userId/subjects/:subjectId/conversations` | 创建或列出主体会话 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId` | 获取会话详情 |
| `POST` / `GET` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/messages` | 添加消息或读取当前消息流 |
| `GET` / `PATCH` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/messages/:messageId` | 查询消息；用户消息 PATCH 追加编辑版本 |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/messages/:messageId/regenerations` | 为主体消息追加重生成记录 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/messages/:messageId/versions` | 查询同一消息全部版本 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/messages/:messageId/versions/:messageVersionId` | 查询单个版本 |

创建消息只接受 `senderType`（`user`、`subject`、`system`）和非空文本 `content`；服务端生成状态、顺序、初始 `original` 版本和时间。PATCH 只允许用户消息，重生成记录只允许主体消息，两者请求体均固定为 `baseVersionId` 与 `content`。`baseVersionId` 必须仍是当前版本，否则返回 `409`。

普通消息列表只投影每个 Message 的当前版本；版本接口显式返回 `versionNumber`、`changeReason`、`parentVersionId` 与 `isCurrent`。主体内容由开发调用方提交，只记录数据，不调用 GPT、Claude、GLM 或其他模型。当前没有删除、分支、重置、附件或流式回复接口；Context 只读装配接口见下节。

## 软件事件契约

当前实现使用以下事件名：

- `appearance_changed`
- `subject_updated`
- `permission_changed`
- `life_record_created`
- `device_changed`
- `conversation_created`
- `message_created`
- `message_updated`
- `message_regenerated`

事件创建体包含 `eventType`、`source`、`occurredAt`、`data`、`summary` 和可选 `subjectId`。服务生成 `eventId` 与 `recordedAt`，并将初始 `status` 设为 `pending`。事件数据不得包含明显的密钥、密码、验证码、Token、Secret 或完整证件号字段。

当前事件接口：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `POST` | `/api/v1/users/:userId/events` | 在指定用户范围创建事件 |
| `GET` | `/api/v1/users/:userId/events` | 查询该用户事件，可按 `subjectId`、`eventType`、`status`、`from`、`to` 和 `limit` 筛选 |
| `GET` | `/api/v1/users/:userId/events/:eventId` | 查询该用户范围内的单个事件 |

对话写入会在同一事务创建对应最小 Event，事件只包含 ID、发送者类型和版本关系，不包含会话标题或消息正文。这些路由供未来连续性引擎读取和 AI 上下文装配使用，但当前没有连接消费者、连续性引擎或模型。能力变化和数据变化仍是规划范围，尚未成为当前接口接受的事件名。

Device 服务也会在同一事务写入 `device_changed`。其 `changeType` 当前只包括 `connection_registered`、`registry_status_changed`、`authorization_changed` 与 `operation_requested`；这些是平台元数据和请求事实，不是设备在线、实际状态变化或执行成功证明。

## Device Registry、Adapter 与操作准备契约

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/api/v1/device-adapters` | 查询未来 Adapter 类型和固定未实现状态 |
| `POST` / `GET` | `/api/v1/users/:userId/devices` | 注册或按设备类型、状态、品牌查询用户设备元数据 |
| `GET` | `/api/v1/users/:userId/devices/:deviceId` | 查询设备、声明能力和未配置 Adapter 描述 |
| `PATCH` | `/api/v1/users/:userId/devices/:deviceId/status` | 只更新平台注册项的 `enabled` / `disabled` |
| `POST` | `/api/v1/users/:userId/devices/:deviceId/authorizations` | 为同用户主体创建设备能力 Permission |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/devices/:deviceId/operation-preparations` | 执行权限、安全和确认准备，不调用设备 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/device-operation-logs` | 查询主体范围的最小未执行设备日志 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/device-operation-logs/:operationLogId` | 查询单条设备操作准备日志 |

设备类型固定为 `phone`、`watch`、`air_conditioner`、`robot_vacuum`、`washing_machine`、`camera`、`appliance`；能力固定为 `view_status`、`power`、`adjust_parameter`、`get_data`。创建请求只接受类型、品牌、名称和能力列表，不接受外部设备 ID、位置、凭据或状态正文。设备默认停用，`connectionStatus=not_connected`、`stateStatus=not_observed`，启用也不改变这两个事实。

Device Adapter 契约为未来 `connect`、`disconnect`、`readStatus` 和 `executeCapability` 预留方法。小米、美的、Apple、Android 与通用 Adapter 当前仅有只读描述，全部返回 `implementationStatus=not_implemented`、`connectionSupported=false`、`controlSupported=false` 和 `externalApiCallsSupported=false`。

授权请求把查看状态/获取数据映射为 `read`，开关/调节参数映射为 `control`，复用现有 Permission。操作准备只接受 `capability` 和可选 `confirmationId`，拒绝实际控制参数；它依次检查设备启用与能力声明、Permission、`device_control` Security 和 Confirmation。所有成功或待确认响应及日志仍固定 `executionStatus=not_executed`、`deviceCall=not_performed`、`vendorApiCall=not_performed`，不连接、读取或控制真实设备。

## 摘要、状态与 Context 契约

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `POST` / `GET` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/summaries` | 保存或查询不可变会话摘要版本 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/summaries/:summaryId` | 查询摘要及 MessageVersion/Event 来源 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/cross-window-summaries` | 排除当前窗口，读取同一主体其他窗口各自最新摘要 |
| `POST` / `GET` | `/api/v1/users/:userId/subjects/:subjectId/state-updates` | 保存或查询不可变 SubjectState 版本 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/state-updates/:subjectStateId` | 查询单个状态版本 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/state` | 查询当前状态指针指向的版本 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/context` | 按产品顺序只读装配现有上下文事实 |

摘要必须包含非空 `content` 和 1—100 个去重来源。MessageVersion 来源必须属于摘要所在 Conversation，Event 来源必须属于相同主体；摘要和来源原子提交且不可原地覆盖。

`state_update` 包含 `currentState`、`emotion`、`intensity`、`changeReason`、`unresolvedEventIds`、`continuityConstraints` 和 `source`。来源支持同主体 MessageVersion、Event 或 ConversationSummary；状态、未解决 Event 和当前指针原子提交，旧状态保持不可变。

Context 支持限制近期消息和跨窗口摘要数量，按系统安全位置、完整助手全局设定、当前状态、未解决事件、近期消息、跨窗口摘要、Memory 位置、本轮用户消息的顺序返回。系统规则内容固定为 `reserved`，Memory 固定为 `not_implemented`，模型、外部 API 和 continuity-engine 固定标记 `not_performed`。接口不生成提示词、不持久化装配结果，也不产生 Token 或外部请求。

## 每轮模型契约

当前已实现的模型配置与选择接口：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `POST` | `/api/v1/users/:userId/api-providers` | 创建不含真实 Key 的 Provider 配置 |
| `GET` | `/api/v1/users/:userId/api-providers` | 查询用户 Provider 列表 |
| `GET` | `/api/v1/users/:userId/api-providers/:providerId` | 查询单个 Provider |
| `PATCH` | `/api/v1/users/:userId/api-providers/:providerId/status` | 更新 `enabled`/`disabled` 状态 |
| `POST` | `/api/v1/users/:userId/api-providers/:providerId/models` | 在 Provider 下创建 Model |
| `GET` | `/api/v1/users/:userId/models?capability=...` | 按八类能力标签查询模型 |
| `GET` | `/api/v1/users/:userId/models/:modelId` | 查询单个 Model |
| `POST` | `/api/v1/users/:userId/model-routing-rules` | 创建任务默认/备用模型规则 |
| `GET` | `/api/v1/users/:userId/model-routing-rules` | 查询用户的路由规则 |
| `GET` / `PATCH` | `/api/v1/users/:userId/model-routing-rules/:taskType` | 查询或局部更新指定任务规则 |
| `POST` | `/api/v1/users/:userId/model-router/select` | 根据 `taskType` 返回本地规则选择结果，不调用模型 |

Provider 保存 Base URL、接口格式、启停与测试状态；Model 保存名称、类型、八类能力标签、费用说明与测试状态。六类可路由任务为 `chat`、`long_text`、`image`、`video`、`audio`、`search`；`vision` 与 `embedding` 只作为目录能力。每个用户/任务只有一条规则，默认与备用 Model 必须属于该用户并支持任务。Router 优先默认模型，默认 Provider 停用时使用已配置且 Provider 启用的备用模型；规则不存在或停用时使用稳定目录回退，显式启用规则不可用时返回失败。

Provider 响应只暴露 API Key 的 `not_configured`、`secure_store_required`、`writeSupported=false` 状态，不接受或返回真实 Key、Token、Secret 或凭据引用。Provider/Model 测试状态当前固定为 `not_tested`，没有真实连接测试接口。Router 响应包含任务类型、选择规则、来源、Model 描述及 `modelCall`/`externalApiCall=not_performed`，不包含模型回复，也不产生外部请求。Router 与 Context、SubjectState、Assistant Global Settings 保持数据与执行边界。

Context 数据顺序已形成基础接口；以下模型调用、格式转换与实际返回仍为后续真实接入契约：

上下文装配遵循以下逻辑顺序：系统安全规则、全局设定、主体状态、未解决事件、近期对话、相关长期记忆、用户本轮消息。

模型返回逻辑上包含：

- 给用户的回复
- 状态更新

状态更新至少覆盖当前情绪、强度、变化原因、未解决事件和下一轮连续性约束。

## 权限与错误原则

当前 Permission 接口：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `POST` | `/api/v1/users/:userId/permissions` | 创建主体、资源、操作范围的权限规则 |
| `GET` | `/api/v1/users/:userId/permissions` | 按主体、资源类型、资源 ID、操作或状态筛选规则 |
| `GET` | `/api/v1/users/:userId/permissions/:permissionId` | 查询单个权限规则 |
| `PATCH` | `/api/v1/users/:userId/permissions/:permissionId` | 更新权限等级或 `active`/`inactive` 状态 |
| `DELETE` | `/api/v1/users/:userId/permissions/:permissionId` | 将权限规则标记为 `deleted` |
| `POST` | `/api/v1/users/:userId/permission-checks` | 输入主体、资源与操作，返回 `allow`、`ask` 或 `deny` |

Checker 只进行完全匹配和平台判断，不执行资源动作。`allow_once` 在首次成功判断后转为 `consumed`；权限变更与 `permission_changed` 事件同事务提交。`canAsk` 只描述是否允许后续申请，不等于已经创建授权申请流程。

当前 Security、Confirmation 和 AuditLog 接口：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/api/v1/security/sensitive-data-categories` | 返回五类分类元数据，不返回敏感正文 |
| `POST` | `/api/v1/users/:userId/security-checks` | 按 Permission、风险和确认返回 `allow`、`confirm` 或 `deny` |
| `GET` | `/api/v1/users/:userId/confirmations/:confirmationId` | 查询用户范围内的具体操作确认 |
| `PATCH` | `/api/v1/users/:userId/confirmations/:confirmationId` | 批准或拒绝待确认记录，不执行资源 |
| `GET` | `/api/v1/users/:userId/audit-logs` | 按主体、操作、资源、风险、结果和数量筛选审计 |
| `GET` | `/api/v1/users/:userId/audit-logs/:auditLogId` | 查询用户范围内的单条审计 |

安全检查的 `operationType` 当前只允许：`general_access`、`permission_change`、`api_configuration_change`、`privacy_access_request`、`payment_operation`、`device_control`、`sensitive_data_access`、`data_deletion`。

确认决定请求体固定为 `{ "decision": "approve" }` 或 `{ "decision": "reject" }`。审计列表查询参数固定为 `subjectId`、`operationType`、`resourceType`、`result`、`riskLevel`、`limit`。

安全检查只接受 `subjectId`、`resourceType`、平台不透明 `resourceId`、`action`、`operationType`、`sensitiveDataCategories` 和可选 `confirmationId`，会拒绝额外字段和任意 payload。资源 ID 校验会启发式拦截常见凭据形态，但不等同于完整 DLP；正式接入资源时必须使用可信服务端资源注册表，不能把敏感值塞入 ID。中风险 `user_defined` 在正式服务端偏好完成前安全默认需要确认。响应包含 Permission 结果、风险原因、确认状态和审计 ID；`preflightPassed` 仅表示预检通过，`executionAllowed` 固定为 `false`，`executionStatus` 固定为 `not_executed`，不会产生支付、设备、私域或外部调用。

AuditLog 没有客户端写入、更新或删除接口；Confirmation 批准结果绑定 Permission 快照、完整作用域和安全策略指纹，五分钟后过期，并在安全检查中单次消费。错范围、过期和重放尝试返回拒绝并生成最小审计。

- 未登录、主体不匹配或权限不足时不能返回受保护数据。
- 外部能力不可用时，应明确失败，不伪造成功结果。
- 危险操作需要具体确认，不能只依赖长期授权。
- 接口错误不得泄露密钥、密码、内部凭据或其他用户数据。
- 重试、冲突处理和接口版本规则需要在实现前补充，但本文件暂不指定方案。

## 变更管理

- 正式接口变更需要同步更新本文件、工程日志和更新记录。
- 影响架构边界、权限或数据模型的变更需要新增 ADR。
- 前端模拟数据结构不能直接被视为最终接口契约。
- 未经规划确认，不新增总规划之外的接口能力。

## 第一版验收方向

- 手机前端只通过平台接口访问受控数据。
- 用户和主体信息贯穿需要隔离的请求。
- 连续性、模型和外部能力各自保持独立边界。
- 权限失败、服务不可用和危险操作具有明确结果。
- 接口不会返回密钥或其他用户数据。
