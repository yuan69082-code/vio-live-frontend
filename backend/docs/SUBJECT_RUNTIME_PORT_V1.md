# Subject Runtime Port v1

## 状态与范围

- 施工范围：R0-A 冻结合同；R0-B 装配只读状态；R0-C 展示状态；R0 已完成整体验收
- 合同版本：`vio-subject-runtime-port/v1`
- 当前状态：R0-A/B/C 及 R0 整阶段已验收并推送；R2 与 R1 均已于 2026-09-05 正式验收通过
- 未完成：R3 的各助手多会话、外部运行时模式的选择/连接及具体外部运行时真实接入；后两者须另行授权，不作为 Vio 独立模式完成或发布门槛
- 下一阶段边界：既定顺序为 R0 → R2 → R1 → R3 至 R13；本文件不授权 R3，也不授权真实 Engine 重连

本端口是 Vio 自己的稳定后端合同，不属于 Continuity Engine，也不要求任何外部主体运行时存在。Vio 与外部运行时的进程、数据库、代码发布和启动生命周期独立。R0-B 已新增默认 None Adapter 应用装配与通用只读 HTTP 状态接口，R0-C 已接入前端读取；R0-A/B/C 当时未新增数据库迁移，也未切换现有聊天业务。R1 此后已用独立的迁移 `025` 和个人聊天合同完成 Vio 自有独立聊天路径；状态接口本身仍不能冒充该业务证据。

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

<a id="mode-semantics"></a>

## 两种模式的既有业务规则与实现边界

本节将已确认规划与本合同对应，不新增字段、错误码或第二套权威规则。模式选择和真实业务接线不在 R0 实施。

| 规则 | 独立模式 `none` 的目标 | 可选外部模式 `external` 的目标 | 当前证据与差距 |
| --- | --- | --- | --- |
| 正常聊天与回复来源 | Vio 自身模型执行链在既有权限、安全和费用规则下产生普通助手回复，按 Vio 会话/版本事实发布；无需外部运行时 | 模型输出是候选，最终表达须来自已选适配器校验的运行时结果；不得把候选冒充运行时最终表达 | R1 已实现个人身份/当前助手范围的独立路径；现有固定 V5 仍只从 Engine/V2 最终结果发布 Message，不得混写两套事实 |
| 业务事实与身份 | Vio 拥有账号、助手设定、会话/MessageVersion、平台事件、记忆、上下文、权限及费用事实；先由 R2 提供真实身份 | Vio 仍保有上述事实与归属；外部运行时只能获得经授权的最小输入 | 现有开发期数据基础不等于真实登录和多助手产品验收；R2 后的 R1 使用真实身份，R3 完成各助手多会话 |
| 外部状态缺席 | 不要求 Engine URL、Token 或 Binding；不伪造外部 expression、SubjectState、情绪或 revision | 只使用已验证、带来源的投影；状态不可用或不兼容必须如实呈现，不能伪造 ready 或历史结果 | None Adapter 仅对外部专属操作返回 `SUBJECT_RUNTIME_NOT_CONFIGURED / never`，不替 Vio 执行普通聊天；默认状态和 UI 只证明该合法边界 |
| 上下文与执行权 | Vio 负责自有 Context、记忆入口、模型/工具/设备执行与审计，后续能力按原阶段完成 | Vio 仍控制数据范围、Token、权限和真实执行；在现有 Engine 专用合同内，Engine 组织其最终认知 Context，Vio 提供受控事实 | 不取消 Vio 自有上下文责任，也不改写 v1.1 的专用边界；完整上下文、记忆、工具/设备能力仍按 R4/R5/R6/R9 等阶段验收 |

运行时不可用不能使 Vio 平台整体不可用；固定 V5 链路不会因本节文字而自动切换。R1 独立路径已依据既有幂等、恢复和权限规则完成，不使用 None Adapter 的空结果替代模型回复；外部运行时选择与真实接入仍未施工。

首次彻底解耦后，未经用户另行要求重连，Vio 施工、测试和发布不探测、读取、启动或修改真实 Engine。通用端口和适配边界在 Vio 自有环境完整验证；真实引擎或同类运行时接入单独验收，不计入 Vio 完成与发布条件。将来优先采用独立适配器或接口扩展；扩展能力不足时先报告，不擅改核心或对方仓库。

