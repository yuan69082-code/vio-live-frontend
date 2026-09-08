# R4 前端交接

状态：R4 前端代码、严格接口解析、页面接线、专项与全量回归、类型检查、生产构建及受控本机浏览器联调已经完成；总体协调窗口已于 2026-09-08 正式验收 R4。R5 或后续阶段尚未开始。

## 唯一接口来源与阶段边界

- 唯一合同：`backend/docs/R4_CONTEXT_ASSEMBLY_CONTRACT.md`。
- 页面仍使用 R2 个人会话、服务端当前助手及 R3 当前会话/分支；浏览器不发送固定 `userId`、`assistantId`、`subjectId` 或开发身份头。
- 六个主导航完整保留；R4 只在真实个人多会话页增加上下文控制、装配预览、锁定快照、来源证据和折叠恢复。
- 独立模式是聊天执行前提。外部主体运行时只以受控 double 验证只读投影；切换到 external 后，独立聊天仍由服务端拒绝，不调用 Provider。
- 长期记忆明确显示为 `R5 尚未实现`，不注入模拟记忆；未实现真实 Engine 接入、真实供应商、真实凭据、部署或收费调用。
- 浏览器持久存储只沿用 R3 的随机恢复键和必要不透明索引；不保存消息正文、装配快照、精确证据、口令、密钥或完整响应。

## 页面与接口矩阵

| 页面位置 | 动作 | 真实接口 | 成功事实 | 失败与恢复 | 前端证据 |
| --- | --- | --- | --- | --- | --- |
| 对话页上下文摘要 | 读取当前模式、Token 预算及边界 | `GET /api/v1/personal/chat/conversations/{conversationId}/context-settings`；`GET .../context-plan` | 显示服务端默认、会话保存值、当前生效值、固定槽位、来源、预算和 plan hash 对应的预览 | 读取失败显示错误并可重新读取；未就绪或超预算时禁止发送 | `PersonalMultiConversationPage.test.tsx` |
| 模式选择 | 精简、标准、完整、自定义 | `GET .../context-plan?branchId=&mode=&excludeSourceRef=` | 只读预览；未保存选择明确标注仅作为下一轮覆盖 | 旧预览请求中止；迟到成功、失败和 `finally` 不覆盖新作用域 | 同上 |
| 会话设置 | 保存模式和排除项 | `PATCH .../context-settings` + `Idempotency-Key` | 以后端返回的 version/effective 为准；刷新后恢复 | 版本冲突重读；确定失败结束键；超时、断网或未知结果保留原键，不盲重发 | 同上；`personal-context-api.test.ts` |
| 自定义来源 | 排除/恢复可选来源 | `GET .../context-plan` | 必需系统规则、助手设置和本轮用户消息不能被排除；排除项写入 turn controls 与快照 | 非 custom 或非法来源由合同错误显式拒绝 | 同上 |
| 消息发送 | 带本轮上下文控制提交 | R3 `POST .../turns`，增加 `context={mode,excludedSourceRefs,expectedPlanHash}` | 真实用户消息、轮次、不可变 context snapshot、受控 Provider 回复均来自后端 | plan stale、折叠失败、预算超限、配置问题和结果未知分别显示；同次发送复用原 R3 幂等键 | 同上 |
| 已锁定轮次 | 查看不可变范围与预算 | `GET /api/v1/personal/chat/turns/{turnId}/context` | 预览与已锁定快照分区显示；快照记录 controls source、来源状态、预算、折叠和 runtime projection | 快照不存在不冒充成功；作用域切换会中止旧读取 | 同上 |
| 锁定来源 | 查看精确消息/事件/摘要证据 | `GET /api/v1/personal/chat/context-sources/{encodedSourceRef}` | 只对已锁定的 `message_version`、`event`、`summary` 显示证据按钮；系统规则和助手设置仅提示内部约束 | 预览来源不提前提供精确证据；跨归属、未引用或未知来源保持 404 | 同上；`personal-context-api.test.ts` |
| 折叠恢复 | 仅在 `fold_failed` 时重试 | `POST /api/v1/personal/chat/turns/{turnId}/context-recovery` + 独立恢复键 | 严格接收 `{context,turn,externalCall}`，校验 turn/context 作用域一致后更新 | `fallback_original` 不展示不安全重试；未知结果保留原恢复键 | 同上 |
| 配置错误 | 引导能力/我的 | 复用真实六导航 | Provider、模型、Vault、凭据问题进入已有真实配置页面 | 不提供无效按钮或假成功 | 同上 |

