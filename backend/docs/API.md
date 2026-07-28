# Vio Live 后端 API 说明

## 状态与边界

- 当前阶段：手机、家电与穿戴设备适配层
- 后端版本：`0.12.0`
- 业务前缀：`/api/v1`
- 开发服务默认地址：`http://127.0.0.1:8787`
- 当前没有真实登录、会话或认证，所有用户/主体归属检查仍是开发期请求范围，不能直接公开部署。

前端开发服务器通过同源 `/api` 与 `/health` 代理访问后端，不在后端开放通配 CORS。前端 `src`、页面和 mock 本阶段没有修改，也没有接入模型配置 API；当前真实页面连接仍只包含独立 API 客户端和应用启动健康握手。

## 统一返回结构

所有 JSON 响应至少包含以下四个字段：

```json
{
  "success": true,
  "data": {},
  "error": null,
  "timestamp": "2026-07-27T00:00:00.000Z"
}
```

列表接口可额外包含：

```json
{
  "meta": {
    "count": 2
  }
}
```

失败响应使用：

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "validation_error",
    "message": "Request data is invalid.",
    "requestId": "00000000-0000-0000-0000-000000000000",
    "details": {}
  },
  "timestamp": "2026-07-27T00:00:00.000Z"
}
```

- `timestamp` 为后端生成的 UTC ISO-8601 时间。
- `details` 只在存在安全的结构化错误详情时返回。
- 响应头同时返回 `x-request-id`；错误体内的 `requestId` 与其一致。
- 创建成功使用 `201` 并返回 `Location`；一般查询/更新使用 `200`。
- 当前错误状态包括 `400`、`404`、`409`、`413`、`415` 和 `500`。

## 请求规则

- 有请求体的接口必须使用 `Content-Type: application/json`。
- 请求体必须是 JSON 对象，最大 1 MiB。
- ID 是平台不透明字符串；路径参数必须进行 URL 编码。
- `basicSettings` 当前接受普通 JSON 对象，最大 32 KiB；它是阶段性基础结构，不代表前端 mock 已成为稳定业务模型。
- Message `content` 必须是非空字符串，统一换行为 `\n`，最多 32768 个字符。
- ConversationSummary `content` 最多 16384 字符，且必须包含 1—100 个可验证来源引用。
- `state_update.intensity` 是 `0`—`1` 的有限数字；当前状态和连续性约束只保存调用方提交的数据，不由后端推演。
- `expressionStyle` 接受普通 JSON 对象；`longTermRequirements` 和 `prohibitions` 各最多 100 个非空、去重字符串。全局设定不得包含模型密钥或被解释为平台安全规则替代物。
- Tool 的 `inputDefinition` / `outputDefinition` 只接受 JSON Schema 风格的普通对象，用于描述未来输入输出，不接受实际 Tool 输入、命令、处理器地址或执行结果。
- MCP `serviceUrl` 只保存注册元数据，必须为 HTTP(S)，不得包含用户名、密码、URL 片段或 Key/Token/Secret 类查询参数；保存不会发起连接。
- Device Registry 不接受外部设备 ID、位置、凭据、厂商 Token 或真实状态；设备操作准备只接受能力代码与可选 Confirmation ID，不接受温度、开关、摄像头命令或任意控制参数。
- 不得在请求、资源 ID、日志或文档中放入 API Key、密码、Token 或其他秘密值。

## 服务接口

### 健康检查

| 方法 | 路径 | 参数 | 返回 `data` |
| --- | --- | --- | --- |
| `GET` | `/` | 无 | `service`、`version`、`status` |
| `GET` | `/health` | 无 | `status`、`service`、`version`、`database` |

`/health` 只表示服务和开发数据库可用，不表示用户已经登录或认证。

## User API

### 创建用户

`POST /api/v1/users`

请求体：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `email` | 是 | 基础邮箱，按小写归一化；当前不是验证码登录 |
| `displayName` | 否 | 显示名称，最多 80 字符 |

返回用户的 `userId`、`email`、`displayName`、`status`、`createdAt` 和 `updatedAt`。重复邮箱返回 `409 conflict`。

### 查询用户

`GET /api/v1/users/:userId`

路径参数：`userId`。返回该 ID 对应的用户；不存在时返回 `404`。

### 获取开发期当前用户

`GET /api/v1/users/current`

请求头：

| 请求头 | 必填 | 说明 |
| --- | --- | --- |
| `x-vio-user-id` | 是 | 前端开发上下文中的用户 ID |

该请求头只是可替换的开发期用户选择，不是身份凭证、登录会话或授权。服务不会默认读取数据库中的第一位或最新用户。真实认证接入后应替换此解析方式。

## Subject API

### 创建 AI 主体

`POST /api/v1/users/:userId/subjects`

请求体：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `name` | 是 | 主体名称，最多 80 字符 |
| `avatarRef` | 否 | 头像资源引用；不是文件上传接口 |
| `basicSettings` | 否 | 基础设定 JSON 对象 |

### 查询主体列表

`GET /api/v1/users/:userId/subjects`

返回该用户的主体数组和 `meta.count`，按创建时间、主体 ID 稳定排序。

### 查询单个主体

`GET /api/v1/users/:userId/subjects/:subjectId`

同时校验用户与主体归属；跨用户读取与不存在的主体统一返回 `404`。

### 更新主体基础信息

`PATCH /api/v1/users/:userId/subjects/:subjectId`

请求体至少包含以下一个字段，且不接受其他字段：

| 字段 | 规则 |
| --- | --- |
| `name` | 非空字符串，最多 80 字符 |
| `avatarRef` | 字符串；传 `null` 或空字符串可清除头像引用 |
| `basicSettings` | 普通 JSON 对象，使用整对象替换，不做隐式深层合并 |

实际发生变化时，主体更新与一个只含 `changedFields` 的 `subject_updated` Event 在同一事务提交；无变化请求不更新时间，也不重复产生事件。

## AI Assistant Global Settings API

全局设定属于 `userId + subjectId` 范围，跨窗口长期生效。名称与头像继续复用 Subject 的唯一身份字段；人格、表达、关系、长期要求和禁止事项由一对一 `assistant_global_settings` 记录保存。

### 读取全局设定

`GET /api/v1/users/:userId/subjects/:subjectId/global-settings`

返回：

| 字段 | 说明 |
| --- | --- |
| `userId` / `subjectId` | 用户与主体复合归属 |
| `name` | 助手名称，来源于 Subject |
| `avatarRef` | 头像或标识资源引用，来源于 Subject |
| `personalityDescription` | 长期人格与基础定位描述 |
| `expressionStyle` | 表达方式配置 JSON 对象 |
| `relationshipDefinition` | 助手与用户的长期关系定义 |
| `longTermRequirements` | 用户明确设置的长期要求数组 |
| `prohibitions` | 助手禁止事项数组；不能削弱平台安全规则 |
| `createdAt` / `updatedAt` | 设定创建时间及身份/设定最后更新时间 |

### 更新全局设定

`PATCH /api/v1/users/:userId/subjects/:subjectId/global-settings`

请求体至少包含一个返回中的可编辑设定字段，不接受 `userId`、`subjectId`、时间、状态字段或 SubjectState 字段。`name` 最多 80 字符；`avatarRef` 最多 2048 字符并可用 `null` 清除；人格描述最多 8000 字符；关系定义最多 4000 字符；长期要求和禁止事项各最多 100 条，每条最多 1000 字符且不得重复。`expressionStyle` 会递归拒绝 API Key、Token、Secret、密码等明显秘密字段名。

更新只改变实际变化的字段；无变化请求保持原 `updatedAt` 且不重复产生 Event。Subject 身份字段、扩展设定和最小 `subject_updated` Event 在同一事务提交，任一步失败整体回滚。事件只记录 `changedFields`，不复制人格、关系、要求或禁止事项正文。

Global Settings 与 SubjectState 是不同数据层：前者是用户明确修改的长期静态配置，可原地更新；后者是带 MessageVersion/Event/ConversationSummary 来源的动态状态快照，只追加版本并由当前指针选择。更新全局设定不会创建、覆盖或切换 SubjectState，也不会调用模型或 continuity-engine。

## Conversation、Message 与 MessageVersion API

所有对话路由都嵌套在 `/users/:userId/subjects/:subjectId` 下。服务逐层校验 User、Subject、Conversation、Message 和 MessageVersion 的复合归属；跨用户、跨主体、跨对话或跨消息访问统一表现为资源不存在。该范围校验仍不是登录认证。

### Conversation

| 方法 | 路径 | 请求 | 返回 |
| --- | --- | --- | --- |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/conversations` | `{ "title": string }` | `201` Conversation 和 `Location` |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/conversations` | 无 | Conversation 数组和 `meta.count` |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId` | 无 | 单个 Conversation |

