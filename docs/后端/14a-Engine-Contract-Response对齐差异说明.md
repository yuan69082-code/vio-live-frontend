# Engine Contract Response 对齐差异说明

## 1. 文档状态

- 日期：2026-07-30
- 对齐输入：Continuity Integration Contract v1、Engine Integration Contract Response v1
- 对齐输出：[Continuity Integration Contract v1.1](14-continuity-engine连接契约v1.1.md)
- 状态：**现行差异已闭合，Continuity Engine 已正式接受 v1.1；此前“暂不接受”的结论作为历史记录保留。第一轮 test-only 双方共享验收已通过；Engine E4 `c5ebbf9` 与 Vio V3 正式本机 HTTP Adapter 已分别实现并独立验收，双方 S2/S3 尚未开始**
- 最终接受依据：Engine Contract Final Read-Only Short Confirmation v1（归档见 [14c-Engine-Contract-Final-Read-Only-Short-Confirmation-v1.md](14c-Engine-Contract-Final-Read-Only-Short-Confirmation-v1.md)）
- 证据原则：源码、迁移和测试高于规划文字

Engine Integration Contract Response v1 当前来自 continuity-engine 审核窗口的完整回复，未在两个仓库中发现同名落盘文件。本说明不把引擎建议误写为已经实现的接口。

### 1.1 2026-08-02 实现状态附注

- Engine E1/E2/E3 与共享 JSONL Runner 已在提交 `7a32a99` 完成：引擎侧严格 Schema/hash、固定 Binding、test-only ContractTestAdapter、确定性 Action Gate/Evolution、成功/错误 envelope、持久化结果账本、跨重启恢复和测试桥。
- Vio V1 已完成：请求侧三份严格本地 Schema/validator、RFC 8785/hash、固定 Binding 测试装载、经 Vio 归属与来源验证的逻辑请求构造，以及请求输入跨重启恢复。
- Vio V2 已完成严格 success/error envelope 校验、operation/response/stateProjection 幂等账本、独立投影版本/回执/指针、revision 隔离和跨重启恢复；Vio V3 已完成默认关闭的正式本机 HTTP delivery/outbox 与查询恢复。
- 第一轮 test-only 双方共享验收已通过；Engine E4 与 Vio V3 目前只分别完成独立验收，双方 S2/S3 正式本机共享验收、真实模型、对话 API 串接和前端试用尚未开始。
- 本附注只更新施工状态，不改变下文保存的第二次审核历史、v1.1 规范内容或长期待决策项。

### 1.2 第一轮 test-only 共享验收结论

- 场景 A `hello` 返回 `changed=false / 0→0 / engineUpdateId=null`，Vio 初始化 revision 0 投影 head。
- 场景 B `remember continuity test focus` 经真实 Perception、Thinking、Action Gate 和 Evolution 返回 `changed=true / 0→1`，Engine 仅有一条内部更新，Vio 仅有一份 revision 1 投影。
- 场景 C 在 expected revision 1 返回 `changed=false / 1→1`，Vio head 保持 1。
- 同进程重放和双方进程/数据库重启后重放均返回首次 operation/response/projection，未重复推进 revision；四类固定错误及 Vio terminal/reassemble/incident 行为通过。
- 该结论只关闭第一轮 test-only 共享验收，不改变测试桥非生产、前端未接入、真实模型未接入和网络 Adapter 未实现的边界。

## 2. 总体处理结论

第一轮 Engine Integration Contract Response v1 的十二项意见主方向已纳入 v1.1。该历史阶段中，第 5—8 项因生产参数和跨服务恢复细节尚未定，标记为“调整后接受”；第 10 项以三层数据空间取代“Private Space 是用户控制区”的单层定义。

Engine Contract Second Review Response v1 随后给出“暂不接受 v1.1，存在阻塞第一轮最小连接测试的契约问题”的结论，并把十二项落实情况评为：正确落实 5 项、部分落实 6 项、存在新风险 1 项。第三轮修订没有改写这一历史结论，只针对七个阻塞项新增第一轮一致性 Profile。Continuity Engine 已在最终只读短确认中确认现行差异闭合，不存在会使双方采取不同第一轮实现的规则，并正式接受 v1.1；这不表示运行时能力或第一轮共享测试已经完成。

## 3. 引擎第二次审核七个阻塞项闭合说明

### 3.1 PlatformObservation 精确 schema、唯一位置、bindingId 与 message fact

