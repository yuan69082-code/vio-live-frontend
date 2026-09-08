# 后端测试策略

## R5 本地长期记忆当前专项

R5 后端三个专项当前合计 **13/13**，0 失败、0 跳过：

- `local-memory-r5-flow.test.js`：5/5，验证 owner/current-assistant 归属、不可变版本、显式来源、确定性检索、Context 参与、权限/安全确认、导入导出、归档/恢复、受控删除和 HTTP 合同。
- `local-memory-r5-recovery.test.js`：5/5，验证幂等冲突、逐项导入、操作/删除中断、同库重启恢复、终态保护，以及 R4 锁定精确 memory version 后不被后续变化改写。
- `local-memory-r5-migration.test.js`：3/3，验证迁移 `028` fresh、`001–027` upgrade、失败完整回滚、外键/唯一性/不可变与 owner-scoped 删除保护。

R1/R3/R4 受影响十文件组合首次 **106/109**，失败均来自历史 migration fixture 未排除新迁移 `028`；修正 fixture 边界后最终 **109/109**。七个历史升级/兼容文件组合最终 **46/46**。R5 初次实现过程的 4/8、6/8、7/8、8/8，以及 recovery 2/5→5/5 均保留为真实返修证据。默认全量首次误在不受支持的 Node 24.19.0 启动，460 项中 458 通过、1 失败、1 跳过；失败暴露 R5 启动恢复在 SQLite 被真实写锁占用时未延后。补齐仅对 SQLite busy 的 fail-safe 延后并以受影响测试 3/3 验证后，在正式 Node 22.23.1 / Corepack pnpm 11.9.0 下重跑默认全量：**460 项，459 通过、0 失败、1 条既有 RFC 隔离跳过，退出 0**。跳过项未执行、不计通过。

最终公共 DTO 复核又发现 R4 `selection` 多暴露两个仓储计数字段。收口公共五字段后，旧 recovery 首次 **11/12**、十文件组合首次 **108/109**；定点修正旧测试对内部与公共 selection 的错误等同比较后分别 **12/12**、**109/109**，R5 三文件再验 **13/13**。一次组合命令因人工误列不存在的 `standalone-chat-r3-operations.test.js` 在启动前退出、实际执行 0 项；它是命令清单错误，不计为测试通过或产品失败。最终默认全量仍为上述 459/460。

R5 自动化只使用临时 SQLite 与受控本地依赖；没有真实 Engine、真实 Provider、真实凭据、业务公网或费用。R5 完成不表示 R11 完整备份、云同步、外部运行时记忆或 R6 已开始。

## R4 上下文装配当前专项

R4 后端三个专项在验收返修后合计 **27/27**，0 失败、0 跳过；实现完成并等待总体协调窗口阶段验收：

- `context-assembly-r4-flow.test.js`：12/12，验证固定装配顺序、R1/R3 同一 execution 的快照绑定、设置/预览/精确证据、跨窗口与作用域隔离、当前消息相关性排序、仍有效的最新 ready summary、失效排除项对 clear/delete/branch/access-revoke 的调和、长 preview 折叠/裁剪、可选已验证投影、非法控制/stale plan、20 条未解决事件边界下 preview/turn hash 稳定、预算阻断和零多余调用。
- `context-assembly-r4-recovery.test.js`：12/12（7 个顶层场景及 5 个恶意 summary builder 子场景），验证结构化折叠、原文安全 fallback、fold_failed 显式恢复、缺字段/未知字段/错 scope/错来源/源对象变异拒绝、failed candidate 跨重启保留、summary/assembly/locked source 原子回滚、发布崩溃同库恢复，以及 `outcome_unknown` 重放/重启不重组快照、不重复 Provider。
- `context-assembly-r4-migration.test.js`：3/3，验证 `027` fresh、`001–026` upgrade、失败完整回滚、execution snapshot hash 绑定、source phase/关系字段、复合外键、唯一性与不可变保护。