创建请求只接受 `title`，去除两端空白后必须非空且最多 200 字符。Conversation 返回：

```json
{
  "conversationId": "opaque-id",
  "userId": "opaque-id",
  "subjectId": "opaque-id",
  "title": "会话标题",
  "status": "active",
  "createdAt": "2026-07-27T00:00:00.000Z",
  "updatedAt": "2026-07-27T00:00:00.000Z",
  "lastActivityAt": "2026-07-27T00:00:00.000Z"
}
```

列表按 `lastActivityAt` 倒序稳定排列。当前没有归档更新、删除或重置接口。

### Message 当前版本投影

| 方法 | 路径 | 请求 | 返回 |
| --- | --- | --- | --- |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/messages` | `{ "senderType": "user" | "subject" | "system", "content": string }` | `201` Message 和 `Location` |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/messages` | 无 | 当前 Message 数组和 `meta.count` |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/messages/:messageId` | 无 | 单条 Message 当前投影 |

创建 Message 会同时创建 `changeReason=original`、`versionNumber=1` 的初始 MessageVersion，并原子设置 `currentVersionId`。Message 返回：

```json
{
  "messageId": "opaque-id",
  "userId": "opaque-id",
  "subjectId": "opaque-id",
  "conversationId": "opaque-id",
  "senderType": "user",
  "status": "active",
  "sequenceNumber": 1,
  "currentVersionId": "opaque-id",
  "currentVersionNumber": 1,
  "content": "当前版本正文",
  "createdAt": "2026-07-27T00:00:00.000Z",
  "updatedAt": "2026-07-27T00:00:00.000Z"
}
```

`sequenceNumber` 在同一 Conversation 内唯一且递增；列表只返回每条逻辑 Message 的当前版本投影，并按该序号升序排列。当前不提供 Message 删除、隐藏、分支或重置。

`senderType=subject` 和后述“重生成”请求中的正文都由开发调用方显式提交。它们只表示被记录为主体消息，不表示后端调用过 AI、Model Router、Provider 或 continuity-engine。`system` 消息可以创建，但不能通过当前编辑或重生成接口追加版本。

### 编辑、重生成与版本历史

| 方法 | 路径 | 请求 | 返回 |
| --- | --- | --- | --- |
| `PATCH` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/messages/:messageId` | `{ "baseVersionId": string, "content": string }` | `200` 新建的 `edited` MessageVersion |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/messages/:messageId/regenerations` | `{ "baseVersionId": string, "content": string }` | `201` 新建的 `regenerated` MessageVersion 和 `Location` |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/messages/:messageId/versions` | 无 | 按版本号升序的全部版本和 `meta.count` |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/messages/:messageId/versions/:messageVersionId` | 无 | 单个 MessageVersion |

- 只有 `senderType=user` 的消息可以编辑；只有 `senderType=subject` 的消息可以记录重生成版本，类型不匹配返回 `409 conflict`。
- `baseVersionId` 必须等于 Message 当前的 `currentVersionId`。陈旧或并发落后的请求返回 `409`，不产生新版本、事件或部分更新。
- 新正文必须与当前正文不同；请求只接受 `baseVersionId` 和 `content`。
- 编辑与重生成都插入新行，旧版本正文不原地覆盖；数据库触发器也禁止覆盖 MessageVersion `content`。
- `parentVersionId` 固定指向本消息的基准版本，不能跨用户、主体、Conversation 或 Message 引用。
- 版本插入、Message 当前指针、Conversation 最近活动时间和对应 Event 在同一事务提交。

MessageVersion 返回：

```json
{
  "messageVersionId": "opaque-id",
  "messageId": "opaque-id",
  "userId": "opaque-id",
  "subjectId": "opaque-id",
  "conversationId": "opaque-id",
  "versionNumber": 2,
  "senderType": "user",
  "changeReason": "edited",
  "content": "新版本正文",
  "parentVersionId": "opaque-id",
  "createdAt": "2026-07-27T00:00:00.000Z",
  "isCurrent": true
}
```

当前只实现 `original`、`edited`、`regenerated`。分支、删除标记、窗口重置、上下文修订和模型生成元数据仍未实现；ConversationSummary、SubjectState 与只读 Context 基础见后续章节，它们不改变 MessageVersion 语义。

### 对话软件事件

Event 类型由五类扩展为九类：

- `appearance_changed`
- `subject_updated`
- `permission_changed`
- `life_record_created`
- `device_changed`
- `conversation_created`
- `message_created`
- `message_updated`
- `message_regenerated`

Conversation/Message 服务自动生成的四类新增 Event 只保存用户/主体归属及 Conversation、Message、MessageVersion、父版本、序号、发送者或状态等必要引用。自动事件不保存 Conversation `title` 或 Message `content`，也不会触发模型、上下文装配或连续性处理。Event 当前仍没有消费者。

## ConversationSummary API

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/summaries` | 保存带来源引用的不可变会话摘要 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/summaries?limit=50` | 按版本倒序查询该会话摘要 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/summaries/:summaryId` | 查询单个摘要及其来源 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/cross-window-summaries?limit=5` | 查询同一主体其他会话各自的最新摘要 |

创建请求只接受：

```json
{
  "content": "上一窗口形成了一个尚未完成的任务。",
  "sources": [
    {
      "type": "message_version",
      "messageId": "opaque-id",
      "messageVersionId": "opaque-id"
    },
    {
      "type": "event",
      "eventId": "opaque-id"
    }
  ]
}
```

- `message_version` 必须属于当前用户、主体和 Conversation；`event` 必须属于当前用户和主体。
- 来源不能为空、不能重复；摘要与全部来源在同一事务提交。
- 服务端生成 `summaryId`、会话内单调 `summaryVersion`、`status=active` 和 `createdAt`。
- 摘要是开发调用方显式提交的记录；后端不生成、改写或评价摘要，不调用模型。
- 数据库禁止普通更新和直接删除摘要或来源。正式删除仍需后续保留策略。
- 跨窗口接口排除当前 Conversation，并为每个其他 Conversation 只返回最新摘要，不加载全部历史消息。

## SubjectState / state_update API

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/state-updates` | 接收并保存新的不可变主体状态版本 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/state-updates?limit=50` | 按版本倒序查询状态历史 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/state-updates/:subjectStateId` | 查询单个状态版本 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/state` | 查询当前状态；没有记录时 `data=null` |

请求体：

```json
{
  "currentState": {
    "focus": "继续未完成任务"
  },
  "emotion": "focused",
  "intensity": 0.72,
  "changeReason": "来源对话建立了仍需延续的任务。",
  "unresolvedEventIds": ["opaque-event-id"],
  "continuityConstraints": ["下一窗口继续保留该任务。"],
  "source": {
    "type": "conversation_summary",
    "conversationId": "opaque-id",
    "summaryId": "opaque-id"
  }
}
```

`source.type` 支持：

- `message_version`：同时提交 `conversationId`、`messageId`、`messageVersionId`。
- `event`：提交 `eventId`。
- `conversation_summary`：同时提交 `conversationId`、`summaryId`。

所有来源和 `unresolvedEventIds` 都必须属于相同用户与主体。SubjectState 使用主体内单调 `stateVersion` 和独立当前指针；创建新版本只切换指针，不覆盖旧状态。写入状态、未解决事件引用和当前指针在同一事务提交。接口只是保存调用方提供的 `state_update`，没有模型响应解析、状态演化算法或 continuity-engine 调用。

## Context API

`GET /api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/context`

可选查询参数：

| 参数 | 默认 | 范围 | 作用 |
| --- | --- | --- | --- |
| `recentMessageLimit` | `20` | `1`—`50` | 读取当前 Conversation 最近消息 |
| `crossWindowSummaryLimit` | `5` | `0`—`20` | 读取同一主体其他 Conversation 的最新摘要；`0` 表示不读取 |

响应按 `assemblyOrder` 明确表达以下层级：

1. `systemSafetyRules`：当前只保留结构位置，`status=reserved`，不伪造提示词。
2. `subjectGlobalSettings`：Subject 名字、头像引用和基础设定。
3. `currentSubjectState`：当前 SubjectState；尚无记录时为 `null`。
4. `unresolvedEvents`：当前状态引用的 Event 最小投影，不包含任意上下文扩展数据。
5. `recentMessages`：当前窗口最近消息；若最后一条是用户消息，会移到第 8 项避免重复。
6. `crossWindowSummaries`：其他窗口每个 Conversation 的最新可追溯摘要。
7. `longTermMemory`：当前固定为 `status=not_implemented`，不读取或伪造 Memory。
8. `currentUserMessage`：当前窗口最后一条用户消息；不满足时为 `null`。

`execution` 固定标记 `modelCall`、`externalApiCall`、`continuityEngineCall` 为 `not_performed`。该接口不持久化装配结果、不生成模型格式、不消耗 Token，也不触发 Event 或外部请求。

## Dashboard API

`GET /api/v1/users/:userId/subjects/:subjectId/dashboard`

不接受请求体。返回：

```json
{
  "user": {},
  "subject": {},
  "basicStatus": {
    "userStatus": "active",
    "subjectStatus": "active",
    "ready": true,
    "continuityStatus": "not_available"
  }
}
```

- `ready` 只表示当前用户和主体均为 `active`。
- `continuityStatus=not_available` 明确表示独立 continuity-engine 尚未接入；本阶段新增的 SubjectState 基础存储不会把 Dashboard 状态冒充为引擎可用。
- 本接口不会返回工作台 mock、设备状态、待办、提醒或模型结果，也不会调用外部服务。

## APIProvider API

### 创建 Provider

`POST /api/v1/users/:userId/api-providers`

```json
{
  "displayName": "开发模型服务",
  "providerType": "custom",
  "baseUrl": "https://models.example/v1",
  "interfaceFormat": "custom_http",
  "status": "enabled"
}
```

- `providerType`：`openai`、`claude`、`glm`、`custom`，只表示本地配置分类。
- `interfaceFormat`：`openai_compatible`、`anthropic_messages`、`glm_compatible`、`custom_http`；省略时按 Provider 类型取得默认值。
- `status`：`enabled` 或 `disabled`，默认 `enabled`。
- `baseUrl` 只保存配置，必须为 HTTP(S)，不得包含用户名、密码、URL 片段或 Key/Token/Secret 类查询参数。
- `testStatus` 由服务初始化为 `not_tested`，本阶段没有真实连通性测试或客户端写入入口。

响应中的凭据状态固定为：

```json
{
  "credentials": {
    "apiKey": {
      "status": "not_configured",
      "storage": "secure_store_required",
      "writeSupported": false
    }
  }
}
```

请求体中的 API Key、Token、Secret、凭据或安全引用字段都会被拒绝；响应不会出现 `apiKeySecretRef` 或密钥原文。

### 查询与启停 Provider

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/api/v1/users/:userId/api-providers` | 查询用户范围 Provider 列表 |
| `GET` | `/api/v1/users/:userId/api-providers/:providerId` | 查询单个 Provider |
| `PATCH` | `/api/v1/users/:userId/api-providers/:providerId/status` | 使用 `{ "status": "enabled" }` 或 `disabled` 更新启停状态 |