- **引擎第二次审核意见：** observations 与 platformFactPackage 存在双承载可能；PlatformObservation 缺少 bindingId；message_created 没有精确 schema；消息正文位置不唯一；禁止字段没有固定错误。
- **v1.1 修改位置：** 第 6.1、7.2、19.1、19.7 节。
- **修改后的正式决定：** ContinuityInteractionRequest.observations 是唯一承载位置；PlatformFactPackage 只能在 observationRefs 中引用 observationId。第一轮只允许一个严格 message_created Observation 和一个严格 message_version fact。Observation 只含事件身份、sourceEventId、时间、完整绑定和 MessageVersion 引用；正文只在 fact.content。所有对象 additionalProperties=false；未知、禁止状态字段、重复正文或引用不一致统一 SCHEMA_INVALID / never。
- **当前已有能力：** Vio V1 已实现精确请求/fact/Observation 构造和严格本地校验；Engine E1/E2/E3 已实现摄取侧严格校验。
- **第一轮需要新增的最小能力：** 已由双方共享验收验证同一真实 V1 请求和 Engine envelope，无剩余 test-only 验收能力。
- **是否仍阻塞第一轮：** 不阻塞；共享验收已通过。
- **未来实现责任：** 双方；Vio 负责构造，引擎负责验证和安全摄取。

### 3.2 固定 SubjectBinding 创建与装载

- **引擎第二次审核意见：** 第一轮 subjectId、bindingId、fixture 生成方、双方装载方式和统一拒绝语义没有固定。
- **v1.1 修改位置：** 第 19.3 节；PlatformObservation/fact 的 identity 同步由第 19.1 节固定。
- **修改后的正式决定：** 引擎先创建全新 subjectId 和 revision 0；Vio生成固定 bindingId；测试准备程序形成 bindingVersion=1、status=active 的不可变 fixture，Vio 与 ContractTestAdapter 装载相同 fixture/hash。第一轮没有绑定 CRUD/重绑定 API。任一字段/status 错配统一 SUBJECT_BINDING_MISMATCH / never，且不泄露主体存在性。
- **当前已有能力：** Vio V1 和 Engine E1/E2/E3 已分别实现固定 fixture/hash 的持久化装载与校验。
- **第一轮需要新增的最小能力：** 已在共享测试准备中确认双方装载同一不可变 fixture。
- **是否仍阻塞第一轮：** 不阻塞；共享 Binding 验证已通过。
- **未来实现责任：** 双方；引擎创建 subject，Vio生成 bindingId，ContractTestAdapter 校验。

### 3.3 确定性 Provider 所在层级

- **引擎第二次审核意见：** v1.1 未确定 test double 位于引擎内还是 Vio capability stub，双方可能实现不同测试模式。
- **v1.1 修改位置：** 第 10 节末、第 19.4、20.1 节。
- **修改后的正式决定：** DeterministicThinkingProvider、MemoryRetriever、ReplyComposer 全部位于 continuity-engine 进程内。第一轮不产生 CapabilityRequest/CapabilityResult，也不覆盖 capability 通道。
- **当前已有能力：** Engine E3 已实现固定的进程内 DeterministicThinkingProvider、MemoryRetriever 和 ReplyComposer；Vio 不执行 capability。
- **第一轮需要新增的最小能力：** 已完成，不需要 Vio capability stub。
- **是否仍阻塞第一轮：** 不阻塞；共享验收已实际使用三个 Engine test double。
- **未来实现责任：** continuity-engine；Capability 协议由双方在后续独立阶段实现。

### 3.4 成功响应、无变化投影与 engineUpdateId

- **引擎第二次审核意见：** revision/currentRevision 命名不一，无变化 engineUpdateId 未决，snapshot/delta 未定，缺少第一轮精确结果。
- **v1.1 修改位置：** 第 11.1—11.2、19.6 节。
- **修改后的正式决定：** 第一轮统一 previousRevision/currentRevision。无变化 changed=false、currentRevision=previousRevision、engineUpdateId=null；有变化 changed=true、currentRevision=previousRevision+1、engineUpdateId=StateUpdateRecord.update_id。只用精确最小 snapshot，不用 delta；成功 envelope 固定 operationId、responseId、projection、consumedObservationIds 和 hash。投影内容唯一键固定为 subjectId+currentRevision，request 关联唯一键为 requestId，engineUpdateId 只在非 null 时唯一；同一 revision 不得出现第二份不同内容/hash 的投影。
- **当前已有能力：** 引擎已有 revision、StateUpdateRecord.update_id 和重启恢复；Vio V2 已有 test-only 投影接收、内容唯一性、revision CAS、隔离和恢复。
- **第一轮需要新增的最小能力：** 双方结果/投影持久化已实现，并在 A/B/C、重放和重启场景中验证。
- **是否仍阻塞第一轮：** 不阻塞；changed=false/true 和 engineUpdateId 语义已联验。
- **未来实现责任：** 引擎定义/返回；Vio验证、保存、隔离和对账。

