# Continuity Engine 第二次审核结果与第三轮修订回交报告

## 1. 文档状态

- 日期：2026-07-30
- 审核输入：Continuity Integration Contract v1.1、第一轮对齐差异说明、原 Continuity Engine 第二次审核报告
- 引擎审核结果：Engine Contract Second Review Response v1
- 引擎当时结论：**暂不接受 v1.1，存在阻塞第一轮最小连接测试的契约问题**
- 本报告形成时状态：**Vio 已按第二次审核第 9.1—9.9 节完成第三轮纯文档修订，等待 continuity-engine 下一轮最终只读确认**
- 当前有效状态：Continuity Engine 后续已完成最终只读短确认并正式接受 v1.1；见 [14c-Engine-Contract-Final-Read-Only-Short-Confirmation-v1.md](14c-Engine-Contract-Final-Read-Only-Short-Confirmation-v1.md)。本报告其余内容保留为第二次审核和第三轮回交时的历史快照。
- 实现状态：未开始连接施工；ContractTestAdapter、schema、持久化账本和连接代码均未实现

本报告保留“暂不接受”这一历史事实。第三轮完成文档修订不等于引擎已经正式接受；是否通过必须由引擎下一轮只读审核决定。

回交材料：

- [Continuity Integration Contract v1.1](14-continuity-engine连接契约v1.1.md)
- [Engine Contract Response 对齐差异说明](14a-Engine-Contract-Response对齐差异说明.md)

## 2. 第二次审核实际结论

引擎第二次审核没有否定以下总体方向：

- continuity-engine 是 SubjectState 唯一权威。
- Vio 不创建或提交 StateMutation。
- Vio Event、PlatformObservation 和内部 Event 必须分离。
- Vio 只提交 expectedEngineRevision。
- 最终认知 Context 由引擎组织。
- 模型和外部结果不能绕过引擎。
- 状态投影只能 Engine → Vio。
- 前端只连接 Vio，两边数据库独立。
- Vio现实权限/账本与引擎 Permission/Resource 双层门控。
- legacy/unverified state_update 不自动初始化或覆盖引擎。
- 当前 APIService、本地 HTTP 和 UserInteractionService 不是生产接口。

第二次审核对十二项修改的评价为：

- 正确落实：5 项——1、3、7、9、11。
- 部分落实：6 项——2、4、5、6、8、12。
- 存在新风险：1 项——10。
- 完全未回应：0 项。

因此当时不能开始第一轮施工。需要先闭合七个最小测试一致性问题，并补足 AI Private Space 的准确边界。

## 3. 七个阻塞项的本轮处理

| 阻塞项 | 第二次审核发现 | 第三轮正式修订 | v1.1 位置 | 当前结论 |
| --- | --- | --- | --- | --- |
| 输入 schema | Observation 双位置、缺 bindingId、正文可能重复 | 顶层 observations 唯一承载；精确 message_created 与 message_version schema；正文只在 fact | 19.1 | 文本已闭合，待引擎确认 |
| 固定 Binding | 创建方、fixture 和拒绝语义未定 | 引擎建全新 subject/revision 0；Vio生成 bindingId；同一不可变 fixture 装载双方 | 19.3 | 文本已闭合，待引擎确认 |
| 确定性替身层级 | 引擎内 double 与 Vio stub 两种可能 | 三个 test double 全部在引擎进程内；第一轮无 CapabilityRequest/Result | 19.4 | 文本已闭合，待引擎确认 |
| 成功结果/投影 | revision 字段、no-change update ID、snapshot/delta 未定 | 固定 previousRevision/currentRevision、no-change=null、changed update_id、只用最小 snapshot | 19.6 | 文本已闭合，待引擎确认 |
| 错误 envelope | 最小字段、retryClass、防泄露未定 | 固定完整 JSON envelope 和四类错误映射 | 19.7 | 文本已闭合，待引擎确认 |
| 摄取入口 | APIService.submit_message 可能提前创建内部 Event | 明确禁止该入口；第一轮必须使用独立进程内 ContractTestAdapter | 19.8 | 文本已闭合，待引擎确认 |
| 持久化幂等 | 内部 Event 去重不能返回完整首次结果 | 固定永久 requestId、RFC 8785 + SHA-256 requestHash、双方跨重启持久化完整结果 | 19.5、19.6、19.8 | 文本已闭合，待引擎确认 |

这里的“文本已闭合”只表示 v1.1 不再保留两种互斥说法。上述最小能力当前尚未实现，且在引擎最终确认前不得开始施工。

## 4. 第 9.1—9.9 节落实情况

### 9.1 PlatformObservation