## Model API

### 创建 Model

`POST /api/v1/users/:userId/api-providers/:providerId/models`

```json
{
  "modelName": "vio-multimodal",
  "modelType": "multimodal",
  "capabilities": ["chat", "long_text", "image", "video", "audio", "search"],
  "costDescription": "仅为人工配置说明；当前不产生费用。"
}
```

- 能力标签支持 `chat`、`long_text`、`vision`、`image`、`video`、`audio`、`search`、`embedding`，去重后按固定顺序返回。
- `costDescription` 是说明文本，不是价格计算、账单或预算控制。
- Model 响应内嵌所属 Provider 的 Base URL、接口格式、启停和测试状态。
- Model `testStatus` 固定初始化为 `not_tested`；当前没有客户端修改或真实探测接口。

查询接口：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/api/v1/users/:userId/models?capability=chat` | 按单一能力标签查询目录；Provider 停用不会隐藏配置 |
| `GET` | `/api/v1/users/:userId/models/:modelId` | 按用户归属查询单个 Model |

## Model Routing Rule 与 Router API

任务类型严格限定为 `chat`、`long_text`、`image`、`video`、`audio`、`search`。`vision` 和 `embedding` 仍可作为目录能力查询标签，但当前不属于可配置路由任务。

### 创建、查询与更新规则

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `POST` | `/api/v1/users/:userId/model-routing-rules` | 创建该用户某任务的唯一规则 |
| `GET` | `/api/v1/users/:userId/model-routing-rules` | 查询规则列表 |
| `GET` | `/api/v1/users/:userId/model-routing-rules/:taskType` | 查询指定任务规则 |
| `PATCH` | `/api/v1/users/:userId/model-routing-rules/:taskType` | 局部更新默认模型、备用模型或启停状态 |

创建请求：

```json
{
  "taskType": "chat",
  "defaultModelId": "model-default",
  "fallbackModelId": "model-fallback",
  "status": "enabled"
}
```

更新请求可包含 `defaultModelId`、`fallbackModelId`、`status` 中至少一项；传入 `fallbackModelId: null` 可清除备用模型。默认和备用模型必须属于同一用户、具备对应任务能力且不能相同。每个用户的每类任务只能有一条规则，重复创建返回 `409`。

### 选择模型

`POST /api/v1/users/:userId/model-router/select`

```json
{
  "taskType": "chat"
}
```

选择规则：

1. 启用规则存在且默认模型的 Provider 启用时，返回默认模型并标记 `selectionSource=default`。
2. 默认 Provider 停用、备用模型存在且其 Provider 启用时，返回备用模型并标记 `selectionSource=fallback`。
3. 显式启用规则的两个模型均不可用时返回 `404`，不静默绕过规则。
4. 规则不存在或已停用时，按 Provider/Model 稳定创建顺序返回首个启用 Provider 下的能力匹配项，并标记 `selectionSource=catalog_fallback`。

Router 的 `execution` 始终返回 `modelCall=not_performed` 与 `externalApiCall=not_performed`。测试状态只是保留元数据，不被当成真实服务可用性证明。本模块不读取 Context，不装配提示词，不读取或修改 SubjectState、Assistant Global Settings，也不触发模型、MCP、Tool 或 continuity-engine。

## Tool、MCP、Skill 与 Plugin Registry API

四类 Registry 都属于用户范围，`status` 只支持 `enabled`、`disabled`，创建时默认 `disabled`。`enabled` 仅表示注册项可进入能力选择，不表示 MCP 已连接、Plugin 已安装或 Skill/Tool 可执行。同一用户内同类注册项名称唯一；所有读取和更新都校验用户归属。

### Tool Registry

`POST /api/v1/users/:userId/tools`

```json
{
  "name": "Local notes reader",
  "description": "未来只读笔记能力的注册定义。",
  "toolType": "read_only",
  "inputDefinition": {
    "type": "object",
    "properties": {
      "noteId": { "type": "string" }
    }
  },
  "outputDefinition": {
    "type": "object",
    "properties": {
      "content": { "type": "string" }
    }
  },
  "permissionAction": "read"
}
```

- `toolType` 是小写注册分类标识，只允许字母、数字、下划线和连字符。
- `permissionAction` 支持 Permission 的八种操作，默认 `execute`。
- 响应返回 `permissionRequirement`，资源类型固定为 `tool`，资源 ID 为当前 `toolId`。
- `executionSupport` 固定为 `not_implemented`。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/api/v1/users/:userId/tools?status=enabled` | 按可选状态查询 Tool 条目 |
| `GET` | `/api/v1/users/:userId/tools/:toolId` | 查询单个 Tool 条目 |
| `PATCH` | `/api/v1/users/:userId/tools/:toolId/status` | 使用 `{ "status": "enabled" }` 或 `disabled` 更新注册状态 |