### 3.5 第一轮最小错误 envelope

- **引擎第二次审核意见：** 缺少统一 envelope、retryClass、currentEngineRevision 和错主体/错绑定防泄露规则。
- **v1.1 修改位置：** 第 19.7 节。
- **修改后的正式决定：** 完整 JSON envelope 固定 contractVersion、requestId、operationId=null、status=failed_terminal 和 error 对象。四项映射固定为 SCHEMA_INVALID/never、SUBJECT_BINDING_MISMATCH/never、REVISION_CONFLICT/reassemble（仅在完整 Binding 验证后返回 currentEngineRevision）、IDEMPOTENCY_KEY_REUSED/never。错主体与错绑定使用完全相同响应。expectedEngineRevision 与 currentEngineRevision 只要不相等即冲突。
- **当前已有能力：** Engine ContractTestAdapter 已生成四类固定错误 envelope；Vio V2 已严格验证并持久化 terminal/reassemble 结果。
- **第一轮需要新增的最小能力：** 已完成，并由四类真实 Runner 错误共享测试验证。
- **是否仍阻塞第一轮：** 不阻塞。
- **未来实现责任：** 双方共同遵守，引擎生成，Vio解释和展示。

### 3.6 独立 ContractTestAdapter

- **引擎第二次审核意见：** APIService.submit_message → UserInteractionService 会先创建 interaction Event 并可能推进 temporal revision，不能作为 PlatformObservation 摄取入口。
- **v1.1 修改位置：** 第 4.3、17.1、19.8、20.2 节；已清除全部旧入口表述。
- **修改后的正式决定：** 第一轮使用独立进程内 ContractTestAdapter，按固定顺序验证 schema、requestHash、binding、持久化幂等、expectedEngineRevision，再组装核心输入。禁止调用 APIService.submit_message/UserInteractionService，禁止 Observation 直转内部 Event。APIService 只可复用只读查询或核心辅助能力。
- **当前已有能力：** Engine E3 已实现独立、test-only、进程内 ContractTestAdapter；Vio V1 明确没有把任何现有公共 API 作为摄取入口。
- **第一轮需要新增的最小能力：** 已由 Vio test-only JSONL transport 将真实构造结果送入该 Adapter。
- **是否仍阻塞第一轮：** 不阻塞；测试桥已联验，但仍不是生产接口。
- **未来实现责任：** continuity-engine。

### 3.7 跨重启持久化完整幂等结果

- **引擎第二次审核意见：** 内部 Event 去重不足以返回第一次完整 operation/response/projection；requestId 幂等必须跨双方重启恢复。
- **v1.1 修改位置：** 第 11.3、19.5、19.6、19.8 节。
- **修改后的正式决定：** requestId 是永久幂等键；requestHash 为逻辑请求去除 requestHash 后按 RFC 8785 规范化、再计算 SHA-256。传输尝试/重试时间不入 hash。相同 ID/hash 返回第一次完整持久化结果且不重跑 Thinking/Event/revision；在 schema、hash 和完整 Binding 验证通过后，同 ID 不同 hash 返回 IDEMPOTENCY_KEY_REUSED / never。双方重启后仍成立。
- **当前已有能力：** Engine E1/E2/E3 已有完整 operation/response/projection 结果账本与重启恢复；Vio V1 有 request 输入账本，Vio V2 已有完整结果/投影账本与重启恢复。
- **第一轮需要新增的最小能力：** 已验证同一 requestId 在同进程和双方重启后的两侧完整重放与恢复。
- **是否仍阻塞第一轮：** 不阻塞；共享验收已通过。
- **未来实现责任：** 双方各自负责本地账本与重启恢复。

### 3.8 第 9.1—9.9 节准确文本落点

