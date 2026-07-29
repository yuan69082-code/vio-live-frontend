# Continuity Engine 最终只读短确认 v1

## 1. 文档性质

- 日期：2026-07-30
- 来源：Continuity Engine 最终修订段落只读短确认
- 审核对象：[Continuity Integration Contract v1.1](14-continuity-engine连接契约v1.1.md) 与 [Engine Contract Response 对齐差异说明](14a-Engine-Contract-Response对齐差异说明.md)
- 最终结论：**Continuity Engine 正式接受 Continuity Integration Contract v1.1**
- 当前授权：允许双方同步各自工程档案；双方档案同步并核对一致后，可以共同制定第一轮最小连接施工提示词
- 明确未授权：第一轮代码施工、实际连接、共享测试或生产集成

本文只归档 Continuity Engine 给出的最终确认结论，不是 Vio 自行审核，不增加或改写 v1.1 的机器契约规则。此前第一次、第二次及最终校准前的“暂不接受”结论仍是各自时间点的真实历史记录；本文件记录当前有效的最终接受状态。

## 2. 最终复核范围

最终短确认只复核了上轮阻塞项、第 19 节修订、14a 对齐文字及相关引擎源码边界，没有重新讨论或推翻已确认的长期架构。引擎未发现仍会导致双方采取两种第一轮实现的文档规则，也未发现新的架构问题。

## 3. 第一轮 Schema registry

引擎确认第一轮 Schema registry 已闭合：

- 共三份 JSON Schema，均采用 Draft 2020-12。
- 使用三个唯一的绝对 URN `$id`。
- 两个 `$ref` 均可唯一解析。
- 禁止文件相对路径、网络回退和自定义别名。
- 顶层请求及嵌套对象均有严格 Schema，所有相关对象拒绝未知字段。
- `facts` 与 `observations` 各恰好一项。
- 第一轮时间只接受带 `Z` 的 RFC 3339 UTC。
- `format: date-time` 必须启用格式断言。

## 4. 正式 conformance vector

引擎确认完整请求一致性向量已通过，并且是正式 conformance vector，不是占位示例：

- `facts`、`observations` 各一项。
- `observationRefs` 正确引用唯一 Observation。
- 三处 identity 完全一致。
- conversation、message、version 引用一致。
- 消息正文只存在于 `platformFactPackage.facts[0].content`。
- 未发现未知字段或引用冲突。

## 5. 独立复算哈希与固定 Binding fixture

Continuity Engine 独立复算并确认：

- `contentHash`：`sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824`
- `requestHash`：`sha256:ec07ad9ba66d1ffcdfa9177cd61bec1b880ad6ee99a6ec6449e732c1b86002d0`
- `bindingFixtureHash`：`sha256:c75b72194c0158a549f3fb30f04a5147ea11a4e777cb1a9cc1a54da6b93359f6`

`requestHash` 计算时只排除顶层 `requestHash` 字段，其余逻辑请求字段全部参与。SubjectBinding fixture 的 ID、状态、时间和值均已固定，双方不得分别重新生成。

## 6. 第一轮幂等与 revision

- 第一轮唯一幂等错误码是 `IDEMPOTENCY_KEY_REUSED / never`。
- 适用条件是：Schema、`requestHash` 和完整 SubjectBinding 验证通过后，同一 `requestId` 对应不同 `requestHash`。
- `IDEMPOTENCY_CONFLICT` 不是第一轮有效错误码，也不得作为别名；它只可存在于明确标记为历史原文且已被取代的审核记录中。
- 当 `expectedEngineRevision != currentEngineRevision` 时，无论提交值较大或较小，均返回 `REVISION_CONFLICT / reassemble`。
- 只有 revision 完全相等才允许进入领域处理。
- 只有完整 SubjectBinding 验证通过后才可返回 `currentEngineRevision`；错误主体或错误绑定不得获得 revision 信息。

## 7. 第一轮投影唯一性

- 投影内容键：`subjectId + currentRevision`。
- 请求关联键：`requestId`。
- `engineUpdateId` 仅在非 `null` 时唯一。
- `changed=false`：revision 不变，`engineUpdateId=null`。
- `changed=true`：revision 只增加一次，`engineUpdateId=StateUpdateRecord.update_id`。
- 第一轮只使用最小 snapshot，不使用 delta。
- 同一 `subjectId + currentRevision` 不得存在内容、`contentHash` 或 `stateHash` 不同的第二份投影。
- v1.1 第 18.4 节的待定内容只适用于第一轮之外的未来生产协议。

## 8. Provider、Adapter 与 Event 边界

- `DeterministicThinkingProvider`、`MemoryRetriever`、`ReplyComposer` 三个确定性 test double 全部位于 Continuity Engine 进程内。
- 第一轮不产生 `CapabilityRequest` / `CapabilityResult`，Capability 协议不参加第一轮，Vio 不需要实现 capability stub。
- 第一轮不调用真实模型、Tool、MCP 或设备。
- `APIService.submit_message`、本地 HTTP 和 `UserInteractionService` 只可作为历史能力证据，不能作为第一轮摄取入口。
- 第一轮只能进入独立、test-only、进程内的 `ContractTestAdapter`。
- PlatformObservation、Vio Event 和摄取回执不能直接成为引擎内部 Event。

## 9. 长期架构保持不变

- Vio 与 Continuity Engine 是平行系统，不是包含关系。
- Continuity Engine 是 AI 连续性主体与 SubjectState 的唯一权威系统。
- Vio 负责用户、助手、会话、权限、平台数据、展示、托管和交互空间。
- PlatformObservation 与引擎内部 Event 严格隔离；Vio 不能替代引擎生成内部 Event、StateMutation、Evolution 结果或 SubjectState。
- SubjectState、Evolution、Memory、Thinking、Action、Permission 和 Resource 等权威边界保持不变。
- User Private Data、AI Private Space、Shared Space 三层数据空间边界已经获得接受，但不参加第一轮最小连接测试。

## 10. 当前工程状态

已经完成的是长期架构对齐、状态权威与 Observation/Event 边界对齐、v1.1 文档闭合、第一轮机器契约语义闭合以及 Continuity Engine 的正式接受。

仍未实现的是 PlatformObservation 运行时模型、严格 Schema validator、SubjectBinding 运行时能力、`bindingFixtureHash`/`requestHash` 运行时验证、ContractTestAdapter、request/operation/result 持久化账本、跨重启完整结果重放、Vio 状态投影接收器、revision 冲突运行时隔离、实际连接、第一轮共享测试、生产 Integration Adapter、生产认证、多租户和部署。

因此，“契约已正式接受”不得表述为“双方已经连接”“第一轮已经完成”“第一轮测试已经可以运行”或“生产集成已经完成”。

## 11. 后续入口

1. Vio 与 Continuity Engine 分别同步自身工程档案。
2. 双方核对档案中的状态、范围、边界与下一步是否一致。
3. 双方共同制定第一轮最小连接施工提示词，并分别确定施工顺序。
4. 只有取得后续明确授权后，才开始代码和共享测试施工。