### MCP Registry

`POST /api/v1/users/:userId/mcp-registrations`

```json
{
  "name": "Example MCP registry",
  "serviceUrl": "https://mcp.example.test/v1",
  "capabilityDescription": "未来 MCP 能力说明。",
  "permissionAction": "connect"
}
```

- `permissionAction` 默认 `connect`；响应内 `permissionConfiguration.resourceType=mcp`。
- `connectionStatus` 固定为 `not_connected`，`connectionSupport` 固定为 `not_implemented`。
- 接口不执行 DNS、HTTP、握手、能力发现、认证或任何 MCP 协议行为。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/api/v1/users/:userId/mcp-registrations?status=enabled` | 按可选状态查询 MCP 条目 |
| `GET` | `/api/v1/users/:userId/mcp-registrations/:mcpId` | 查询单个 MCP 条目 |
| `PATCH` | `/api/v1/users/:userId/mcp-registrations/:mcpId/status` | 更新注册状态，不建立或断开连接 |

### Skill Registry

`POST /api/v1/users/:userId/skills`

```json
{
  "name": "Meeting outline skill",
  "description": "未来可复用流程说明。",
  "applicableScenarios": ["meeting preparation", "agenda drafting"],
  "version": "0.1.0",
  "permissionAction": "execute"
}
```

- 场景列表最多 50 项且不能重复；本阶段只保存说明，不保存或运行流程代码。
- `permissionAction` 默认 `execute`；响应内 `permissionRequirement.resourceType=skill`。
- `executionSupport` 固定为 `not_implemented`。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/api/v1/users/:userId/skills?status=enabled` | 按可选状态查询 Skill 条目 |
| `GET` | `/api/v1/users/:userId/skills/:skillId` | 查询单个 Skill 条目 |
| `PATCH` | `/api/v1/users/:userId/skills/:skillId/status` | 更新注册状态，不执行 Skill |

