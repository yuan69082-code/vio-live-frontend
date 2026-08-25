# Subject Runtime Port v1

## 状态与范围

- 施工项：`R0-A｜Vio 后端主体运行时端口与边界契约冻结`
- 合同版本：`vio-subject-runtime-port/v1`
- 当前状态：R0-A 合同、状态机、None Adapter、适配器登记与纯本地测试已实现
- 未完成：R0 其余子项、现有聊天业务切换、Standalone 对话执行、Continuity Engine 适配器接线、第三方运行时实现
- 下一阶段边界：实际聊天编排按运行方式切换属于 R1，本文件不授权该施工

本端口是 Vio 自己的稳定后端合同，不属于 Continuity Engine，也不要求任何外部主体运行时存在。Vio Core 与 Continuity Engine 的进程、数据库、代码发布和启动生命周期互不依赖；Engine 只能通过可选适配器被选择。当前没有新增 HTTP 路由、数据库迁移或应用装配；正式业务仍沿用既有路径。

## 责任边界

| Vio Core 永久负责 | 可选外部主体运行时负责 |
| --- | --- |
| 账号、助手 | 可选主体状态 |
| 会话、消息与版本 | 可选主体连续性 |
| 模型与 Provider | 可选主体表达 |
| MCP、Skill、Plugin、Tool | 不拥有 Vio 账号、密钥或数据库 |
| 手机与设备 | 不替代 Vio 权限、安全和执行权 |
| 本地记忆与 Context | 不直接执行模型、工具或设备 |
| 权限、安全、工作流与生活数据 | 不直接写 Vio 业务事实 |
| 费用、导出、备份与恢复 | 只通过已协商的适配器合同交互 |

外部运行时是可选增强，不是 Vio 启动条件。每个主体未来最多选择零个或一个权威外部主体运行时；R0-A 只冻结接口，不实现选择、切换或业务接线。

## 运行方式与适配器

| 运行方式 | 适配器 | 当前合同状态 | 语义 |
| --- | --- | --- | --- |
| `none` | None Adapter | 已实现 | 没有外部运行时是合法状态，Vio 平台保持可用 |
| `external` | Continuity Engine Adapter | 已登记，尚未接到本端口 | 现有 v1.1/Capability 合同只属于该适配器 |
| `external` | 第三方 Adapter | 仅提供受校验入口 | 必须实现同一端口并通过版本协商，R0-A 不实现具体连接 |

适配器必须实现：

- `getManifest()`
- `getConnectionStatus()`
- `negotiateVersion()`
- `submitObservation()`
- `cancel()`
- `recover()`

## Adapter Manifest

所有对象都拒绝未知字段。Manifest 字段固定为：

| 字段 | 含义 |
| --- | --- |
| `portVersion` | 固定 `vio-subject-runtime-port/v1` |
| `adapterId` | 稳定适配器标识；`none` 与 `continuity-engine` 为保留值 |
| `adapterKind` | `none`、`continuity_engine` 或 `third_party` |
| `adapterVersion` | 适配器实现版本，不冒充外部运行时版本 |
| `runtimeMode` | `none` 或 `external` |
| `runtimeName` | 外部运行时名称；None Adapter 固定 `null` |
| `runtimeVersion` | 已知的外部运行时版本；未知时为 `null`，`ready/degraded` 时必须存在 |
| `supportedPortVersions` | 适配器支持的 Vio 端口版本 |
| `capabilities` | 经白名单验证的运行时能力 |
| `specializedContracts` | 仅属于该适配器的版本化合同；None Adapter 固定为空 |

能力白名单：

- `observation_input`
- `expression_result`
- `state_projection`
- `cancellation`
- `recovery`

外部适配器至少声明 `observation_input` 与 `expression_result`。None Adapter 不声明任何外部运行时能力。

## 版本协商

Vio 按自己的版本优先顺序选择双方第一个共同版本；无共同版本时返回 `incompatible / no_common_port_version`，不得猜测、强制兼容或降级字段。

| Vio 版本 | Adapter 版本 | 结果 |
| --- | --- | --- |
| `vio-subject-runtime-port/v1` | `vio-subject-runtime-port/v1` | `compatible` |
| `vio-subject-runtime-port/v1` | 仅 `vio-subject-runtime-port/v2` | `incompatible` |