## R0-B 通用状态装配与只读查询

`createApplication` 默认装配正式 None Adapter。`subject-runtime-status-service.js` 只读取并验证 Adapter Manifest、连接快照和版本协商结果，然后冻结一个可序列化的公共快照。查询阶段不再调用 Adapter 元数据方法，更不会调用 `submitObservation`、`cancel` 或 `recover`。

公共入口为：

- `GET /api/v1/subject-runtime/status`：返回完整通用状态与版本协商结果；
- `GET /health` 的 `subjectRuntime`：返回同一状态的健康摘要；
- `continuityEngine` 旧健康字段仅为历史调用方兼容保留，并由 `continuityEngineCompatibility.scope=adapter_only_legacy` 明确限定。

公共状态固定包含 `portVersion`、`mode`、`adapterId`、`adapterKind`、`adapterVersion`、`state`、`platformStatus`、`runtimeStatus`、`runtimeName`、`runtimeVersion`、`capabilities`、`reason`、`versionNegotiation` 和 `externalCall`。所有值都来自本文件定义的 R0-A 合同；R0-B 不创建第二套模式、状态、能力或协商枚举。

默认 None Adapter 的核心语义是：

```text
mode=none
adapterId=none
state=disconnected
platformStatus=available
runtimeStatus=not_configured
capabilities=[]
externalCall=not_performed
```

Manifest、连接快照、协商结果的未知字段、非法数据或交叉不一致会在应用装配阶段 fail closed。响应白名单不包含 URL、API Key、Authorization、service token、Provider 密钥、Binding 正文、数据库路径、请求正文、异常堆栈或适配器私有合同正文。

R0-B 没有提供运行时选择、连接、断开、暂停或重连写入口，没有建立 Continuity Engine Adapter，也没有改变现有 V1—V5/S4/F1 聊天装配。R0-C 只消费此通用状态，保留手动刷新、卸载取消、StrictMode 单次进入读取与无轮询行为。R1 此后完成 Vio 自身独立聊天路径和业务隔离；这不授权真实 Engine 重连或要求它陪测。

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

Continuity Integration Contract `continuity-integration/v1.1` 不是本表中的 Vio Port 版本。其翻译只能位于 Continuity Engine Adapter 内部；R1 负责整理 Vio 内已有接线与通用端口的适配边界，不把专用字段塞回核心。真实引擎连接和共享联调仅在用户另行要求时开展，不属于 R1 或 Vio 发布必须有真实引擎在场的条件。

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

R0-A/B/C 完成并推送时并不等于 R0 已获整体验收；其后 R0 已完成整体验收，R2 也已于 2026-09-05 正式验收通过，R1 尚未开始。不得据此夸大为完整业务解耦或产品可用。上面的命令是专项入口说明，R0 文档收尾当时没有执行。

<a id="r0-evidence"></a>

## R0 要求与验收证据矩阵