### Plugin Registry

`POST /api/v1/users/:userId/plugins`

```json
{
  "name": "Calendar bridge metadata",
  "description": "未来插件的注册信息。",
  "version": "0.1.0",
  "dependencies": ["calendar-contract@1"]
}
```

- 依赖列表最多 50 项且不能重复，只作为普通元数据保存。
- `installationStatus` 固定为 `not_installed`，`installationSupport` 固定为 `not_implemented`。
- Plugin 当前不属于 Permission 可执行资源；响应明确返回 `permissionRequirement.required=false` 和 `reason=registry_metadata_only`。后续安装/加载阶段必须另行设计权限和供应链安全，不能从当前 `enabled` 推导为已安装。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/api/v1/users/:userId/plugins?status=enabled` | 按可选状态查询 Plugin 条目 |
| `GET` | `/api/v1/users/:userId/plugins/:pluginId` | 查询单个 Plugin 条目 |
| `PATCH` | `/api/v1/users/:userId/plugins/:pluginId/status` | 更新注册状态，不安装、卸载或加载代码 |

## Capability 与 Tool 执行准备 API

### 统一能力查询

`GET /api/v1/users/:userId/subjects/:subjectId/capabilities`

可选查询参数：

| 参数 | 允许值 | 作用 |
| --- | --- | --- |
| `category` | `tool`、`mcp`、`skill`、`plugin` | 只返回一个能力分类 |
| `status` | `enabled`、`disabled` | 只返回一个注册状态 |

每项能力返回注册配置、分类、Permission 预览、可选状态和最近使用记录。Permission 预览使用主体、资源和操作精确匹配，不消费 `allow_once`。Tool 返回最近一条使用准备记录；其他分类当前返回 `recentUsage=null`。

`availability.state` 可能为：

- `disabled`：注册项停用。
- `blocked_by_permission`：Permission 返回拒绝。
- `confirmation_required`：Permission 要求询问。
- `registered_only`：注册启用且 Permission 允许，可供后续选择，但 `executionAvailable` 仍为 `false`。
- `registry_only`：Plugin 只有元数据，不可安装或执行。

### Tool 执行准备

`POST /api/v1/users/:userId/subjects/:subjectId/tools/:toolId/execution-preparations`

请求体只能为空对象，或在批准现有 Confirmation 后提交：

```json
{
  "confirmationId": "opaque-confirmation-id"
}
```

执行顺序固定为：

```text
Tool 注册状态 → Permission → Security 风险与 Confirmation → 使用记录
```

响应中的 `preparationStatus` 为：

- `ready`：权限和安全门槛已满足；仍未执行 Tool。
- `confirmation_required`：需要按现有 Confirmation API 确认；仍未执行 Tool。
- `denied`：Permission 或 Security 拒绝；仍未执行 Tool。

每次准备都会保存 Tool 使用记录，并关联 Security 生成的 AuditLog。`execution.supported=false`、`execution.status=not_executed`、`externalCalls=not_performed` 固定不变；消耗记录固定为 0 毫秒计费时长、0 次外部调用、0 Token、无账单金额。接口拒绝 `input`、`arguments`、`command`、URL 或其他实际执行载荷。

### Tool 使用记录

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/tool-usage-records?toolId=:toolId&limit=50` | 按可选 Tool 和数量查询主体使用准备记录 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/tool-usage-records/:toolUsageId` | 查询单条主体范围的使用准备记录 |

记录包含时间、用户、调用主体、Tool、Permission/Security 决策、准备结果、固定未执行摘要、零外部消耗与关联审计 ID，不保存真实调用输入、输出、秘密或第三方响应。

## Device Registry 与 Adapter API

### 未来 Adapter 契约

`GET /api/v1/device-adapters`

返回 `xiaomi`、`midea`、`apple`、`android`、`generic` 五个 Adapter 描述。统一未来方法为：

- `connect`
- `disconnect`
- `readStatus`
- `executeCapability`

当前每个方法都返回 `supported=false`；Adapter 固定 `implementationStatus=not_implemented`、`connectionSupported=false`、`controlSupported=false`、`externalApiCallsSupported=false`。该查询只读取本地常量，不加载 SDK、不发现设备、不访问厂商网络。

### 创建 Device Registry 条目

`POST /api/v1/users/:userId/devices`

```json
{
  "deviceType": "air_conditioner",
  "brand": "midea",
  "name": "Living room air conditioner",
  "status": "disabled",
  "capabilities": ["view_status", "power", "adjust_parameter"]
}
```

设备类型严格限定为：

- `phone`：手机
- `watch`：手表/穿戴设备
- `air_conditioner`：空调
- `robot_vacuum`：扫地机器人
- `washing_machine`：洗衣机
- `camera`：摄像头
- `appliance`：通用家电

`brand` 统一保存为小写注册标识；`xiaomi`、`midea`、`apple`、`android` 分派到同名未来 Adapter，其他品牌分派到 `generic`。这只是元数据分派，不表示厂商已支持。

`status` 只支持 `enabled`、`disabled`，默认 `disabled`。Device `enabled` 只允许进入安全准备；响应始终包含：

```json
{
  "connectionStatus": "not_connected",
  "stateStatus": "not_observed",
  "controlSupport": "not_implemented"
}
```

创建与 `device_changed` Event 在同一事务提交。Event 的 `changeType=connection_registered` 只表示设备接入元数据已登记，绝不表示真实连接成功。

### Device Capability

| 能力 | 含义 | Permission action |
| --- | --- | --- |
| `view_status` | 未来查看设备状态 | `read` |
| `power` | 未来开关设备 | `control` |
| `adjust_parameter` | 未来调节参数 | `control` |
| `get_data` | 未来获取设备数据 | `read` |

设备至少声明一项能力且不能重复。响应中的 `capabilityDefinitions` 为每项能力返回 Device Permission 要求，资源 ID 固定为当前 `deviceId`；`executionSupport` 固定为 `not_implemented`。

### 查询与启停设备注册

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/api/v1/users/:userId/devices?deviceType=phone&status=enabled&brand=apple` | 按可选类型、状态与品牌查询设备 |
| `GET` | `/api/v1/users/:userId/devices/:deviceId` | 按用户归属查询单个设备 |
| `PATCH` | `/api/v1/users/:userId/devices/:deviceId/status` | 使用 `{ "status": "enabled" }` 或 `disabled` 更新注册状态 |