## 严格响应与并发约束

- `src/api/personal-context-api.ts` 对 settings、plan、snapshot、evidence 和 recovery wrapper 做逐层精确键校验；未知顶层或嵌套字段、未知枚举、hash/ID/状态不一致都作为 `invalid_response` 拒绝。
- 预算只接受冻结的 10 个公开字段：估算方法、上下文上限、输出预留、输入预算、原始输入估算、计划后输入估算、是否在限额内、是否计划折叠、是否裁剪及裁剪原因；内部 `source` 等字段不得泄露。`fold_failed` 明确要求 `withinLimit=false`，不会因估算值为 0 被误判为合法快照。
- settings 和 controls 严格区分仍有效的 `excludedSourceRefs` 与只用于审计/清理的 `unavailableExcludedSourceRefs`；后者不得进入预览、发送或 Provider。
- planned 必须保持 `assemblyId/turnId/providerMessagesHash/snapshotHash/lockedAt=null` 且 selection 为 provisional；locked 必须具备全部 hash、锁定时间及 final selection；`fold_failed`/`budget_blocked` 只保留失败候选，Provider/snapshot hash 与锁定时间必须为空。
- 摘要证据只接受 `vio-context-summary/v1` 结构、精确 scope、顺序稳定的 `sourceRefs` 与逐项 `sourceHashes`；页面同时核对证据 `contentHash` 与锁定来源 hash，不匹配即拒绝展示。
- runtime projection 的状态与 `sourceRef` 必须一致；精确证据按 message/event/summary 三类分别校验，不接受宽泛联合对象。
- 身份、助手、会话、分支变化都会递增上下文代际，中止 settings/preview/snapshot/evidence 请求并清理页面内存；旧成功、失败和 `finally` 不得污染新视图或释放新写锁。
- 发送前必须同时具备当前 conversation/branch 的 settings、plan、模式一致和 `withinLimit=true`。重复点击由 R3 写锁拦截；响应未知后先按原 key/turnId 查询。
- 精确证据、上下文预览和锁定快照只保存在当前组件内存；关闭、卸载、身份或助手变化后清理。

## 初轮浏览器联调证据（重构前历史）

本机使用 `127.0.0.1`、全新临时 SQLite、真实 R2 个人会话、两用户 × 两助手、R3 多会话和受控 loopback Provider。未读取 Engine，未使用真实供应商或凭据。