R1/R3 flow 受影响四文件组合最终 **61/61**；R1/R3/027 migration 组合 **19/19**。首次实现阶段的 15/15、历史全量首次 **434 项：428 通过、5 失败、1 条既有 RFC 隔离跳过**，以及修复 migration fixture 后的 435 项结果继续保留为过程证据。验收返修后的最终默认 `corepack pnpm test` 为 **447 项：446 通过、0 失败、1 跳过，退出 0**。唯一跳过仍是隔离启动器指向不存在路径的 RFC 跨仓实现对照；未执行、不计通过，也未读取真实 Engine。

受控页面联调首次在运行时投影开启时正确拒绝 standalone turn，关闭投影后却暴露 `CONTEXT_PLAN_STALE`：事件仓储原先先取最近 20 条、再由 R4 在内存中过滤 `message_created/message_updated`，当前用户消息事件因此挤出一条原预览事件并改变 hash。修复后排除条件在 SQL `LIMIT` 前执行；新增第 7 条 flow 回归锁定“20 条未解决事件 + 新建当前消息”仍保持同一 plan hash、只调用一次 loopback Provider，同时保留伪造 stale hash 的拒绝断言。

R4 自动化只使用临时 SQLite、受控依赖注入与随机 loopback Provider。没有真实运行时/Engine、真实供应商、真实凭据、业务公网或费用；测试中的投影 double 只证明通用槽边界，不冒充真实外部连接。R5 现已在独立账本中实现，并通过精确来源接入原 R4 槽；此句不改写 R4 验收当时的阶段边界。

## R3 多会话当前专项

总体协调窗口已于 **2026-09-06 正式验收 R3 通过**。下述首次失败、修复、隔离边界和最终测试数量继续作为原始证据保留；`PLANNING_CONFLICT = NONE`，`EVIDENCE_CONFLICT = RESOLVED`，R4 未开始。

R3 后端四文件专项当前合计 **21/21**，0 失败、0 跳过：

- `standalone-chat-r3-flow.test.js`：验证 R2 服务端身份/当前助手、每助手多个会话、选择、搜索/筛选/排序/游标、生命周期、消息版本/分支/隐藏、附件、导出和完整公开投影。
- `standalone-chat-r3-recovery.test.js`：验证写操作幂等、响应丢失查询、同库重启、锁定结果发布、明确重新生成、Provider `outcome_unknown` fail closed，以及旧键/新键和迟到响应边界。
- `standalone-chat-r3-migration.test.js`：验证 `026` fresh、`001–025` upgrade、故障整体回滚、外键、R1 默认会话原位投影及不可变/唯一约束。
- `standalone-chat-r3-security.test.js`：验证跨 owner/assistant/conversation/branch 隔离、严格请求、附件 MIME/大小/hash/路径/链接保护、受管副本清理和响应脱敏。

最终默认后端 `pnpm test`：**420 项，419 通过、0 失败、1 跳过，退出 0**。唯一跳过为既有 RFC 跨仓实现对照，使用正式隔离启动器指向明确不存在的路径；该项未执行、不计通过，也没有读取真实 Engine。前端交接结果为 R3 专项 **29/29**、全量 **253/253**、TypeScript 和生产构建通过；受控页面使用两个隔离 owner、每人两个助手、临时 SQLite、受管附件根和随机 loopback Provider 验证真实操作闭环，不是外部供应商验收。

施工中保留全部首次失败与修复：R3 专项曾依次为 9/13、10/13、11/13，随后迁移/恢复/安全合计 19/19；补充分页后 20/20；operation 资源类型与 R2 managed-copy 回归修复后恢复通过；加入账户删除覆盖后为 21/21。页面联调又发现版本列表未按冻结 DTO 返回精确 MessageVersion 元数据，后端修复并加回归后仍为 21/21。后续浏览器验收发现 429 后残留已消费确认，以及重新生成批准响应丢失时仍暴露旧确认；前端定点首次 19/20 保留，精确修正超时文案断言后达到 20/20、三文件 29/29。有效验证不使用真实 Engine、真实凭据、真实供应商或业务公网，不产生费用。

## R1 独立聊天当前专项

R1 后端三个专项当前合计 **61/61**，0 失败、0 跳过：