| 引擎审核文本 | v1.1 正式落点 |
| --- | --- |
| 9.1 PlatformObservation 唯一位置与结构 | 19.1，并补充精确 Observation/fact schema |
| 9.2 内部 Event 与经历记录边界 | 3.1、19.2 |
| 9.3 第一轮固定 Binding | 19.3 |
| 9.4 第一轮确定性 Provider | 10 节末、19.4、20.1 |
| 9.5 持久化幂等 | 19.5 |
| 9.6 第一轮结果与投影 | 11.1—11.2、19.6 |
| 9.7 第一轮错误 envelope | 19.7 |
| 9.8 ContractTestAdapter | 17.1、19.8、20.2 |
| 9.9 AI Private Space 准确边界 | 12.2、19.9 |

第 9.1—9.9 节原文已完整作为引用写入 v1.1；其下的精确 schema、hash、fixture、响应和校验顺序是本轮用于闭合测试一致性的规范性补充。

### 3.9 最后四类机器契约精度问题

| 最终确认意见 | v1.1 修改位置 | 本轮固定结果 | 实现状态 |
| --- | --- | --- | --- |
| 缺少顶层严格 Schema | 19.1.1—19.1.3 | 建立三份 Draft 2020-12 Schema 的显式 registry；使用唯一绝对 URN `$id` 和精确 `$ref`；所有对象拒绝未知字段；实际启用 date-time format 断言并用正则限制 RFC 3339 UTC `Z` | Engine E1、Vio V1 与共享结构对照均已通过 |
| 空数组示例不是有效向量 | 19.1.1 | 写入 facts/observations 各一项的完整 conformance vector；交叉字段、Observation 引用和 `hello` contentHash 已校验；最终 requestHash 为 `sha256:ec07ad9ba66d1ffcdfa9177cd61bec1b880ad6ee99a6ec6449e732c1b86002d0` | Engine、Vio 单边及共享测试均已通过 |
| Binding fixture/hash 不唯一 | 19.3 | 固定全部 ID、状态和时间；双方装载同一 fixture；bindingFixtureHash 为 `sha256:c75b72194c0158a549f3fb30f04a5147ea11a4e777cb1a9cc1a54da6b93359f6` | Engine 与 Vio 已分别实现装载/校验；尚未共同装载测试 |
| 第一轮幂等错误码不统一 | 19.5、19.7、19.8 | 第一轮唯一使用 IDEMPOTENCY_KEY_REUSED / never，不接受旧码别名；第二次审核原文中的旧码只保留为被明确取代的历史引用 | 仅文档规则，错误映射未实现 |

同时完成的校准：expectedEngineRevision != currentEngineRevision 一律 REVISION_CONFLICT / reassemble，且 currentEngineRevision 只能在完整 Binding 验证后返回；第一轮投影内容、request 关联和非 null engineUpdateId 的唯一性分别固定；第 18.4 节仅保留第一轮之外的未来生产接口待定项。

## 4. 十二项逐项对齐

### 1. 修正 Thinking 与模型能力请求时序

- **状态：接受**
- **引擎意见：** 模型可能正是 ThinkingProvider，不能先得到 ThinkingResult 再判断是否需要模型。应先创建 ThinkSession，需要能力时暂停，结果返回后恢复并完成 ThinkingResult。
- **Vio 回应：** 完全接受。主体表达和状态判断必须在模型结果回到引擎后继续完成；模型原始输出不直接展示。
- **契约修改位置：** v1.1 第 9 节步骤 5—12、第 10 节。
- **当前已有能力：** Vio 有确定性 Model Router 和 Token Budget 元数据，但不调用模型；引擎有 ThinkSession/ThinkingProvider seam。
- **Vio 拟新增：** 能力执行编排、双层门控、结果回送和幂等账本。
- **引擎拟新增：** 可恢复 ThinkSession、WAITING_CAPABILITY、CapabilityRequest/Result 验证和恢复入口。
- **长期规划：** 允许经引擎审核后的模型能力参与 Thinking，但供应商仍可替换。
- **是否阻塞第一轮最小测试：** 不阻塞确定性替身，但测试流程必须遵循修正后的顺序。

### 2. PlatformObservation 与引擎内部 Event 结构性隔离

- **状态：接受**
- **引擎意见：** stateMutationAllowed=false 只是声明，不能阻止夹带状态写字段；外部类型必须与内部 Event、Perception Observation 分离。
- **Vio 回应：** 接受并加强。v1.1 取消 stateMutationAllowed 字段，直接在 schema 中不定义状态写字段，并拒绝所有未声明字段。
- **契约修改位置：** v1.1 第 6 节、第 15 节。
- **当前已有能力：** Vio Event 有稳定 ID、类型、来源、时间、用户/主体范围和秘密字段拦截，但没有消费者或 Observation schema。
- **Vio 拟新增：** 事件映射注册、严格 schema 构造器、内容哈希、投递/回执账本。
- **引擎拟新增：** PlatformObservation 模型、严格验证、摄取审计和事实入口。
- **长期规划：** 平台事实与内部状态事件永久保持不同类型和命名空间。
- **是否阻塞第一轮最小测试：** **阻塞**；必须先有严格无 mutation 的测试 schema。