Continuity Integration Contract `continuity-integration/v1.1` 不是本表中的 Vio Port 版本。它必须由 Continuity Engine Adapter 在自身内部翻译；该翻译和业务接线属于 R1。

## 连接状态机

状态白名单：

- `disconnected`
- `connecting`
- `ready`
- `degraded`
- `incompatible`
- `paused`
- `reconnecting`

关键转换：

| 起点 | 事件 | 终点 |
| --- | --- | --- |
| `disconnected` | `connect_requested` | `connecting` |
| `connecting` | `handshake_succeeded` | `ready` |
| `connecting/ready` | `runtime_degraded` | `degraded` |
| `connecting/ready/degraded/reconnecting` | `compatibility_failed` | `incompatible` |
| 任一已连接过程 | `runtime_disconnected` | `disconnected` |
| `disconnected/degraded` | `reconnect_requested` | `reconnecting` |
| `reconnecting` | `reconnect_succeeded` | `ready` |
| `reconnecting` | `reconnect_failed` | `degraded` |
| 可运行状态 | `pause_requested` | `paused` |
| `paused` | `resume_requested` | `connecting` |

完整转换矩阵由 `subject-runtime-state-machine.js` 导出并逐项测试。非法事件或非法转换 fail closed。连接快照始终分开表达 `platformStatus` 与 `runtimeStatus`：外部运行时断开不会把整个 Vio 标记为不可用。

## 观察输入

观察请求固定字段：

- `portVersion`
- `requestId`
- `operationId`
- `identity.userId / assistantId / subjectId`
- `observation.observationId / observationType`
- `observation.source.system / sourceType / sourceId`
- `observation.occurredAt`
- `observation.factRefs[].factType / factId`
- `timeout.timeoutMs / deadlineAt`
- `createdAt`

`source.system` 固定为 `vio`。端口只携带可追溯事实引用，不定义 Continuity Engine 的 PlatformObservation、CapabilityRequest、Event、StateMutation 或 SubjectState 字段。`deadlineAt` 必须精确等于 `createdAt + timeoutMs`；v1 timeout 为 1—120000 毫秒。

合法的合成样例（不是正式产品身份）：

```json
{
  "portVersion": "vio-subject-runtime-port/v1",
  "requestId": "example-request-a",
  "operationId": "example-operation-a",
  "identity": {
    "userId": "example-user-a",
    "assistantId": "example-assistant-a",
    "subjectId": "example-subject-a"
  },
  "observation": {
    "observationId": "example-observation-a",
    "observationType": "message_created",
    "source": {
      "system": "vio",
      "sourceType": "event",
      "sourceId": "example-event-a"
    },
    "occurredAt": "2026-08-25T00:00:00Z",
    "factRefs": [
      { "factType": "message_version", "factId": "example-message-version-a" }
    ]
  },
  "timeout": {
    "timeoutMs": 5000,
    "deadlineAt": "2026-08-25T00:00:05Z"
  },
  "createdAt": "2026-08-25T00:00:00Z"
}
```

非法样例包括：未知 `engineRevision`、重复事实引用、非 `vio` 来源、deadline 与 timeout 不一致，以及任何未声明字段。

## 表达结果与状态投影

结果固定字段：

- `portVersion / requestId / operationId`
- `status`
- `expression`
- `stateProjection`
- `error`
- `completedAt`

`completed` 必须包含 `text/plain` expression 且 `error=null`。其他状态必须令 `expression=null`、`stateProjection=null` 并返回固定错误。投影只描述外部运行时提供的受控、带来源快照：

- `projectionId`
- `subjectId`
- `runtimeId / runtimeVersion`
- `sourceOperationId`
- `runtimeRevision`（可空、不透明、由外部运行时解释）
- `schemaVersion`
- `payload`
- `capturedAt`

`payload` 是必填的纯 JSON object，递归内容只允许 `null`、boolean、有限 number、string、无空洞 array 和普通 object；`undefined`、function、symbol、bigint、非有限数、稀疏数组、Date、Map、Set、Buffer、类实例、访问器、symbol 属性和循环引用均按精确字段路径 fail closed。校验不会用序列化往返删除、替换或归一化字段，也不会修改调用者输入；通过严格校验后才计算 UTF-8 大小，固定上限为 32768 字节。