- `standalone-chat-r1-flow.test.js`：验证 R2 个人会话和当前助手是唯一身份来源、每助手唯一默认会话、双助手历史隔离、有界多轮输入、默认模型/Provider/凭据/Permission/Security/Token Budget 门控、真实随机 loopback `openai_compatible` 调用、Vio 锁定结果后发布最终 `subject` MessageVersion，以及查询和幂等重放零模型调用。
- `standalone-chat-r1-recovery.test.js`：验证一个 turn 只保留一个 logical execution，明确 retry 才增加 Provider attempt；多次 429、`not_sent`、`outcome_unknown`、结果落盘后发布前崩溃、启动恢复、会话撤销/退出/删除等待、并发和恢复 Idempotency-Key 均保持 fail closed 与精确重放。
- `standalone-chat-r1-migration.test.js`：验证 `025` fresh、`001–024` upgrade、迁移故障整体回滚、外键、复合归属、不可变事实、单活动 turn、per-attempt usage、Provider attempt 状态约束和治理删除范围。

本轮还通过隔离启动器完成受影响 V1—V5 八文件组合 **128/128**、模型路由/权限/安全/预算 **11/11**，以及默认后端全量 **399 项：398 通过、0 失败、1 条既有 RFC 跨仓实现对照条件跳过**。该跳过未执行、不计通过；测试不访问真实 Engine 或公网，不使用真实凭据或收费 Provider。前端交接记录为专项 26/26、全量 224/224、类型检查/构建通过及受控页面闭环完成；总体协调窗口于 2026-09-05 正式验收 R1 通过。

## R2 当前专项与隔离边界

R2 已于 **2026-09-05 正式验收通过**；本节保留所有首次失败、中间数量和最终验证来源。`PLANNING_CONFLICT = NONE`，`EVIDENCE_CONFLICT = NONE`。R2 验收当时 R1 独立聊天与 R3 多会话尚未开始；当前 R1 与 R3 状态分别以上两节为准。

2026-09-05 当前 R2 后端专项为十文件 **53/53**，0 失败、0 跳过：

| 文件（位于本目录） | 实际数量 | 主要证据 |
| --- | --- | --- |
| `personal-identity-r2.test.js` | 3 | 初始化、会话、资料、多助手与恢复 |
| `personal-configuration-r2.test.js` | 5 | Provider/Model、加密凭据、安全确认、旧写入口及他人归属 |
| `personal-migration-and-cli-r2.test.js` | 3 | 023 fresh/upgrade/rollback、正式 CLI 邀请文件 |
| `personal-access-regressions-r2.test.js` | 2 | 错误解锁 403 不退出；真实 HTTP 取消旧键不执行、新键正常执行 |
| `provider-connection-check-r2.test.js` | 8 | 安全双栈选择、IPv6-only 明确限制、危险 DNS/重定向等拒绝 |
| `personal-owner-recovery-r2.test.js` | 7 | 删除等待阻止 V3/V4/V5 启动恢复、凭据和迟到写入 |
| `personal-deletion-migration-r2.test.js` | 2 | 024 fresh/001–023 upgrade/失败回滚、普通历史保护与外键 |
| `personal-deletion-r2.test.js` | 12 | 高风险申请/取消、7 天边界、撤销/执行竞争、他人隔离、同库恢复、限权校验及审计；终态收束两处故障原子性 |
| `personal-managed-copies-r2.test.js` | 8 | 只清已登记副本、hash/路径/链接保护、canary、恢复拦截 |
| `personal-deletion-retention-r2.test.js` | 3 | 实际删除后的 14/30 天、真实 SQLite 写占用、启动延后和重试 |

通过现有隔离入口 `node scripts/run-tests.js <上述十个 tests/文件名>` 执行；不改并发、跳过或断言。完整准确命令及首次失败、修复见[开发日志](../docs/开发日志.md)。删除政策已确认，本轮验证的是隔离测试数据；不执行真实用户删除。