### 3. Vio 只提交 expectedEngineRevision

- **状态：接受**
- **引擎意见：** Vio 不应提交完整 SubjectState；只提交 expectedEngineRevision，引擎独立读取权威状态。
- **Vio 回应：** 完全接受。状态快照、ConversationSummary、聊天历史和 Vio 当前投影均不得成为状态覆盖输入。
- **契约修改位置：** v1.1 第 3 节、第 7.3 节、第 8 节。
- **当前已有能力：** Vio 当前有状态历史和当前指针，但缺少 engine revision/update ID；引擎已有 expected_revision。
- **Vio 拟新增：** 只读投影缓存、expectedEngineRevision 管理和冲突后重新装配。
- **引擎拟新增：** 正式 projection/query 与冲突返回。
- **长期规划：** 维持单向投影和单一权威时间线。
- **是否阻塞第一轮最小测试：** **阻塞**；expectedEngineRevision 校验是最小测试核心。

### 4. 状态投影单向同步、幂等、乱序隔离和对账

- **状态：接受**
- **引擎意见：** Vio 投影只能来自引擎，必须携带 revision、previousRevision、engineUpdateId、schema/hash，并支持乱序隔离和查询修复。
- **Vio 回应：** 完全接受。Vio 投影永不回灌；状态不一致以引擎为准。
- **契约修改位置：** v1.1 第 11.2 节、第 15 节。
- **当前已有能力：** Vio 有不可变状态版本和当前指针，但不具备引擎元数据、幂等或乱序隔离。
- **Vio 实现状态：** Vio V2 已新增投影接收、revision CAS、quarantine/reconciling 和幂等唯一性；自动快照修复未实现，也不属于 V2，冲突只隔离并等待对账。
- **引擎拟新增：** 第一轮按第 19.6 节实现固定最小 snapshot；未来生产协议再设计扩展投影 schema、snapshot/delta 选择、更新查询和 update replay。
- **长期规划：** 建立可审计的投影延迟、对账和灾难恢复。
- **是否阻塞第一轮最小测试：** **阻塞**；至少完成单主体回复/投影幂等保存和冲突拒绝。

### 5. 显式、版本化 SubjectBinding 与安全重绑定

- **状态：调整后接受**
- **引擎意见：** assistantId 与 subjectId 生命周期不同，必须有显式 SubjectBinding；重绑定不得自动合并状态。
- **Vio 回应：** 接受绑定模型。调整点是：第一轮只用预置固定绑定，不在第一轮实现通用重绑定；生成方、所有者、迁移和确认级别保留共同决定。
- **契约修改位置：** v1.1 第 5 节、第 20 节第 1—2 项。
- **当前已有能力：** Vio 有 User/Subject 复合归属和当前助手指针；引擎只有 subjectId。当前没有跨系统绑定记录。
- **Vio 拟新增：** SubjectBinding 存储、版本检查、历史和重绑定安全流程。
- **引擎拟新增：** Subject registry、绑定校验和生命周期状态。
- **长期规划：** 支持受控解绑、归档和跨载体迁移，绝不隐式合并人格状态。
- **是否阻塞第一轮最小测试：** **阻塞**；测试开始前必须有一个显式固定绑定。通用重绑定不阻塞。

### 6. 异步 CapabilityRequest / CapabilityResult 状态机

- **状态：调整后接受**
- **引擎意见：** 正式语义应可持久化、等待、查询和恢复；真实能力不能依赖一次同步调用。
- **Vio 回应：** 接受未来异步正式语义，但 Capability 协议不参加第一轮。第一轮的 DeterministicThinkingProvider、MemoryRetriever 和 ReplyComposer 全部位于 continuity-engine 进程内，不产生 CapabilityRequest/CapabilityResult，不附带任何能力请求标识，也不存在跨服务能力调用路径。
- **契约修改位置：** v1.1 第 10 节末、第 19.4、20.1 节。
- **当前已有能力：** Vio 有 Tool/Device 的未执行准备记录和安全链；引擎 Action 只形成计划。双方均无真实能力状态机。
- **Vio 拟新增：** 队列/状态账本、权限/确认/路由、执行器适配、查询/取消和结果回送。
- **引擎拟新增：** CapabilityRequest、等待会话、结果验证与恢复。
- **长期规划：** 模型、Tool、MCP、设备共用核心状态语义，各自扩展类型化字段。
- **是否阻塞第一轮最小测试：** Capability 协议不参加第一轮。第一轮不调用真实模型、Tool、MCP 或设备；未来真实能力测试前才需要实现该协议。