合同中的时间必须是以 `Z` 结尾的 RFC 3339 UTC 时间。校验同时验证真实公历日期、时分秒和闰年规则，不接受 JavaScript 会自动归一化的不存在日期；合法闰日和任意位合法小数秒继续受支持。`deadlineAt` 与 `createdAt` 的全部小数位先对齐到同一十进制定点精度再比较，必须精确相差 `timeoutMs`，不得用毫秒级 `Date` 截断、舍入、归一化或改写输入。

Vio 不从该结构取得外部状态写权限，也不把 `runtimeRevision` 变成 Vio Core revision。None Adapter 永远不生成 expression、projection 或 revision。

## 取消与恢复

- 取消请求：`portVersion / requestId / operationId / cancellationId / reason / requestedAt`
- 恢复请求：`portVersion / requestId / operationId / recoveryId / checkpointRef / requestedAt`

R0-A 只冻结并验证合同。它不新增队列、网络恢复、持久化或实际取消执行；这些必须由后续适配器接线在不改变核心合同的前提下实现。

## 错误码

| 错误码 | 固定 retryClass | 含义 |
| --- | --- | --- |
| `SUBJECT_RUNTIME_NOT_CONFIGURED` | `never` | 未配置外部运行时；Vio 仍可用 |
| `SUBJECT_RUNTIME_UNAVAILABLE` | `after_reconnect` | 外部运行时不可达 |
| `SUBJECT_RUNTIME_INCOMPATIBLE` | `never` | 无兼容端口版本 |
| `SUBJECT_RUNTIME_TIMEOUT` | `recover` | 操作超时 |
| `SUBJECT_RUNTIME_CANCELLED` | `never` | 操作已取消 |
| `SUBJECT_RUNTIME_RECOVERY_REQUIRED` | `recover` | 需要按原操作恢复 |
| `SUBJECT_RUNTIME_INVALID_REQUEST` | `never` | 请求违反端口合同 |
| `SUBJECT_RUNTIME_INVALID_TRANSITION` | `never` | 非法状态转换 |
| `SUBJECT_RUNTIME_CAPABILITY_UNSUPPORTED` | `never` | 适配器未声明所需能力 |
| `SUBJECT_RUNTIME_PROTOCOL_ERROR` | `never` | 响应违反已协商合同 |

错误码、message 和 retryClass 是固定组合，不允许适配器自行改变。

## None Adapter 行为

- Manifest：`runtimeMode=none`，无 runtime 名称/版本、无能力、无专用合同。
- Connection：`disconnected / not_configured`，同时 `platformStatus=available`。
- 版本协商：本地确认 None Adapter 实现 Port v1，不代表存在外部运行时。
- `submitObservation/cancel/recover`：稳定返回 `unavailable + SUBJECT_RUNTIME_NOT_CONFIGURED / never`。
- 始终 `expression=null`、`stateProjection=null`，结果中不存在 revision。
- 不需要 URL、Token、Binding、transport、Engine、网络或数据库。

## Continuity Engine Adapter 专用合同登记

以下现有合同全部登记为 `adapter_only`，不是 Vio Core 合同：

- `ContinuityInteractionRequest/FirstRoundSuccessResult`：`continuity-integration/v1.1`
- `CapabilityRequest`：`continuity-capability-request/v1`
- `CapabilityResult`：`continuity-capability-result/v1`
- Capability envelope：`continuity-capability/v1`
- `model.generate`：`continuity-capability/v1`
- `conversation_response`：`continuity-capability/v1`

代码登记状态固定为 `registered_not_wired`。现有 V1—V5/S4/S4-Live 事实和测试不被删除或重写；R0-A 没有把现有聊天流程切换到 Subject Runtime Port。

## 验证与非目标

纯本地专项：

```bash
cd backend
node --test tests/subject-runtime-port-r0a.test.js
```

测试不启动或读取 Engine，不使用网络、API Key、模型、Provider、MCP、Tool 或设备。R0-A 没有修改前端、迁移、公共 HTTP API、登录、记忆、Context、模型执行或部署。

R0-A 完成不等于 R0 完成；R1 尚未开始。不得据此夸大为完整业务解耦或产品可用。