依据：已完整接收的《Vio 完整工程施工监工规划 R0-R13 独立架构版 2026年9月4日四项决定修订》及同日 R0 核对报告决策修订版。桌面源文件不复制进仓库、不修改；四项决定的仓库记录见 [ADR-034](../../docs/决策记录.md#adr-034)，施工顺序见 [路线图](../../docs/后端/13-部署运维测试与路线图.md#r0-r13-order)。本矩阵不新增施工项或合同。

证据编号及口径：

- A：R0-A 37/37 历史验收，含严格 JSON、32768 UTF-8 字节、真实公历及任意小数秒精确 deadline；见 [后端开发日志](开发日志.md) 的“2026-08-25｜R0-A 第二轮验收缺陷修复”。原实现及两次修复提交依次为 `44585fd26d0367d65e109ed7d15a848f4c74abb9`、`0066da7ea059aed0a162ea76a33d4aea57066b28`、`3a80ad6fda62db86902232b9c2dc32e465c264ec`。
- B：R0-B 9/9 历史验收，默认装配/公共状态/健康摘要/第三方状态/拒绝非法数据与查询零执行；见同日志“R0-B”，提交 `69313f056aeafe44d39f80fcf06893b9d5199f92`。
- C：R0-C 修复后专项 37/37、前端全量 60/60 的历史验收；见 [工程日志](../../docs/工程日志.md)“2026-09-04｜R0-C 验收修正记录”。保留原提交 `2a3382f867f6fbb7cd61b1b6ee0c4e5b6105282d` 和修复 `948e201522750aea26aecd34b9be8136d9280951`。
- H：既有 v1.1/S2/S3/S4/V5/F1/S4-Live 仅作为特定适配器的历史证据；[BE-ADR-038](ADR.md) 和 [2026-08-14 开发日志](开发日志.md)记录首次真实试聊，不能替代独立模式验收。
- D：2026-09-04 本轮仅检查文件、上下文、引用、要求对应、敏感信息、差异与范围；不运行 A/B/C/H 或任何代码测试。所有历史通过数不是本轮新测结果。

| 原 R0 要求 | 现有实现或说明位置 | 测试或历史验收来源 | 当前状态 | 未完成事项 |
| --- | --- | --- | --- | --- |
| Vio 核心职责 | 本文责任表、[总体架构](../../docs/后端/01-总体架构与系统边界.md)、[端口常量](../src/modules/subject-runtime/subject-runtime-port-v1.js) | A 的责任清单断言；D 上下文核对及 R0 整体复验 | 规则已冻结并完成 R0 验收 | 核心产品功能不因责任清单而视为已实现；按后续阶段验收 |
| 通用主体运行时端口 | [Port v1](../src/modules/subject-runtime/subject-runtime-port-v1.js)、[状态服务](../src/modules/subject-runtime/subject-runtime-status-service.js)、[API说明](API.md) | A、B；C 只读消费及 R0 整体复验 | 合同、装配、状态 GET 与健康摘要已实现并完成 R0 验收 | R1 独立聊天不依赖外部运行时；外部模式选择/接入另行授权 |
| 空适配器、特定合同登记、第三方入口 | [None Adapter](../src/modules/subject-runtime/none-subject-runtime-adapter.js)、[登记模块](../src/modules/subject-runtime/subject-runtime-adapter-contracts.js) | A、B 的 None/第三方/非法输入测试 | None 正式合法；特定适配器 `registered_not_wired` | 无真实第三方接入；具体外部系统不作为 Vio 发布门槛 |
| 独立模式完整业务语义 | 本文“两种模式”及“None Adapter 行为”；[R1 合同](R1_STANDALONE_CHAT_CONTRACT.md) | A/B/C 证明外部缺席合法与状态展示；R1 的 61/61 专项、隔离回归和受控页面闭环证明独立聊天 | R2 真实个人身份和 R1 独立执行/恢复路径均已于 2026-09-05 正式验收通过 | R3 多会话尚未开始；真实供应商验证未执行 |
| 外部模式候选、最终表达、投影、执行权 | 本文“两种模式”“表达结果与状态投影”；[v1.1专用合同](../../docs/后端/14-continuity-engine连接契约v1.1.md) | A 的结果/投影验证；H 的候选回传与最终回复历史 | 保留已选模式和专用权威，不赋予 Vio 外部状态写权 | 真实外部模式选择、连接和联调须另行授权 |
| 旧合同只归属特定适配器 | 登记模块的 `adapter_only`；[后端README](../README.md)的专用范围；ADR-032/BE-ADR-035 | A 的专用合同登记断言；H | 归属已冻结；R1 个人生产入口不调用旧固定身份链路；撤回 README 原第45行误判及权威原文继续保留 | 不改写历史合同或历史 V1—V5/S4/F1 证据 |
| 样例、兼容表、状态机及纯本地验证 | [样例](../src/modules/subject-runtime/subject-runtime-contract-examples.js)、[状态机](../src/modules/subject-runtime/subject-runtime-state-machine.js)、[R0-A测试](../tests/subject-runtime-port-r0a.test.js)、[测试索引](../tests/README.md) | A 的合法/非法样例、兼容、七态转换、取消/恢复测试及 R0 整体复验 | 文件、历史验收和整阶段复验均存在 | 禁止以真实 Engine 在场为前提；后续适配器联调另行授权 |
| 当前文档一致性 | 根/后端README、总体架构、API与事件契约、决策、路线与本矩阵 | D；[工程日志](../../docs/工程日志.md)文档收尾、整体验收与 R1 记录 | 过时接口摘要与两模式范围已整理，R0/R2/R1 当前状态已同步 | R1 已正式验收；R3 未开始 |

最近历史后端全量为 266 项，265 通过、0 失败、1 条既有条件跳过：`Vio and Engine 7a1daca produce identical canonical UTF-8 and SHA-256 for independent corpus`，当次因显式不存在的隔离路径未执行。R0-C 首次测试自动发现真实 Engine、读取 HEAD/规范化实现后失败，以及随后获准的有限目录元数据检查，均在原日志保留；后续跳过不能抹掉首次事实，有限授权也不成为长期许可。

上述 D 轮当时未执行：R0-A/B/C 专项、前后端全量及组合回归、TypeScript/构建/语法验证、迁移 fresh/upgrade/rollback、共享测试、服务或真实供应商验收；该历史事实不以之后结果覆盖。随后 R0 完成独立整体验收，R2 于 2026-09-05 正式验收通过；R1 尚未开始。

<a id="r0-review-20260904"></a>

### 2026-09-04｜R0 整体复验来源与结果（交总体协调窗口验收）

本节是上方八项矩阵的追加复验记录，不改写 A/B/C/H 的历史验收或 D 的纯文档核对。复验代码基线始终为 `0ab4e910577efb84a1e6d0cee14f157861488faa`，父提交及本地 `origin/main` 为 `948e201522750aea26aecd34b9be8136d9280951`；开始 `main` 领先/落后 1/0，工作区、暂存区干净。本轮不 fetch、不 push，不修改实现、测试、配置或桌面 Word。

#### 访问与执行边界

- 每次后端测试前，在该 PowerShell 子进程中将 `VIO_CONTINUITY_ENGINE_PATH` 显式设为系统临时目录下不存在的 `vio-r0-review-engine-disabled-do-not-create`，检查不存在并验证测试子进程继承；未创建占位目录，不永久修改环境变量，不回退到真实 Engine 自动发现。
- 既有 RFC 跨仓项 `Vio and Engine 7a1daca produce identical canonical UTF-8 and SHA-256 for independent corpus` 按原条件跳过，未执行、不计通过。没有新增跳过或名称过滤，没有运行真实 Engine shared tests。
- 本次有限授权仅允许既有沙箱保护逻辑检查真实 Engine 目录及 `.continuity-data` 的存在性、实际路径等目录元数据；不枚举内容，不读取源码、HEAD、配置、密钥、数据库或业务文件，不在 Engine 中执行命令，不启动、修改或真实连接 Engine。该授权不倒写为 R0-C 首次越界已经获准，也不是后续阶段的长期许可。
- 测试使用 Vio 自身的受控 loopback、显式测试替身、临时数据库和必要子进程；这些不代表真实外部运行时接通。真实模型、供应商、真实 API Key 读取/使用、业务公网请求与费用均为 0；未关闭用户程序或其他窗口服务。

#### 实际命令流水与失败保留

下表均来自同一代码基线上的本次连续复验；专项/组合已通过者按用户授权引用首次复验输出，不无理由重跑。行间有重叠，不相加为独立测试总数。后端命令在 `backend` 执行，前端命令在仓库根目录执行。

| 项目 / 命令 | 通过 / 失败 / 跳过 | 退出码与口径 |
| --- | --- | --- |
| `node --test tests/subject-runtime-port-r0a.test.js` | 37 / 0 / 0 | 0；首次复验专项 |
| `node --test tests/subject-runtime-status-r0b.test.js` | 9 / 0 / 0 | 0；首次复验专项 |
| `pnpm test src/api/subject-runtime-api.test.ts src/components/profile/SubjectRuntimeSettings.test.tsx` | 37 / 0 / 0 | 0；R0-C 专项，使用现有正式入口 |
| `pnpm test -- src/api/subject-runtime-api.test.ts src/components/profile/SubjectRuntimeSettings.test.tsx` | 60 / 0 / 0 | 0；首次复验实际覆盖全部 5 个前端测试文件，不能把这次输出记成仅专项 |
| V1—V4 既有六文件命令（见下方完整命令） | 101 / 0 / 0 | 0；首次复验受影响组合 |
| R0-A/B、health、V1—V5 十一个文件命令（见下方） | 167 / 0 / 0 | 0；首次复验完整受影响组合 |
| 首次后端默认 `pnpm test` | 258 / 3 / 1（共 262 项） | 1；进程崩溃，保留失败，不因后续成功改写 |
| `node --test tests/account-subject-flow.test.js` | 2 / 0 / 0 | 0；受控诊断，仅单独运行一次 |
| `node --test tests/api-connection-flow.test.js` | 2 / 0 / 0 | 0；受控诊断，仅单独运行一次 |
| `node --test tests/assistant-global-settings-flow.test.js` | 3 / 0 / 0 | 0；受控诊断，仅单独运行一次 |
| `node --test --test-concurrency=1 "tests/*.test.js"` | 265 / 0 / 1（共 266 项） | 0；仅诊断，不能替代默认命令；同一组 31 个文件 |
| 用户释放资源后，原默认 `pnpm test` 受控复验一次 | 265 / 0 / 1（共 266 项） | 0；实际脚本为 `node --test "tests/*.test.js"`，约 23.070 秒，无并行启动第二套测试 |
| `pnpm run typecheck` | 不适用测试计数 | 0；实际执行 `tsc -b` |
| `pnpm run build` | 不适用测试计数 | 0；实际执行 `tsc -b && vite build`，113 个模块转换 |
| 对 `729f9e3…HEAD` 间全部 11 个 JavaScript 文件逐一 `node --check <file>` | 11 个文件通过 / 0 失败 | 0；本次恢复复验重新执行；TypeScript 由正式类型检查及构建验证 |

完整受影响组合命令如下，未使用名称过滤、排除文件或关闭进程隔离：

```powershell
node --test tests/continuity-integration-v1-flow.test.js tests/continuity-integration-v2-flow.test.js tests/continuity-integration-v3-flow.test.js tests/continuity-capability-v4-flow.test.js tests/continuity-capability-v4-recovery.test.js tests/model-execution-v4.test.js
node --test tests/subject-runtime-port-r0a.test.js tests/subject-runtime-status-r0b.test.js tests/health.test.js tests/continuity-integration-v1-flow.test.js tests/continuity-integration-v2-flow.test.js tests/continuity-integration-v3-flow.test.js tests/continuity-capability-v4-flow.test.js tests/continuity-capability-v4-recovery.test.js tests/model-execution-v4.test.js tests/continuity-conversation-v5-flow.test.js tests/continuity-conversation-v5-recovery.test.js
```

首次前端验证也保留命令入口失败：`pnpm exec vitest run src/api/subject-runtime-api.test.ts src/components/profile/SubjectRuntimeSettings.test.tsx` 因 `vitest` 无法解析退出 1，未执行测试、不计通过。随后使用表内已有 `pnpm test <两个文件>` 正式入口完成专项；未安装依赖、未修改脚本或测试。

首次后端失败中，account-subject 与 api-connection 测试进程输出 `Fatal process out of memory: Zone` 并以 `2147483651` 退出；assistant-global-settings 进程以 `3221226505` 异常退出，不能将其也直接断言为已证实的 OOM。没有通过改断言、增加跳过、加大堆、改变隔离或永久并发配置来获得通过。

运行环境沿用 `E:\node.exe`、Node v22.23.1、x64、12 个可用逻辑处理器，物理内存约 15.82 GiB。单文件及串行诊断未复现崩溃或业务断言失败；串行后系统提交内存仍约 96.51%、仅余 0.90 GiB，因此当时没有强行运行默认命令。用户自行关闭部分软件后，本次默认命令启动前提交内存约 22.95 / 25.82 GiB、余量 2.87 GiB，可用物理内存约 4.04 GiB；结束时提交内存约 22.96 GiB，可用物理内存约 4.00 GiB。CIM 查询未取得数据，Windows 性能计数器取得上述提交内存采样。后续成功支持继续排查资源压力，但不足以证明全部崩溃根因已经查明。

#### 八项原要求的本次复验对应

| 原 R0 要求 | 本次实现/文件与测试核对 | 复验结论与尚未完成边界 |
| --- | --- | --- |
| Vio 核心职责 | 原责任表、ADR-034/BE-ADR-040 与 R0-A 职责清单断言一致 | 规则证据符合；真实登录、多助手等产品能力不算已实现 |
| 通用主体运行时端口 | Port v1 严格校验、R0-B 默认装配/状态 GET/健康摘要；A 37、B 9、C 37 项专项通过 | 合同、只读装配及前端消费证据具备；未切换聊天执行 |
| 空适配器、专用合同登记、第三方入口 | None 的空能力/空投影、第三方 Manifest 校验及 `registered_not_wired` 登记断言通过 | None 是正常合法状态；无真实第三方接入，不作为发布前置条件 |
| 独立模式完整业务语义 | 两种模式文档与 None/UI 测试对应，不以 `available` 状态冒充普通模型回复 | R0 只冻结规则；真实身份先由 R2 完成，独立聊天仍由 R1 实现 |
| 外部候选、最终表达、投影及执行权 | A 的表达/投影严格 JSON 与来源边界、受影响 V1—V5 回归通过；S4-Live 仅引用历史 | 不赋予 Vio 外部状态写权；通用业务分流/恢复仍属 R1，真实重连另行授权 |
| 旧合同的适配器归属 | `adapter_only` 登记断言通过；后端 README 专用范围及被撤回的旧误判复核 | v1.1 权威原文不改，旧聊天依赖未假称已清除 |
| 样例、兼容表、状态机与本地验证 | A 的合法/非法样例、七态转换、None、严格 JSON/UTF-8/公历/精确小数秒均通过；B/C 同源只读及生命周期测试通过 | 通用验证具备；RFC 真实跨仓项未执行、不计通过，不能冒称 Engine 已接通 |
| 当前文档一致性 | 四项决定、历史/当前范围、八项矩阵、相对链接/锚点、历史正文保留及本轮追加范围复核 | 本次复验材料提交协调窗口；不自行宣告 R0 获整体验收，不开始 R2/R1 |

#### 迁移验证的实际来源

以下不是根据“没有修改迁移”推断通过，而是在本次默认全量输出中确认的原有测试：

| 范围 | 现有测试文件与名称 | 本次结果 |
| --- | --- | --- |
| 021 fresh | [V4 flow](../tests/continuity-capability-v4-flow.test.js)：`migration 021 creates the durable V4 ledger on a fresh database` | 通过；检查表、索引、外键及迁移记录 |
| 001–020 升级 | 同文件：`an existing 001-020 database upgrades to 021 without changing old facts` | 通过；保留旧用户事实、外键检查 0；现有 runner 继续迁移至当前 022 |
| 021 失败回滚 | 同文件：`a failing 021 migration rolls back without partial V4 tables or migration record` | 通过；临时迁移副本注入错误，确认无部分 V4 表或 021 记录 |
| 022 fresh | [V5 flow](../tests/continuity-conversation-v5-flow.test.js)：`migration 022 installs fresh and protects immutable turn facts` | 通过；表、唯一索引、外键及迁移记录 |
| 001–021 升级与 022 失败回滚 | 同文件：`001-021 upgrades to 022 and a broken migration rolls back completely` | 通过；保留旧用户，失败库没有 022 记录或 Turn 表 |
| 019/020 历史升级 | V2 `migration 019 installs fresh and upgrades an existing 018 database`；V3 `migration 020 installs from 001 and upgrades databases at 018 and 019` | 两项均通过，runner 按当前迁移集合执行；未改旧迁移 |

本次只追加矩阵与三份现有日志；文档检查和产物清理结果见 [后端开发日志](开发日志.md#r0-review-20260904)。未执行真实 Engine shared/RFC 实现对照、真实供应商试聊、生产部署或 R2/R1 产品验收，均不计通过。首次默认崩溃、诊断通过、资源不足时未启动默认命令、释放资源后的默认复验及原 R0-C 越界记录分别保留；本次复验及验收记录交总体协调窗口最终验收，未推送，R2、R1 均未开始。