### 7. 部分成功的 Outbox、查询、重试和恢复

- **状态：调整后接受**
- **引擎意见：** 不做跨数据库强事务；双方各自本地原子提交，通过 Outbox、稳定 ID、状态查询和对账恢复。
- **Vio 回应：** 接受。调整点是正式发布条件、同步中 UI 和具体部分成功枚举仍需共同决定。任何恢复都不得重新调用模型或创建第二次主体经历。
- **契约修改位置：** v1.1 第 11.3 节、第 15 节、第 20 节第 8 项。
- **当前已有能力：** Vio 的单库消息/Event、状态来源和安全记录有本地事务；跨系统 Outbox 和 operation 查询不存在。
- **Vio 拟新增：** continuity request/outbox、回复+投影本地事务、展示发布状态和对账作业。
- **引擎拟新增：** interaction 结果持久化、engine Outbox、operation/update 查询和结果重放。
- **长期规划：** 以可恢复一致性替代共享数据库和分布式强事务。
- **是否阻塞第一轮最小测试：** happy path 不阻塞；可靠性验收和“连接完成”结论前阻塞。

### 8. 正式错误分类、重试、取消和进度

- **状态：调整后接受**
- **引擎意见：** 区分终止、revision/binding 冲突、等待、可重试和状态未知；取消必须有不可逆边界。
- **Vio 回应：** 接受错误类别和安全重试原则。HTTP 映射、重试次数、退避、保留期、进度粒度和取消截止点仍需共同决定。
- **契约修改位置：** v1.1 第 16 节、第 20 节第 5、18 项。
- **当前已有能力：** Vio 有统一错误 envelope 和 400/404/409 等基础错误；引擎有领域异常，但没有正式分布式错误协议。
- **Vio 拟新增：** 分类映射、同 ID 有界重试、operation 查询、取消、审计和用户状态投影。
- **引擎拟新增：** 正式错误 envelope、operation query/cancel 和进度语义。
- **长期规划：** 非幂等现实操作的 UNKNOWN 状态优先人工/查询恢复，不自动重试。
- **是否阻塞第一轮最小测试：** schema、绑定、revision、幂等冲突的最小错误集阻塞；完整生产策略不阻塞。

### 9. Vio 与引擎双层门控

- **状态：接受**
- **引擎意见：** Vio 用户授权/安全/供应商账本不能替代引擎 Permission/ResourceManager，反之亦然。
- **Vio 回应：** 完全接受。执行条件是引擎主体层允许且 Vio 现实层允许；任意一方拒绝即终止。
- **契约修改位置：** v1.1 第 14 节。
- **当前已有能力：** Vio 已有 Permission → Security Policy → Confirmation、Model Router 和未受信 Token 元数据；引擎有 PermissionContext/ResourceManager。
- **Vio 拟新增：** 两层决定引用、真实供应商账本和 CapabilityResult 对账。
- **引擎拟新增：** 外部计量证明关联、等待/降级和结果吸收。
- **长期规划：** 用户付款与主体认知资源永久分账，不重复扣减。
- **是否阻塞第一轮最小测试：** 无真实能力时不阻塞；真实能力前阻塞。

### 10. 私密、秘密、派生、撤销和删除

- **状态：调整后接受**
- **引擎意见：** 原报告建议 Private Space 默认不可读、按 purpose/scope/expiry/consent 最小读取，并把它描述为用户控制的数据区域。
- **Vio 回应：** 接受数据最小化、秘密禁止、来源、撤销和派生治理；不接受用一个 Private Space 表达全部私密数据。正式改为 User Private Data、AI Private Space、Shared Space 三域。AI Private Space 在产品语义上属于 AI 主体，用户不能直接编辑覆盖；用户查看、AI 拒绝展示和主体删除仍待共同决定。
- **契约修改位置：** v1.1 第 7 节、第 12 节、第 20 节第 10—16 项。
- **当前已有能力：** Vio 已分开 User Space 生活数据和 Assistant Private Space，并有权限安全/不可变版本；但现有 AI 私域仍允许用户侧直接写，不符合新内容控制语义。Shared Space 尚不存在。
- **Vio 拟新增：** 三域分类、User Private Data 撤销传播、主体绑定的 AI 私域专用接口、Shared Space 版本规则。
- **引擎拟新增：** purpose/consent 引用、AI 私域读写提案/结果边界、撤销吸收和 Shared Space fact 类型。
- **长期规划：** 在产品、法律、隐私和主体连续性评审后确定披露、拒绝、删除和迁移政策。
- **是否阻塞第一轮最小测试：** 不阻塞，因为第一轮明确排除三层空间实际读写。