注册状态实际变化时生成 `device_changed` Event，`changeType=registry_status_changed`。无变化更新不写入事件。更新注册状态不会连接、断开或查询设备。

## Device Permission、操作准备与日志 API

### 创建设备授权

`POST /api/v1/users/:userId/devices/:deviceId/authorizations`

```json
{
  "subjectId": "opaque-subject-id",
  "capability": "view_status",
  "permissionLevel": "always_allow"
}
```

可选 `status` 仍只支持 Permission 的 `active`、`inactive`。服务先验证用户、主体、Device 及能力归属，再使用能力映射出的 `read` 或 `control` 创建精确 `resourceType=device` Permission。Permission、`permission_changed` Event、Permission AuditLog 和 `authorization_changed` Device Event 在同一最外层事务提交。

同一设备的多个能力如果映射到相同 action，会共享同一 Device Permission 范围；当前 Permission 唯一性仍按用户、主体、设备 ID 与 action，而不是按能力名称。

### 设备操作准备

`POST /api/v1/users/:userId/subjects/:subjectId/devices/:deviceId/operation-preparations`

首次请求：

```json
{
  "capability": "view_status"
}
```

批准现有 Confirmation 后：

```json
{
  "capability": "view_status",
  "confirmationId": "opaque-confirmation-id"
}
```