已完整写入 v1.1 第 19.1 节，并固定：

- ContinuityInteractionRequest.observations 是唯一承载位置。
- PlatformFactPackage 只通过 observationRefs 引用。
- identity 包含 userId、assistantId、subjectId、bindingId、bindingVersion。
- 第一轮只允许一个 message_created Observation。
- Observation 只含事件身份、sourceEventId、时间和 MessageVersion 引用。
- 正文只存在于唯一 message_version fact。
- 所有层级拒绝未知字段。
- 禁止状态字段统一 SCHEMA_INVALID / never，不进入领域模型。

新增了完整 JSON Schema、Observation/fact/request 的交叉引用规则和正文唯一性规则。

### 9.2 内部 Event

已写入 v1.1 第 3.1 和 19.2 节：

- 摄取回执或来源经历记录不是内部 Event。
- 它们不拥有状态写权限，不推进 revision。
- 只有引擎创建内部 Event。
- 只有合法获批 UPDATE_STATE 创建 StateMutation，并通过 Evolution 改变状态。

### 9.3 第一轮固定 Binding

已写入 v1.1 第 19.3 节：

- 引擎创建全新 subjectId 和 revision 0。
- Vio生成固定 bindingId。
- bindingVersion=1、status=active 的同一不可变 fixture 装载到双方。
- 第一轮没有绑定 API。
- 任一绑定字段/status 错配统一 SUBJECT_BINDING_MISMATCH。
- 错误不泄露其他主体存在性。

### 9.4 第一轮确定性 Provider

已写入 v1.1 第 10 节末、19.4 和 20.1 节：

- DeterministicThinkingProvider、MemoryRetriever、ReplyComposer 全部位于引擎进程内。
- 第一轮不产生 CapabilityRequest/CapabilityResult。
- Vio 不实现 capability stub。

### 9.5 持久化幂等

已写入 v1.1 第 19.5 节：

- requestId 是永久幂等键。
- requestHash 使用逻辑请求去除 requestHash 后的 RFC 8785 规范化结果，再计算 SHA-256。
- 传输尝试、重试时间、网络头、签名和 trace 不进入 hash。
- 相同 ID/hash 返回第一次完整 operation/response/projection。
- 相同 ID/不同 hash 返回 IDEMPOTENCY_CONFLICT。
- 双方重启后仍可恢复。

### 9.6 第一轮结果与投影

已写入 v1.1 第 11.1—11.2 和 19.6 节：

- previousRevision/currentRevision 为唯一字段名。
- 无变化：changed=false、revision 不变、engineUpdateId=null。
- 有变化：changed=true、revision+1、engineUpdateId=StateUpdateRecord.update_id。
- 第一轮只有最小 snapshot，没有 delta。
- 固定 operationId、responseId、consumedObservationIds、snapshot/state hash。
- Vio按 subjectId+currentRevision、engineUpdateId、requestId 幂等保存。
- 旧/跳号/错绑定/hash 冲突进入 reconciling，不推进当前指针。

### 9.7 第一轮错误 envelope

已逐字段写入 v1.1 第 19.7 节：

    {
      "contractVersion": "continuity-integration/v1.1",
      "requestId": "opaque-request-id",
      "operationId": null,
      "status": "failed_terminal",
      "error": {
        "code": "SCHEMA_INVALID",
        "message": "non-sensitive stable message",
        "retryClass": "never",
        "currentEngineRevision": null,
        "currentBindingVersion": null
      }
    }

固定映射：

- SCHEMA_INVALID / never
- SUBJECT_BINDING_MISMATCH / never
- REVISION_CONFLICT / reassemble，并返回 currentEngineRevision
- IDEMPOTENCY_CONFLICT / never

错主体和错绑定使用完全相同的 code、message 和 null 字段。

### 9.8 ContractTestAdapter

已写入 v1.1 第 17.1、19.8、20.2 节：

- APIService.submit_message、本地 HTTP、UserInteractionService 均不得摄取第一轮 Observation。
- APIService 只可复用只读查询或内部核心辅助能力。
- 独立 ContractTestAdapter 验证 schema、requestHash、Binding、持久化幂等、expectedEngineRevision。
- Adapter 不把 PlatformObservation 直接变成内部 Event。

### 9.9 AI Private Space

已写入 v1.1 第 12.2 和 19.9 节：