本次最终默认后端 `pnpm test`：**330 项，329 通过、0 失败、1 跳过，退出 0**。唯一跳过为既有 RFC 跨仓实现对照，显式不存在路径，未执行、不计通过；其他真实 Engine shared 测试不运行。前轮成绩及本轮补修前 51/51、328 项保留在日志，不替代当前代码验证。前端最终专项 98/98、全量 198/198、类型检查和构建以[前端交接](../../docs/R2_FRONTEND_HANDOFF.md)本轮结果为来源；受控页面联调和清理证据见开发日志。没有真实供应商、真实密钥、Engine 或费用。

## R0 证据口径与历史文档收尾

R0-A/B/C 已分别验收并推送；2026-09-04 本轮只核对文档、引用和 [R0 要求与证据矩阵](../docs/SUBJECT_RUNTIME_PORT_V1.md#r0-evidence)，没有执行下列代码测试或服务。历史数量不得当作本轮新测通过数；R0 整体验收仍待总体协调窗口复核。

- R0-A 历史专项 37/37，R0-B 历史专项 9/9。
- R0-C 历史专项 37/37、前端全量 60/60；来源为 [工程日志](../../docs/工程日志.md)“2026-09-04｜R0-C 验收修正记录”，覆盖严格响应、None/第三方显示、StrictMode 单次 GET、重进、手动刷新、卸载取消、无轮询和失败不保留旧成功状态。
- 最近历史后端全量 266 项：265 通过、0 失败、1 条既有 RFC 跨仓对照因显式不存在的隔离路径未执行，不计入通过；首次误读真实 Engine 后失败及后续有限目录检查历史保留。本轮没有执行或新增任何跳过。
- 后续验收按 [ADR-034](../../docs/决策记录.md#adr-034) 与 [现行路线](../../docs/后端/13-部署运维测试与路线图.md#r0-r13-order)；R0 已验收，R2 已于 2026-09-05 正式验收通过，且不等于 R3 多会话或 R1 独立聊天。六导航及原模型/API/工具/MCP/设备、安全墙要求不减。

真实 Engine 共享测试命令仅保留为特定适配器历史验收入口，不是 Vio 完成或发布的必跑项。本轮不运行它们，也不探测真实 Engine。首次彻底解耦后，无用户另行重连授权就不探测、读取、启动或修改真实引擎；通用端口仍须在 Vio 自有环境完整验证。下方关于历史副本/Engine 路径的说明不构成当前执行授权，也不表示现有源码的相邻目录探测逻辑已在 R0 被修改。

## 已有测试范围及历史入口

后端测试将至少覆盖：

- 用户与主体隔离
- User Space、当前助手持久化和五类数据复合归属过滤
- 会话、消息、当前版本与线性版本历史；分支、删除和重置留待后续阶段
- 软件事件结构与敏感字段脱敏
- 权限五档、会话失效、撤销和高风险确认
- 摘要来源、跨窗口读取、SubjectState 版本和 Context 装配边界
- AI Assistant Global Settings 的默认值、读取、更新、Context 投影及与 SubjectState 的边界
- Tool/MCP/Skill/Plugin 注册、Capability 权限投影和 Tool 未执行使用记录
- Device Registry、Capability、Adapter 契约、授权、安全确认、事件和未执行操作日志
- Security Policy、用户安全偏好、生命周期事件、短时会话授权和迁移外键完整性
- AI Private Space 五类内容、不可变版本、复合隔离、安全门、Context 投影和导出结构预留
- 生活管理管账/预算/月历/身体/本地记忆、安全链、事件脱敏与隔离
- Wake、主动提示、Token 日/会话预算、后台策略和零执行边界
- continuity-engine、模型和外部能力边界
- Subject Runtime Port v1 严格合同、连接状态机、None Adapter 及适配器专用合同登记
- Subject Runtime Port v1 默认装配、通用只读状态 API、健康摘要及第三方 Adapter 状态投影
- Export Schema、十二类数据范围、完整性预检、安全确认、导出记录和未执行迁移契约
- 错误结果不泄露密钥或其他用户数据

当前使用 Node.js 内置测试运行器，不连接公网或真实供应商。Provider adapter 测试会在随机 loopback 端口启动受控 HTTP 服务；测试数据库位于操作系统临时目录，每个测试使用独立 SQLite 文件并在结束后清理。

运行：

```bash
pnpm test
```

R0-A `subject-runtime-port-r0a.test.js` 当前为 37/37，以纯本地方式验证 Vio Core/可选主体运行时责任、`none`/`external`、七态连接状态机、版本协商、严格观察/表达/投影/取消/恢复结构、状态与错误族绑定、None Adapter 以及 Continuity Engine/第三方适配器登记。投影 payload 回归覆盖纯 JSON 递归校验和 32768 UTF-8 字节边界；时间回归覆盖真实 UTC 公历、合法任意位小数秒、等价小数表示，以及 `deadlineAt = createdAt + timeoutMs` 的完整精度精确比较。该专项不启动或读取 Engine，不使用网络、模型、Provider、密钥或数据库；运行命令为 `node --test tests/subject-runtime-port-r0a.test.js`。

R0-B `subject-runtime-status-r0b.test.js` 当前为 9/9，验证应用默认 None Adapter、平台可用/运行时未配置区分、完整公共响应、`/health.subjectRuntime`、第三方 Adapter 与七种合法状态、非法 Manifest/状态/版本/未知字段 fail closed、响应脱敏，以及查询不调用运行时操作。测试仅使用临时 SQLite 和本机随机端口，不读取 Engine、不访问公网、不调用模型或 Provider；运行命令为 `node --test tests/subject-runtime-status-r0b.test.js`。

L1 初次实现时 `live-chat-preparation-l1.test.js` 为 18/18，覆盖只读 plan、双确认 apply、精确幂等、配置冲突、Binding 导出、doctor 四态、脱敏与零执行事实；当时后端全量为 196/196。后续修复及以下数量是分阶段历史，不是当前全量或本轮测试结果。

S4-Live `live-chat-sandbox.test.js` 历史验收为 18/18：除严格 manifest、测试专用固定身份、仓库外同根路径、symlink/junction/reparse 拒绝、doctor 沙箱门禁、只读 cleanup plan、双确认整根删除、占用失败以及 sibling/protected canary 外，还覆盖事故 110/264/273 字符计算、WakeSession 最终路径超限、原子临时路径单独超限、创建零残留、已有超限 manifest/doctor fail closed，以及 cleanup-only 兼容 plan/apply、未知/重复字段、Manifest/Binding/hash/canonical path 篡改、reparse、非预算错误和占用拒绝。当时 L1 为 24/24，后端全量为 220/220；这些自动测试不使用真实 API Key、不访问公网、不调用真实 Provider/模型且不产生费用。

自动化测试与真实供应商验收必须分开表述。2026-08-14 的首次 S4-Live 真实验收另以 `C:\VioS4\first-001` 可销毁短路径沙箱和 `disposable_test / promotionAllowed=false` 身份完成，结论为 PASS：真实 Provider execution 恰好一次，Engine 保持 `changed=false / revision=0`，最终主体 Message 来自 Engine `FirstRoundSuccessResult`，验收后官方 cleanup 已整根删除沙箱。该人工验收没有并入默认测试，也不把供应商费用概览的 ¥0 当作永久最终账单；Vio 账本状态保持 `not_reported`。

独立 S4 双仓共享测试通过 7/7。该验收历史上基于 Engine E5-A `cba52126db2fb5eca57d9b5c0c80884693c59a6f` 完成；当前 `continuity-capability-local-http-shared.test.js` 固定要求其已接受的 S4-R 文档后继基线 `7a1dacae9401e1742aaf6ddbaa26f1b456880383`（相关生产与机器契约实现未改变）。测试显式读取 `CONTINUITY_ENGINE_REPO`，启动 capability 模式与随机 loopback Provider，通过 Vio V1 → V3 → V4 → Engine → V2 真实 HTTP 路径验证成功闭环、精确重放、双方重启、429 显式批准重试、400 终止、UNKNOWN fail closed 及身份/冲突隔离。运行命令为 `pnpm run test:continuity-capability-shared`；该命令不属于默认 `pnpm test`，不会访问公网或真实供应商。

第一轮 test-only 与正式本机 HTTP 双方共享验收使用独立命令，不并入不具备 Engine 仓库的普通后端测试：

```bash
CONTINUITY_ENGINE_REPO=/path/to/continuity-engine pnpm test:continuity-shared
CONTINUITY_ENGINE_REPO=/path/to/continuity-engine node --test shared-tests/continuity-integration-local-http-shared.test.js
CONTINUITY_ENGINE_REPO=/path/to/continuity-engine pnpm run test:continuity-capability-shared
CONTINUITY_ENGINE_REPO=/path/to/continuity-engine pnpm run test:continuity-conversation-shared
```

V5 公共轮次专项共 19 项，覆盖 `022` fresh/`001–021` upgrade/失败回滚、固定 Profile 幂等准备、公共创建/查询/恢复、Engine 禁用前置失败、幂等/范围冲突、单主体活动轮次、确认/预算/deny/retry/UNKNOWN、query-first，以及 V1 前后、V2 完成后和主体 Message 发布窗口的 SQLite 重启恢复。新增 HTTP 回归真实调用旧 PATCH 与 regeneration，使 Message 的 `currentVersionId` 发生变化，并验证 GET、幂等重放、终态 resumption 与重启仍精确返回账本锁定的原始 user/subject MessageVersion，且不重复 Provider、V1、V2 或主体 Message；另以临时损坏数据确认锁定版本身份不一致时 fail closed。正式 V5 shared test 共 6/6，以真实 Engine E5-A、Vio 公共 HTTP、V1–V5、随机 loopback Provider 和临时双数据库验证上述版本锁定、确认恢复、Engine 最终回复、精确重放、双方重启及无直连边界；不访问公网、不使用真实密钥或产生费用。

test-only 共享专项 6/6 通过，固定核对 Engine `7a32a99` 与 Vio `97874ee` 基线、三份 Schema 解析结构、真实 V1 SQLite 请求、A/B/C revision 0→1→1、四类真实错误、同进程/双方重启幂等、UTF-8 JSONL、异常/超时/非法输出失败和应用/HTTP/前端零注册。该测试仍使用 Engine 内确定性 test double 和临时双数据库，不是正式网络入口。

历史 S2/S3 验收入口 `continuity-integration-local-http-shared.test.js` 为 15/15，固定要求 Engine E4 `189441f9bad2a34119b4ef10365a4385ed0949cc`、真实 E4 HTTP Server、Vio V3 transport、V1 原请求和 V2 结果/投影账本。覆盖 changed=false 0→0、changed=true 0→1、后续 1→1、四类机器错误、completed/not_found/recovery_required 查询、POST 响应丢失、Engine 中途退出、Engine 查询不可达、Vio 中途退出、双方同时重启、requestHash/operationId 冲突隔离及 `IDEMPOTENCY_KEY_REUSED / never`。Wake、Thinking、Event、StateUpdateRecord、revision、result、projection 与 receipt 均保持幂等。测试只使用 loopback、确定性 provider 和临时双数据库；环境变量缺失会明确失败，不会 skip，不接真实模型、公共 API 或前端。当前正式 Engine 仓库保持 E5-A，不得为重跑历史 S2/S3 checkout 或修改到 E4；需要回归时应使用指向 E4 固定提交的隔离临时本地副本，并把该副本路径显式传给 `CONTINUITY_ENGINE_REPO`。

Continuity Vio V1 测试另外覆盖三份严格本地 Schema/引用、所有对象的未知字段拒绝、禁止状态写字段、正文唯一位置、跨结构 ID/identity 一致性、RFC 8785 与三项固定 hash、固定 Binding 全字段防漂移、Vio 归属与 Event 来源核对、requestId 重试、跨重启恢复，以及零 Engine/模型/MCP/Tool/设备/网络调用和零 SubjectState 推进。

Continuity Vio V2 专项共 29 项，覆盖精确 success 与四类 error envelope、未知/旧字段拒绝、首次请求复用、未配置 transport、revision 0 head 原子初始化/重放/故障恢复、已有 head 的 changed=false 不变语义、changed/revision/engineUpdateId 组合、state/projection hash、结果重放、四类错误跨重启恢复、同 revision 内容唯一性、operation/response/update ID 冲突、reconciling/quarantine、真实 SQLite 重启恢复、事务回滚，以及迁移 `019` 的全新安装和 `018 → 019` 升级。V2 只使用显式 test-only fixture，不调用 Engine、网络、模型或外部能力，也不创建 Engine Event/StateMutation 或 legacy state_update。

Continuity Vio V3 专项共 18 项，使用本机临时 HTTP 服务验证 Engine E4 精确 POST/GET/health 路径、Bearer header、原始 canonical UTF-8 body、success/四类机器错误透传、连接拒绝、响应超时、401/5xx、非法 JSON/UTF-8/Content-Type、响应体上限、completed/recovery_required/not_found 查询、requestHash/operationId 隔离、outcome_unknown 查询优先恢复、本地 V2 checkpoint 重启恢复、Engine 不可达时 Vio 降级启动，以及 `001→020`、`018→020`、`019→020` 迁移和约束。该专项本身不运行真实 Engine、模型、MCP、Tool 或设备；真实 Engine E4 联验由上述 S2/S3 独立 shared test 覆盖。

Continuity Vio V4 三个专项共 46 项，覆盖 Engine E5-A 三份严格 Capability Schema、身份/hash/deadline 联合校验、`021` fresh/upgrade/失败回滚、独立不可变多 attempt 账本、V1 归属反查、Permission/Security/Confirmation/Token Budget、secretRef 轮换与脱敏、Model Router、`openai_compatible` adapter 的真实 loopback HTTP、可信 usage、失败/超时/断线映射、无包装层 Result 回传、query-first、精确重放、崩溃恢复和冲突隔离。CapabilityRequest、CapabilityResult、`capability_required` 与 `capability_failed` 使用 `continuity-capability/v1`，completed 继续使用 `continuity-integration/v1.1`，并由不依赖 Vio 常量的 Engine 字面量测试锁定。一个或多个 `FAILED_RETRYABLE` 只有在内部明确批准并重新通过现实门控后才会产生新 execution/result；Engine 已接受的 `UNKNOWN` 保持 fail closed，重启也不重复 Provider 调用。指定 V1–V4 组合共 101/101 通过。该自动化测试使用注入 credential store，不修改真实环境，不访问公网、不使用真实密钥、不产生真实费用；后续首次 S4-Live 真实供应商验收是独立人工验收，不改变这些测试语义。

Data Export 测试覆盖迁移 `017` 对既有 Permission、Security Policy、Confirmation 与 AuditLog 的保留和外键完整性，三类 Export Schema、十二类范围、归属/字段/关系预检、缺失字段阻止、`data_export` Permission、高风险逐次确认、导出记录持久化和跨用户/主体隔离。机器人/其他载体契约固定未实现、未连接、未执行，接口拒绝服务地址等连接载荷，所有结果均不包含业务数据、不创建文件、不连接外部存储。

Account/Data Isolation 测试覆盖迁移 `015` 对既有用户的空间与当前助手回填、外键完整性、User/Space 原子创建、首个助手选择、助手列表、切换与重启持久化。测试同时验证多助手 Global Settings 与 SubjectState 保持独立，用户/AI/设备/生活/Event 资源只通过固定复合范围命中，错配组合按未找到处理；AI 私域、设备和生活资源在所有权命中后仍经过 Permission 与 Security Policy，全部结果保持 `not_executed`。

Life Management 测试覆盖收入/支出、整数金额精度、预算提醒、分类统计、UTC 月度汇总、四类月历与提醒、身体指标/目标/趋势、显式建议字段、本地记忆上下文/导出标记和 Context 投影。迁移测试从 `013` 结构保留 Permission、Security Policy、Confirmation、AuditLog 和 SessionGrant 关系升级到 `014`。同时验证 `life_data` 安全链、策略拒绝、重启持久化、跨用户/主体隔离、三类 Event 脱敏和外键完整性；不连接支付、银行、穿戴设备、模型或外部服务。

Proactive Interaction 测试覆盖 `015` 权限/策略迁移保留、`proactive_interaction` 安全范围、四类 Wake、应用内授权、后台允许范围、Event 驱动提示、四级优先级、高风险确认与静默抑制。Token 测试覆盖日/会话累计、三种超额策略、显式使用账本和跨用户/主体隔离。所有断言要求麦克风、系统唤醒、消息投递、模型、计费和外部调用保持未执行。

AI Private Space 测试覆盖五类内容、首版与更新版本、`baseVersionId`、数据库不可变触发器、Space 状态、高风险确认、Permission/Policy 拒绝、独立 Context 投影、无正文 Export Manifest、三类私域 Event 脱敏、重启持久化、复合归属隔离和外键完整性。测试输入均为显式样例，不运行模型、continuity-engine、机器人或外部设备。

Conversation / Message / MessageVersion 测试覆盖会话与消息创建和查询、会话内 `sequenceNumber`、`currentVersionId` 指针、原始/编辑/重生成版本历史、不可变版本、`baseVersionId` 防陈旧写、发送者限制、复合归属隔离、自动 Event 不含标题或内容，以及 Event 失败时消息/版本/指针/会话活动时间的事务回滚。主体消息和重生成测试内容由调用方显式提交，不调用 AI。所有测试只访问本地测试服务与临时 SQLite，不调用真实模型、支付、设备或外部 API。

Context / Summary / SubjectState 测试覆盖摘要保存、MessageVersion/Event 来源、跨窗口最新摘要、`state_update` 三类来源、当前状态指针、未解决 Event、Context 固定顺序、Memory 未实现标记、零模型/外部调用标记、重启持久化、跨用户/主体/Conversation 隔离、不可变触发器以及摘要/状态复合写入回滚。

Assistant Global Settings 测试覆盖创建主体时的默认设定、七类字段局部更新、跨窗口 Context 读取、重启持久化、未知/非法字段拒绝、去重列表、跨用户隔离、无变化不写入，以及 Subject 身份、扩展设定和 Event 的事务回滚；同时验证设定更新不会创建或改变 SubjectState。

Model Routing 测试覆盖 Provider 的 Base URL、接口格式、启停与测试状态，Model 的八类能力标签、费用说明与测试状态，六类任务查询，默认/备用规则创建、读取、更新与重启持久化。公共 Router 选择接口仍只返回目录结果并标记模型和外部 API 未调用。Provider 创建继续拒绝 API Key、Token、Secret、凭据引用和含凭据 Base URL；V4 另以高风险确认保护的专用入口只接受 `env:VIO_MODEL_API_KEY_*` 引用，测试核对轮换和脱敏且不写入密钥原值。

Capability 测试覆盖 Tool/MCP/Skill/Plugin 创建、默认停用、启停、查询、持久化、用户内名称唯一和跨用户隔离；统一能力视图覆盖分类、Permission 允许/询问/拒绝、Plugin 纯元数据状态和 Tool 最近使用。Tool 执行准备覆盖低风险直接准备、中风险确认、确认消费、停用阻止和缺少权限拒绝；全部记录固定 `not_executed`、零外部调用和零 Token。执行载荷、含凭据 MCP 地址与跨主体读取均被拒绝，不连接任何外部服务。

Device 测试覆盖七类设备、四类能力、品牌到未配置 Adapter 的映射、默认停用、查询筛选、启停、持久化和跨用户隔离。授权写入复用 Permission 并产生 `permission_created` 与 `device_changed`；操作准备必须经过 Permission、Security Policy、Security 和 Confirmation，设备控制风险固定为 `critical`，全部结果固定 `not_executed`、`not_connected` 和零厂商调用。测试还覆盖禁用设备、未声明能力、真实控制参数、跨主体访问、日志/审计/Event 关联和事务回滚。

Security Policy 测试覆盖五种规则、默认/高风险偏好、自动确认与禁止范围、CRUD、软删除、持久化和用户隔离；验证策略只能收紧 Permission，高/极高风险不能被自动或会话放行。会话授权测试覆盖确认后创建、精确作用域、30 分钟失效、策略版本失配及跨会话隔离。迁移测试从 `011` 结构保留带 Event/AuditLog 外键的设备日志升级到 `012`，并验证 `PRAGMA foreign_key_check` 为空。