固定流程：

```text
Device 注册启用
→ 能力已声明
→ Device Permission
→ Security(device_control)
→ Confirmation
→ device_changed(operation_requested)
→ DeviceOperationLog(not_executed)
```

所有设备能力当前都通过 `operationType=device_control` 进入 Security，因此风险等级为 `critical`，即使已有 `always_allow` 也必须每次确认。Permission 拒绝不能被 Confirmation 绕过。

响应 `preparationStatus` 为 `ready`、`confirmation_required` 或 `denied`。即使 `ready`，以下字段也固定不变：

```json
{
  "execution": {
    "supported": false,
    "status": "not_executed",
    "deviceCall": "not_performed",
    "vendorApiCall": "not_performed",
    "reason": "device_adapter_not_implemented"
  }
}
```

接口拒绝 `parameters`、`value`、`command`、`payload` 或任何实际设备控制数据。每次准备与 Security AuditLog、`operation_requested` Device Event 和 DeviceOperationLog 同一事务提交，任一步失败全部回滚。

### 设备操作日志

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/device-operation-logs?deviceId=:deviceId&capability=view_status&limit=50` | 按可选设备、能力与数量查询日志 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/device-operation-logs/:deviceOperationLogId` | 查询单条主体范围日志 |

日志记录用户、主体、设备、能力、Permission action、时间、Permission/Security 决策、风险、准备结果、固定未执行摘要，以及 Event/AuditLog 引用。它不保存厂商请求、控制参数、摄像头内容、健康数据、位置、真实设备状态或第三方响应。

