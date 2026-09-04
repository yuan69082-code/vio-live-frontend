# Subject Runtime Port v1

## 状态与范围

- 施工范围：R0-A 冻结合同；R0-B 装配只读状态；R0-C 展示状态；本次仅整理 R0 文档与验收材料
- 合同版本：`vio-subject-runtime-port/v1`
- 当前状态：R0-A/B/C 已验收并推送；R0 整体验收仍待总体协调窗口复核
- 未完成：真实登录及多助手产品能力、现有聊天业务切换、Standalone 对话执行；具体外部运行时的真实接入另行授权，不作为 Vio 完成或发布门槛
- 下一阶段边界：R0 验收后先 R2，再 R1，然后 R3 至 R13；实际聊天编排按模式切换属于 R1，本文件不授权施工

本端口是 Vio 自己的稳定后端合同，不属于 Continuity Engine，也不要求任何外部主体运行时存在。Vio 与外部运行时的进程、数据库、代码发布和启动生命周期独立。R0-B 已新增默认 None Adapter 应用装配与通用只读 HTTP 状态接口，R0-C 已接入前端读取；R0-A/B/C 未新增数据库迁移，也未切换现有聊天业务。独立聊天尚未实现，不能把状态接口正常当成业务解耦完成。

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
| 正常聊天与回复来源 | Vio 自身模型执行链在既有权限、安全和费用规则下产生普通助手回复，按 Vio 会话/版本事实发布；无需外部运行时 | 模型输出是候选，最终表达须来自已选适配器校验的运行时结果；不得把候选冒充运行时最终表达 | R1 才实现通用模式分流；现有固定 V5 只从 Engine/V2 最终结果发布 Message，不能改述为独立聊天已完成 |
| 业务事实与身份 | Vio 拥有账号、助手设定、会话/MessageVersion、平台事件、记忆、上下文、权限及费用事实；先由 R2 提供真实身份 | Vio 仍保有上述事实与归属；外部运行时只能获得经授权的最小输入 | 现有开发期数据基础不等于真实登录和多助手产品验收；R2 后的 R1 使用真实身份，R3 完成各助手多会话 |
| 外部状态缺席 | 不要求 Engine URL、Token 或 Binding；不伪造外部 expression、SubjectState、情绪或 revision | 只使用已验证、带来源的投影；状态不可用或不兼容必须如实呈现，不能伪造 ready 或历史结果 | None Adapter 仅对外部专属操作返回 `SUBJECT_RUNTIME_NOT_CONFIGURED / never`，不替 Vio 执行普通聊天；默认状态和 UI 只证明该合法边界 |
| 上下文与执行权 | Vio 负责自有 Context、记忆入口、模型/工具/设备执行与审计，后续能力按原阶段完成 | Vio 仍控制数据范围、Token、权限和真实执行；在现有 Engine 专用合同内，Engine 组织其最终认知 Context，Vio 提供受控事实 | 不取消 Vio 自有上下文责任，也不改写 v1.1 的专用边界；完整上下文、记忆、工具/设备能力仍按 R4/R5/R6/R9 等阶段验收 |

运行时不可用不能使 Vio 平台整体不可用；但当前固定 V5 链路不会因本节文字而自动获得独立回复或自动切换。R1 必须依据既有幂等、恢复和权限规则完成真正解耦，不得用 None Adapter 的空结果替代模型回复，也不得绕过已选模式。

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

R0-B 没有提供运行时选择、连接、断开、暂停或重连写入口，没有建立 Continuity Engine Adapter，也没有改变现有 V1—V5/S4/F1 聊天装配。R0-C 只消费此通用状态，保留手动刷新、卸载取消、StrictMode 单次进入读取与无轮询行为。R1 整理 Vio 自身适配边界并完成业务解耦；这不授权真实 Engine 重连或要求它陪测。

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