### 11. 历史 state_update 标记为 legacy/unverified

- **状态：接受**
- **引擎意见：** 旧平台状态可能来自调用方或旧规则，不能直接作为引擎 revision 0 或覆盖当前状态。
- **Vio 回应：** 完全接受。第一轮只使用引擎新建 revision 0 的全新测试主体。未来迁移必须有独立 Migration Session 和来源审查。
- **契约修改位置：** v1.1 第 4.2 节、第 18.2 节、第 19 节。
- **当前已有能力：** Vio 有不可变 state_update 历史和来源，但没有 engine revision/update ID，且公共 POST 仍能推进当前指针。
- **Vio 拟新增：** 冻结/关闭公共写入口、legacy/unverified 标记、受控迁移方案。
- **引擎拟新增：** Migration Session、事实验证、冲突报告和引擎内部迁移 Event。
- **长期规划：** 只迁移可验证事实，不迁移平台推断为权威状态。
- **是否阻塞第一轮最小测试：** 使用全新主体时不阻塞；使用既有 Vio 主体时阻塞。

### 12. 当前 APIService、本地 HTTP、UserInteractionService 不是生产接口

- **状态：接受**
- **引擎意见：** 进程内 APIService、本地 ThreadingHTTPServer 和调试 UserInteractionService 都缺少生产认证、租户、恢复和外部 Observation 边界。
- **Vio 回应：** 完全接受。当前 APIService、本地 HTTP 和 UserInteractionService 只能作为历史能力证据；APIService 仅可复用只读查询或内部辅助能力。第一轮 PlatformObservation 只能进入新增的 test-only 进程内 ContractTestAdapter。
- **契约修改位置：** v1.1 第 4.3、17.1、19.2、19.8、20.2 节。
- **当前已有能力：** 引擎调试接口可演示本地链路；Vio 当前 x-vio-user-id 也只是开发范围，不是认证。
- **Vio 拟新增：** 私有服务客户端、服务发现、认证、重放保护、限流和审计。
- **引擎拟新增：** 独立版本化 Integration Adapter、正式传输层、认证和生产健康语义。
- **长期规划：** 引擎保持独立私有服务，前端始终只连接 Vio。
- **是否阻塞第一轮最小测试：** 不阻塞。Engine E3 的 ContractTestAdapter 不复用 APIService.submit_message、不调用 UserInteractionService、不使用本地 HTTP，也不把 PlatformObservation、Vio Event 或摄取回执直接构造成内部 Event；Vio 已通过 test-only JSONL Runner 完成共享验收。

## 5. 三层数据空间差异

| 维度 | User Private Data | AI Private Space | Shared Space |
| --- | --- | --- | --- |
| 归属/内容权威 | 用户 | AI 主体 | 双方按版本化规则 |
| 知情权 | 用户知晓用途、范围、接收方和期限 | 主体知晓读写；用户知晓范围待共同决定 | 双方按版本规则知晓创建与修改 |
| 典型内容 | 财务、健康、身份、用户私密记录 | 私人笔记、认知整理、长期偏好、内部工作记录 | 纪念日、约定、关系记录、共同计划 |
| 用户修改 | 可以更正 | 不得直接覆盖 | 待共同决定 |
| AI 写入 | 只能受控建议/使用 | 通过引擎规则和主体绑定接口 | 待共同决定 |
| 读取前提 | purpose/scope/expiry/用户授权 | 主体绑定、专用接口和安全规则 | 版本化可见/确认规则 |
| 撤销/删除 | 用户可撤销并请求删除 | 披露、拒绝、主体删除待共同决定 | 双方权利待共同决定 |
| 与 SubjectState | 只能作为事实 | 不是状态权威 | 不是状态权威 |

共同禁止：不得保存或传输 API Key、Token、设备凭据、供应商秘密、完整模型思维链；不得直接产生 StateMutation。

## 6. 仍需双方共同决定

下列内容不是既定事实：