### Device Event 范围

当前沿用 `device_changed`，由 Device Service 生成四种最小 `changeType`：

- `connection_registered`：登记设备连接元数据，不代表真实连接。
- `authorization_changed`：通过设备授权入口创建 Permission。
- `registry_status_changed`：设备注册启停变化，不代表物理状态变化。
- `operation_requested`：发生权限/安全准备请求，不代表执行。

所有 Device Event 都明确包含 `connectionStatus=not_connected` 和 `executionStatus=not_executed`，不复制名称、控制参数、设备数据或秘密。

## 前端连接

- API 客户端位于 `src/api/`，页面组件不直接散落 `fetch`。
- Vite 开发代理默认转发到 `http://127.0.0.1:8787`，可使用无秘密的 `VITE_BACKEND_PROXY_TARGET` 覆盖。
- 应用入口启动时非阻塞访问 `/health`；后端不可用不会改变或阻断当前 mock 页面。
- 当前页面仍未将登录、首次设置、工作台或对话展示替换为真实数据，mock 文件全部保留。

完整实际路由清单见 [`../README.md`](../README.md)；Event、Provider/Model、Permission、Security、Confirmation、AuditLog 与扩展能力的稳定规划契约见 [`../../docs/后端/12-API与事件契约.md`](../../docs/后端/12-API与事件契约.md) 和 [`../../docs/后端/07-扩展能力与设备适配.md`](../../docs/后端/07-扩展能力与设备适配.md)。