- “AI内容控制权”只表示产品内由绑定主体的引擎流程决定创建、编辑、展示和使用。
- 不主张 AI 法律人格、财产权或法律数据控制者地位。
- AI Private Space 不是 SubjectState、PersonalityTrait 权威库、Memory 管理层或 Learning 证据放大器。
- 同一内容谱系的复制、版本或重复读取不能算多份独立证据。
- 写入只能来自引擎明确行动决定或专用请求。
- Vio可验证、拒绝、加密、版本化和存储，不能替 AI 创作、补写、改写或推断。
- AI普通产品拒绝展示不能阻止合法删除、安全处置、法定访问或合规清除。
- 删除账号、解绑、暂停、归档、永久删除主体是不同操作。

三层数据空间总体设计没有改变，且第一轮继续排除实际读写。

## 5. 第一轮固定请求和响应摘要

第一轮请求：

- 一个全新 subject，revision 0。
- 一个固定 active Binding fixture。
- 一个 message_created Observation。
- 一个 message_version fact，正文唯一。
- 一个 requestId 和 SHA-256 requestHash。
- 一个 expectedEngineRevision。

第一轮成功结果：

- status=completed。
- 稳定 operationId、responseId。
- consumedObservationIds 返回唯一 Observation。
- 无变化 engineUpdateId=null。
- 有变化 engineUpdateId=StateUpdateRecord.update_id。
- 最小 snapshot，不使用 delta。

第一轮错误：

- schema/禁止字段：SCHEMA_INVALID / never。
- 错主体/绑定：SUBJECT_BINDING_MISMATCH / never。
- 旧 revision：REVISION_CONFLICT / reassemble。
- 同 requestId 不同 hash：IDEMPOTENCY_CONFLICT / never。

## 6. 当前已有能力与仍需新增

### 引擎当前已有

- SubjectState/revision 和 revision 0 创建。
- expected_revision。
- 内部 Event、StateMutation、Evolution、StateUpdateRecord.update_id。
- Perception 只读边界。
- ThinkingProvider seam、Action 决策边界。
- JSON 状态/更新记录重启恢复。

### Vio 当前已有

- User/Subject/Conversation/MessageVersion。
- Vio Event 和来源 ID。
- Permission/Security/Confirmation。
- 当前本地持久化和事务基础。

### 第一轮仍需新增但本轮未实现

- 引擎 ContractTestAdapter。
- PlatformObservation/request/fact schema 实现。
- 固定 Binding fixture 装载。
- 三个进程内 test double fixture。
- 引擎 request/operation/result 持久化。
- Vio request/result/projection 幂等持久化。
- 成功/错误 envelope 生成与解析。
- reconciling 状态处理。

这些属于后续施工，不得因文档已写入而标记为已完成。

## 7. 仍不阻塞第一轮的待定事项

- 正式网络、域名、证书、mTLS/令牌和部署。
- 生产同步/异步/流式边界。
- 通用重绑定和跨平台迁移。
- 生产 snapshot/delta 扩展。
- 完整 Outbox 运维参数。
- CapabilityRequest/Result 和真实模型/Tool/MCP/设备。
- 三层数据空间实际接口和产品流程。
- 供应商 Token/费用。
- 多租户、备份、灾难恢复。
- 主动 Wake、通知和 Execution Engine。
- AI法律人格、数据控制者和其他最终法律判断。

## 8. 请求 continuity-engine 下一轮确认

请引擎下一轮只读审核明确回答：

1. 第 19.1 节精确 Observation/fact/request schema 是否足以让双方生成相同 requestHash。
2. 第 19.3 节 Binding fixture 初始化和统一拒绝是否可接受。
3. 第 19.4 节是否正确固定为引擎进程内 test double、无 Capability 往返。
4. 第 19.6 节成功 envelope、最小 snapshot、无变化/有变化语义是否可接受。
5. 第 19.7 节错误 envelope 与四类映射是否可接受。
6. 第 19.8 节 ContractTestAdapter 校验顺序是否可接受。
7. 第 19.5 节 RFC 8785 + SHA-256 和跨重启完整结果重放是否可接受。
8. 第 19.9 节是否消除了影子 SubjectState、影子 Learning 和法律所有权误读。
9. 七个契约阻塞项是否可以正式关闭。
10. 是否允许在后续单独指令下制定第一轮最小连接施工方案。

在引擎给出确认前，Vio 不开始实现。

## 9. 本轮边界

本轮只修改三份未提交 Markdown 文档。没有：

- 修改 Vio 前端代码。
- 修改 Vio 后端业务代码或测试。
- 修改数据库迁移。
- 修改 continuity-engine。
- 创建 ContractTestAdapter、schema 实现或测试。
- 编写连接代码。
- 开始第一轮施工。
- 更新 ADR、工程日志、路线图、README 索引或工程总档案。
- 提交、推送或创建 commit。
- 宣称 v1.1 已获引擎接受。