| 场景 | 服务端事实 | 页面结果 |
| --- | --- | --- |
| 四种模式与保存恢复 | concise `3271/4300`、balanced `3271/7987`、complete `3271/12288`；custom 排除后预算随来源变化 | 四种模式均真实预览；custom 保存后显示“会话保存：自定义”，重载仍恢复 |
| 标准上下文真实发送 | 新夹具修复后正常创建 turn、锁定 23 项来源并只调用 Provider 1 次 | 显示真实用户消息与 `受控 owner-a R3 回答 1。`；无 `CONTEXT_PLAN_STALE` |
| custom 排除真实发送 | 排除一项同助手跨窗口用户消息；锁定快照保留 `已排除`，Provider 再增加 1 次 | 显示真实回复 `回答 2`；预览与快照分区清楚 |
| 精确证据 | 锁定 event 返回 eventType/summary/data；本轮 message 返回精确版本与 content hash | 仅锁定来源出现“查看精确证据”；两个证据对话框均可打开 |
| 两助手隔离 | A1 有 53 个会话，A2 只有自己的 2 个；A2 预览 5 个来源且不含 A1 消息 | 切到 A2 后 A1 会话、消息和来源不可见；切回 A1 后 custom 设置、会话和历史恢复 |
| 两用户隔离 | owner-b 登录后只返回 B1 的两个专属会话；A 的 turn/message/provider 计数不变 | B 页面不含 A 标题、消息或上下文；返回 A 重新验证后原数据完整 |
| 首次 POST 响应丢失 | `droppedResponses=1`；恢复前 owner-a 仍只有原 turn，按原键找回 waiting confirmation；批准后总计 3 turns/6 messages/3 provider calls | 先显示“结果未知”且输入保留，只允许“按原键查询”；恢复后只出现一次用户消息和一次 `回答 3` |
| 同库重启与刷新 | 重启前后 owner-a 维持 53 conversations、3 turns、6 messages、3 provider calls | 访问会话恢复；进入对话后 A1 当前会话、custom 保存值、排除项和真实历史均恢复 |
| 外部运行时投影 | 受控 double 使 plan 增加 `runtime_projection`，内容明确未联系外部运行时；Provider 计数保持 3 | 页面显示“运行时投影 · 已纳入”；尝试发送被 `当前不是独立聊天模式` 拒绝，输入保留，turn/message/provider 均不增加 |
| 390px 窄屏 | 实际 inner/document/body 宽度均为 391（浏览器校准值），document/body `scrollWidth == innerWidth`；可交互元素越界数 0 | 无横向滚动，底部六导航和上下文卡片可用；控制台 0 error、0 warning |

夹具停止前最终控制账本：owner-a `conversations=53, turns=3, messages=6, providerCalls=3`；owner-b `conversations=4, turns=0, messages=0, providerCalls=0`；`droppedResponses=1`。最终为独立模式，`engine=not_accessed`、`externalProvider=not_used`、`providerCharge=not_incurred`。

## 已记录的失败与普通缺陷修复

- 最初前端专项有 3 个普通失败：折叠恢复夹具状态不合法、保存提示被后续预览覆盖、超预算断言未对应真实状态；均修正实现或夹具且保留断言。
- 锁定来源展示回归一度因页面同时出现预览与快照的同名文本而失败；测试改为限定已锁定区域，未减少两区同时展示要求。
- 一次类型检查因测试快照状态被推断为普通字符串失败；改为显式 `ContextAssembly` 类型后通过，没有使用类型逃逸。
- 严格前端解析在真实页面先发现后端 preview budget 泄露内部 `source` 字段；后端移除该字段并增加精确键回归，前端未放宽解析。
- 首个 runtime toggle 只改可变变量，但服务启动时缓存了 runtime 状态；浏览器真实验证发现后，夹具改为重建应用，投影与禁止聊天均重新验证。
- 预览来源曾错误显示精确证据按钮并得到 404；前端改为只有 turn 锁定快照来源可查证，预览明确提示“发送并锁定后可查证”。
- 真实标准发送首次稳定复现合法 plan hash 被判 stale：后端先 LIMIT 20 条事件再过滤新写入的 `message_created`，导致 preview 与 turn 的来源集差 1 项。后端改为在 SQL LIMIT 前排除 message 事件，并新增“20 条事件边界 + 当前消息写入后 hash 一致”回归；新夹具真实发送通过，前端没有移除 expectedPlanHash。
- 最终专项首次为 34/35：助手切换回归在新助手 context plan 尚未读取完成时点击了依法禁用的发送按钮。测试增加“等待新助手输入区恢复可用”前置断言后再发第二次写入，继续验证旧助手请求已 abort 且迟到 `finally` 不释放新锁；未删除或放宽原断言。复跑 35/35。