R0-A/B/C 已完成并推送，不等于 R0 整体验收通过；R2、R1 尚未开始。不得据此夸大为完整业务解耦或产品可用。上面的命令是专项入口说明，本次文档收尾没有执行。

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
| Vio 核心职责 | 本文责任表、[总体架构](../../docs/后端/01-总体架构与系统边界.md)、[端口常量](../src/modules/subject-runtime/subject-runtime-port-v1.js) | A 的责任清单断言；D 上下文核对 | 规则已冻结，本轮补足两模式适用范围 | 核心产品功能不因责任清单而视为已实现；待整阶段复核 |
| 通用主体运行时端口 | [Port v1](../src/modules/subject-runtime/subject-runtime-port-v1.js)、[状态服务](../src/modules/subject-runtime/subject-runtime-status-service.js)、[API说明](API.md) | A、B；C 只读消费 | 合同、装配、状态 GET 与健康摘要已实现 | 未接入聊天执行；R1 完成，R0 整阶段待复验 |
| 空适配器、特定合同登记、第三方入口 | [None Adapter](../src/modules/subject-runtime/none-subject-runtime-adapter.js)、[登记模块](../src/modules/subject-runtime/subject-runtime-adapter-contracts.js) | A、B 的 None/第三方/非法输入测试 | None 正式合法；特定适配器 `registered_not_wired` | 无真实第三方接入；具体外部系统不作为 Vio 发布门槛 |
| 独立模式完整业务语义 | 本文“两种模式”及“None Adapter 行为”；[ADR-034](../../docs/决策记录.md#adr-034) | A/B/C 只证明外部缺席合法与状态展示；D 规则对应 | R0 规则已说明，不冒称独立聊天完成 | R2 提供真实身份后，R1 才实现和验收独立正常聊天 |
| 外部模式候选、最终表达、投影、执行权 | 本文“两种模式”“表达结果与状态投影”；[v1.1专用合同](../../docs/后端/14-continuity-engine连接契约v1.1.md) | A 的结果/投影验证；H 的候选回传与最终回复历史 | 保留已选模式和专用权威，不赋予 Vio 外部状态写权 | 通用业务分流与恢复由 R1 完成；真实重连须另行授权 |
| 旧合同只归属特定适配器 | 登记模块的 `adapter_only`；[后端README](../README.md)的专用范围；ADR-032/BE-ADR-035 | A 的专用合同登记断言；H | 归属已冻结；撤回 README 原第45行误判，第43行限定与权威原文保留 | 旧聊天依赖仍待 R1 整理，不改写历史合同 |
| 样例、兼容表、状态机及纯本地验证 | [样例](../src/modules/subject-runtime/subject-runtime-contract-examples.js)、[状态机](../src/modules/subject-runtime/subject-runtime-state-machine.js)、[R0-A测试](../tests/subject-runtime-port-r0a.test.js)、[测试索引](../tests/README.md) | A 的合法/非法样例、兼容、七态转换、取消/恢复测试 | 文件与历史验收存在，本轮只核对引用 | R0 整体复验未在本轮执行；禁止以真实 Engine 在场为前提 |
| 当前文档一致性 | 根/后端README、总体架构、API与事件契约、决策、路线与本矩阵 | D；[工程日志](../../docs/工程日志.md)本次文档收尾记录 | 过时接口摘要与两模式范围已整理，四项决定已同步 | 待总体协调窗口复核；本地提交未推送，不等于 GitHub 已同步 |

最近历史后端全量为 266 项，265 通过、0 失败、1 条既有条件跳过：`Vio and Engine 7a1daca produce identical canonical UTF-8 and SHA-256 for independent corpus`，当次因显式不存在的隔离路径未执行。R0-C 首次测试自动发现真实 Engine、读取 HEAD/规范化实现后失败，以及随后获准的有限目录元数据检查，均在原日志保留；后续跳过不能抹掉首次事实，有限授权也不成为长期许可。

本轮未执行：R0-A/B/C 专项、前后端全量及组合回归、TypeScript/构建/语法验证、迁移 fresh/upgrade/rollback、共享测试、服务或真实供应商验收。这不是豁免整阶段测试；复验范围与执行由总体协调窗口另行授权，不能将未执行项记为通过。R0 尚未整体验收，未开始 R2 或 R1。