1. SubjectBinding 创建权、subjectId 生成、重绑定确认和跨 assistant/平台迁移。
2. 生产网络、认证、同步/异步/流式边界和正式端点。
3. operation/Capability/Outbox 的状态、期限、重试、取消和进度。
4. 第一轮之外的未来生产状态投影扩展字段、snapshot/delta 选择和签名方式。第一轮的 previousRevision/currentRevision、changed、engineUpdateId、最小 snapshot、contentHash、stateHash，以及按 subjectId+currentRevision、requestId 和非 null engineUpdateId 的幂等保存语义，均已由 v1.1 第 19.6 节固定，不属于待定项。
5. 回复与投影部分成功时的前端展示时点。
6. Summary 的范围、原文回查、更正、删除和撤销传播。
7. User Private Data 缓存/派生清理规则。
8. 用户查看 AI Private Space 的条件。
9. AI 是否可拒绝展示，以及拒绝/申诉流程。
10. 主体解绑、暂停、归档、删除时 AI Private Space 的保留、导出和删除。
11. 用户法定数据权利与 AI 私域内容控制权冲突时的流程。
12. Shared Space 的创建、修改、确认、撤销、冲突和删除规则。
13. 模型流经引擎审核后的分段展示。
14. Vio 供应商账本与引擎 ResourceManager 对账。
15. 遗留 state_update 的迁移范围和用户知情。
16. 多租户、保留、备份、灾难恢复和生命周期责任。
17. 主动 Wake/Action/Learning 的未来产品展示规则。

完整清单见 v1.1 第 21 节。

## 7. 是否阻塞第一轮最小连接测试

第二次审核指出下列内容必须在测试前固定；第三轮已将它们全部写入 v1.1 第 19 节，并已通过引擎最终只读短确认。Engine Runner `7a32a99` 与 Vio V2 `97874ee` 随后完成并通过双方 test-only 共享测试：

- 一个显式 SubjectBinding。
- 顶层请求、PlatformObservation 和 fact 组成的严格 Draft 2020-12 schema registry，以及完整有效一致性向量。
- requestId、requestHash、bindingFixtureHash、subjectId、bindingVersion、expectedEngineRevision 和唯一幂等错误码。
- revision 冲突、错绑定和重复请求的最小错误语义。
- 引擎 responseId、engineUpdateId/revision 的测试返回语义。
- Vio 对回复和投影的幂等保存。

因此，上述七项已经不再构成契约或第一轮 test-only 验收阻塞，Continuity Engine 也已确认不存在会使双方采取不同第一轮实现的规则。Engine 侧 Adapter/结果账本和 Vio 侧请求/结果/投影账本已经通过本地 JSONL 共享验收；不能把“test-only 共享验收通过”写成“产品或生产连接完成”。

机器契约校准已闭合文档精度；随后 Engine E1—E4、JSONL Runner 与 Vio V1—V3 实现了严格 Schema、Binding/hash、结果/投影账本和正式本机 HTTP delivery 基础，并完成第一轮 test-only 双方共享验收。E4/V3 双方 S2/S3 正式本机共享验收仍未开始。

不阻塞第一轮但阻塞生产的事项：

- 真实模型/Tool/MCP/设备和异步长任务。
- 三层数据空间实际读写。
- 通用重绑定与迁移。
- 生产认证、多租户、费用和部署。
- 完整 Outbox 运维参数、主动 Wake 和真实 Execution Engine。

## 8. 对齐自检

- 双权威状态：已消除。
- Vio 提交 StateMutation：明确禁止。
- Vio Event 直接变引擎 Event：明确禁止。
- 模型绕过引擎：明确禁止。
- 外部结果直接改状态：明确禁止。
- 重复请求/事件/回复/状态：分别使用稳定 ID 和持久化幂等。
- revision 冲突盲重试：明确禁止。
- AI 私域与用户私密混用：已拆成三层空间。
- 调试接口冒充生产：明确禁止。
- 将设计写成已实现：只把 Engine E1—E4、Vio V1—V3 及已通过的 test-only 共享验收标为已实现；双方 S2/S3、真实模型、对话 API 和前端真实回复仍标记未实现。

## 9. 本轮边界

本说明及 v1.1 的修订轮次只修订契约，没有修改前端、后端业务代码、迁移或 continuity-engine，也没有开始第一轮连接施工。Continuity Engine 正式接受后，Vio 另以独立档案同步任务更新 ADR、工程日志、路线图、README 索引和状态档案；该同步仍不包含代码施工。