## 初轮前端验证（重构前历史）

- R4 专项：`pnpm test src/api/personal-context-api.test.ts src/pages/PersonalMultiConversationPage.test.tsx`：2 个文件、35/35 通过。
- 前端全量：`pnpm test`：21 个文件、268/268 通过。
- 类型检查：`pnpm run typecheck`：通过。
- 生产构建：`pnpm run build`：通过；Vite 8.2.1 转换 141 个模块，生成 JS 492.25 kB（gzip 144.52 kB）和 CSS 159.29 kB（gzip 26.25 kB）。
- 手机实机、真实 Engine、真实供应商、真实凭据、公网部署：未执行，且不在本阶段授权内。
- 后端在接受当前前端版本后完成最终串行复验：R4 专项 15/15、受影响 R1/R3 flow 30/30、R1/R3/027 migration 19/19；最终默认全量 435 项中 434 通过、0 失败、1 条既有 RFC 跨仓条件跳过，退出 0。该跳过项未执行、不计为通过；共同工程档案由后端窗口汇总。

## R4 重构最终证据（2026-09-08）

### 接口与页面同步

- 前端 DTO 已同步最终冻结合同：预算原始值与计划后值、fold planned、provisional/final relevance selection、来源排名与 representation、`providerMessagesHash`、失效排除项，以及折叠失败的 `reason/sourceSetHash/sourceCount/recoveryAction` 均为严格字段。
- 页面明确展示原始历史超限但经确定性折叠/裁剪后可发送，不把原始超限误报为阻塞；最终锁定快照与下一轮预览分开保留。
- 消息历史或终态轮次变化会刷新 plan。页面用 owner/assistant/conversation/branch 作用域保存最近锁定 turn 的只读事实，只在同一作用域内重新读取快照，避免第二轮复用旧 `planHash`，也避免切换后泄漏旧快照。
- 已保存排除来源失效时，页面按服务端最新 settings 自动恢复预览，显示审计提示，并允许再次保存以清理失效引用；迟到 403 不会污染新页面。

### 全新隔离浏览器闭环

本轮重新创建临时 SQLite、真实个人会话、两用户 × 两助手和受控 loopback Provider；测试完成后夹具输出 `fixture_removed=true`。未读取 Engine、未使用真实供应商/凭据或收费调用。

| 场景 | 本轮实际证据 |
| --- | --- |
| 长历史预算与连续发送 | 连续完成 6 个长轮次，首次真实浏览器运行在第二轮暴露 `CONTEXT_PLAN_STALE`；修复后连续发送通过。预览显示 `8878 → 7961 / 7987`，后端重启后长历史显示 `14485 → 651 / 7987`，本轮用户消息仍为必需项。 |
| 结构化摘要与精确证据 | 第 6 轮锁定快照显示“摘要就绪”、预算 `2427 / 7987`；精确证据为 `vio-context-summary/v1`，带 summaryId、精确 conversation/branch scope、2 个顺序来源和内容 hash。 |
| 最终相关度选择 | 新建更晚的无关会话后，从新查询会话发送“紫罗兰预算”查询；锁定快照显示 final `2/2`。较旧长会话摘要为排名 #1、命中 46 项、使用最新有效摘要；较新无关会话为排名 #2、命中 13 项。 |
| 自定义排除与失效来源 | 自定义排除跨窗口摘要并真实保存；来源分支变化后页面显示 1 项排除来源不可用，明确其不会进入预览、发送或 Provider。再次保存清理引用，随后真实发送得到 `受控 owner-a R3 回答 10。`，未出现 403。 |
| 响应未知与原键恢复 | 注入一次 turn 响应丢失后，页面显示“结果未知”，只允许按原键查询；找回 waiting confirmation。后端重启导致 Vault 锁定时显示“可以安全重试”并真实导航能力页；重新解锁后沿用原操作完成，只产生一次用户消息与一次回答。 |
| 重启与刷新 | 同库重启后个人访问、当前助手、会话、消息历史和 R4 设置均从服务端恢复；Vault 锁定不被冒充 ready。浏览器刷新先回工作台，再进入对话可恢复当前服务端会话事实。 |
| 助手与用户隔离 | A1 的 R4 会话在 A2 页面不可见，切回 A1 后历史恢复；切换受控后端至 owner-b 时旧会话要求重新登录，B1 页面无 A 数据，再切回 A 后原事实完整恢复。 |
| 390px 与控制台 | 视口请求 390px、浏览器校准 `innerWidth=391`；`body/document scrollWidth=391`，无横向滚动。唯一越界元素是 `main-ambient` 纯装饰且不扩大滚动宽度。全新标签页完成恢复与页面交互后控制台 0 error、0 warning。 |

夹具停止前最终控制账本：owner-a `conversations=56, turns=10, messages=20, providerCalls=10`；owner-b `conversations=4, turns=0, messages=0, providerCalls=0`；`droppedResponses=1`。最终 `engine=not_accessed`、`externalProvider=not_used`、`providerCharge=not_incurred`。

### 重构失败与修复记录

- DTO 重构后的首轮前端全量为 273/274：旧 StrictMode 用例在上下文 plan 尚未加载时点击依法禁用的发送按钮。测试增加等待输入可用的前置断言，保留重复点击、abort 和迟到 `finally` 断言；复跑 274/274。
- 全新浏览器的连续长轮次首次复现第二轮 `CONTEXT_PLAN_STALE`：消息刷新后页面仍持有上一轮 plan。实现改为消息数/终态变化时重读 plan，并以完整作用域重新读取最近锁定快照；新增连续两轮 planHash 回归。修复后的专项为 42/42、全量为 275/275。
- 首次修复后的类型检查发现 `snapshotValue.turnId` 仍为可空类型；改为显式非空分支后通过，没有断言绕过或类型逃逸。
- 旧标签页仍保留热更新前的依赖数组长度警告，因此没有把旧日志冒充最终证据；全新标签页从零加载并完成最终交互后日志为空。

### 最终串行验证

- 前端 R4 专项：2 个文件、42/42 通过。
- 前端全量：21 个文件、275/275 通过。
- `pnpm run typecheck`：通过。
- `pnpm run build`：通过；Vite 8.2.1 转换 141 个模块，JS 500.34 kB（gzip 146.72 kB），CSS 159.29 kB（gzip 26.25 kB）。构建仅报告现有单 chunk 超过 500 kB 的非失败提示。
- 后端 R4 专项：27/27；受影响 R1/R3 flow：61/61；migration：19/19。
- 后端在 Node 22.23.1 的默认全量：447 项中 446 通过、0 失败、1 条既有 RFC 隔离跳过；跳过项不计为通过。
- 手机实机、真实 Engine、真实供应商、真实凭据和公网部署未执行，且不在本阶段授权内。

`EVIDENCE_CONFLICT=RESOLVED`：最终合同字段、单元/全量验证、后端串行数字与本轮全新浏览器事实一致。`PLANNING_CONFLICT=NONE`。

## 前端文件归属

新增：

- `src/api/personal-context-api.ts`
- `src/api/personal-context-api.test.ts`
- `src/components/conversation/ContextControlPanel.tsx`
- `src/components/conversation/ContextControlPanel.module.css`
- `docs/R4_FRONTEND_HANDOFF.md`

局部修改：

- `src/api/personal-multi-chat-api.ts`
- `src/pages/PersonalMultiConversationPage.tsx`
- `src/pages/PersonalMultiConversationPage.test.tsx`

本窗口未修改全局样式、依赖配置或 R5 文件。`backend/**` 与共同工程日志的改动归后端窗口所有；前端未覆盖、暂存或清理。
