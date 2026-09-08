# Vio Live

Vio Live 当前包含 React + Vite + TypeScript 前端，以及位于 `backend/` 的独立 Node.js 平台后端。**R2 与 R1 均已于 2026-09-05 正式验收通过，R3 已于 2026-09-06 正式验收通过，R4、R5 与 R6 已于 2026-09-08 正式验收通过**：R2 完成受控个人所有者初始化和访问/配置/删除边界；R1—R6 已完成独立聊天、多会话、可审计上下文装配、Vio 自有本地长期记忆，以及迁移 `029` 下按 owner/current-assistant 隔离的统一能力目录/执行/恢复、确定性本地 Tool、不可变 Skill/Plugin、MCP `2026-07-28` Streamable HTTP 和 R1 模型执行投影。邮箱、Google 与公开注册继续暂缓；历史 F1 固定 Profile 的 V5/Engine 代码和证据继续隔离保留，R6 不访问或依赖真实 Engine。

R0-A 已冻结 Vio 自己的 [`Subject Runtime Port v1`](backend/docs/SUBJECT_RUNTIME_PORT_V1.md)：Vio Core 永久负责账号、助手、会话/消息、模型/Provider、扩展能力、设备、本地记忆、Context、权限安全、工作流/生活数据及费用/导出/备份恢复；外部主体运行时只是可选增强。R0-B/C 已完成通用只读状态装配与“我的”页展示。R0 已于 2026-09-04 验收；它没有切换聊天编排。当前 R1 后端独立路径直接使用 Vio Core 的模型、凭据、权限、安全和预算边界，不探测或依赖外部运行时；Continuity Engine 在通用端口中仍只是 `registered_not_wired` 的可选适配器。

后端现可按用户保存 Security Policy 与安全偏好，并按 Permission → Policy → Confirmation 保护私域及生活数据。生活模块使用独立 User Space 表和 `life_data` 权限，提供本地确定性统计与受控记忆投影；不会支付、同步银行/健康设备或调用 AI。设备适配器仍只有未配置描述，扩展和设备均不执行真实操作。前端通过 Vite 同源代理访问 Vio 后端；R2 个人访问、首次设置、资料/助手与能力配置已接真实 API，R0-C 通用状态仍只读。其余原型模块按各阶段边界保留，不能因为六个导航存在就算全部真实接线。

[`Continuity Integration Contract v1.1`](docs/后端/14-continuity-engine连接契约v1.1.md) 已由 Continuity Engine 正式接受，第一轮 test-only、S2/S3 正式本机 HTTP/JSON、S4 Capability 双仓共享验收和 S4-Live 首次真实供应商试聊均已通过。Vio V5 在固定本地试聊 Profile 下提供持久化公共 Conversation Turn API，把现有 Conversation/Message 串入 V1 → V3 → Engine E5-A → V4 → V2，并且只把 Engine 最终 `FirstRoundSuccessResult.response.content` 保存为主体 Message。F1 对话页只消费该公共 API：真实历史来自 Message 列表，发送、查询和显式恢复遵循 V5 状态机，超时或断线使用 `sessionStorage` 保留同一幂等事实。首次真实验收使用可销毁测试身份、独立短路径沙箱和 Alibaba Cloud Model Studio 的 OpenAI-compatible Provider，结论为 PASS。**这仍不表示产品已经生产可用**：R2 已完成个人身份与加密 Provider 凭据，但通用外部运行时身份/Binding、生产级 KMS/无人值守密钥恢复、多租户、完整备份和部署均未完成。在现有 Continuity Engine Adapter 合同范围内，Continuity Engine 仍是该适配器的 AI SubjectState 与最终主体表达权威；该专用合同不再代表 Vio Core。前端也仍只能连接 Vio 后端。

S4-Live 首次真实试聊必须先创建可销毁验收沙箱：固定 v1.1 身份只登记为 `purpose=s4-live-acceptance`、`identityClass=disposable_test`、`promotionAllowed=false`，不得转为正式主体。Binding、Vio SQLite 和 Engine 数据必须位于同一个仓库外沙箱根；Windows 创建与 doctor 还会按 Engine WakeSession 原子写入的最坏路径执行 240 字符安全预算，超限以 `engine_persistence_path_budget_exceeded` 拒绝。应使用全新、仓库外的短绝对路径，例如 `C:\VioS4\first-001`；不得移动或缩写已有沙箱来绕过门禁。门禁上线前创建且唯一问题为超预算的旧沙箱仍可由官方 cleanup 在完整 Manifest/Binding/路径/保护校验和双确认后整根删除；doctor 继续判为 unsafe。清理禁止手工删数据库行、Engine JSON 或修改 revision。命令与完整顺序见 [`backend/scripts/README.md`](backend/scripts/README.md)。

2026-08-14 的首次 S4-Live 正式验收在 `C:\VioS4\first-001` 完成：模型 `qwen-flash-2025-07-28` 只执行一次，Provider 报告 177 input、9 output、186 total Token，轮次最终返回“Vio首次真实试聊连接成功。”CapabilityResult 首次回传成功，Engine 保持 `changed=false / revision=0`，没有内部 Event、StateMutation 或越权状态写入。验收后服务全部停止，官方 cleanup 已整根删除沙箱；Vio 账本费用状态仍为 `not_reported`，验收时供应商概览显示 ¥0，但账单可能延迟，不能据此声明永久最终费用为零。

L1 现提供三个安全准备入口：从正式 fixture/hash 导出仓库外 Binding、以只读 plan 或双确认 apply 幂等准备唯一 `openai_compatible` Provider/Model/路由/权限/有限预算/credential reference，以及在调用前只读运行 readiness doctor。L1 不调用真实供应商；API Key 只从当前进程环境读取，不进入 `.env`、SQLite、日志、输出、文档或 Git。完整 PowerShell 三端步骤见 [`backend/scripts/README.md`](backend/scripts/README.md)。

## R0 收尾与已确认施工顺序

2026-09-04 四项决定已采用：R0 整体验收后按 **R2 → R1 → R3 至 R13** 推进，保留原编号。R2 已于 2026-09-05 正式验收通过，完成个人所有者访问保护和同一用户多助手的创建、列表、设置、选择与普通切换，以及受控账户删除流程；删除政策已确认，不改写此前待决历史。R1 再完成真实身份下的独立聊天和业务解耦，R3 完成各助手的多个会话及隔离。

R8 完成公共机制及截至 R7 已完成模块的前端接线；R9—R11 各自在本阶段完成对应前端、后端和真实联调，R13 全量复验。保留工作台、对话、连续性、AI 私域、能力、我的六个导航；后续元素不能靠占位、禁用或登记计作 R8 已完成。助手市场和多助手协作不在本轮范围，原真实功能、安全墙及权限要求不变。

R0 冻结规则本身不代表独立聊天已实现；R1 随后已按该边界建立 Vio 自有执行链路、完成隔离回归并接入个人“对话”页，并于 2026-09-05 正式验收通过。未经用户另行要求重连，Vio 施工、测试和发布不探测、读取、启动或修改真实 Engine；通用端口必须验证，真实外部运行时接入另行处理，不作为 Vio 完成和发布前置条件。新增对接优先通过独立适配器或接口扩展，不擅改 Vio 核心。

R0-A/B/C 及整阶段已验收并推送。R2 正式验收范围与保留边界见 [R2 个人访问合同](backend/docs/R2_PERSONAL_CONTRACT.md) 和 [前端交接](docs/R2_FRONTEND_HANDOFF.md)；R1—R6 合同分别见 [独立聊天](backend/docs/R1_STANDALONE_CHAT_CONTRACT.md)、[多会话](backend/docs/R3_MULTI_CONVERSATION_CONTRACT.md)、[上下文装配](backend/docs/R4_CONTEXT_ASSEMBLY_CONTRACT.md)、[本地长期记忆](backend/docs/R5_LOCAL_MEMORY_CONTRACT.md) 与 [统一能力执行](backend/docs/R6_UNIFIED_CAPABILITY_EXECUTION_CONTRACT.md)。完整顺序见 [ADR-034](docs/决策记录.md#adr-034) 和 [现行路线图](docs/后端/13-部署运维测试与路线图.md#r0-r13-order)。

## 前后端本地运行

后端：

```bash
cd backend
pnpm install
pnpm dev
```

前端使用另一个终端：

```bash
pnpm install
pnpm dev
```

前端通常运行在 `http://localhost:5173/`，并将 `/api` 与 `/health` 代理到默认的 `http://127.0.0.1:8787`。可使用无秘密的 `VITE_BACKEND_PROXY_TARGET` 调整开发代理目标。

### 安卓手机局域网验收入口

该入口只用于同一可信局域网内的前端开发验收，不是公网部署或正式认证入口。

1. 确保电脑与安卓手机连接同一个可信 Wi-Fi，电脑端运行：

   ```bash
   pnpm run dev:android
   ```

   如果普通终端找不到 `pnpm`，可运行：

   ```bat
   E:\npm.cmd run dev:android
   ```

2. 在安卓 Chrome 中打开终端显示的 `Network` 地址。登录页位于根路径 `/`。
   此历史 LAN 前端入口不等于已完成 R2 非本机安全访问：个人口令访问的非 loopback origin 必须使用 HTTPS。当前本轮只验收本机浏览器；手机真实个人访问需待用户明确 HTTPS/运行环境后另行验证，不向 HTTP LAN 页面输入真实口令或凭据。
3. Windows 防火墙仅允许该前端进程通过“专用网络”，不要允许公用网络。
4. 禁止使用公网隧道或路由器端口映射暴露此入口。电脑与前端进程必须保持运行，手机才能继续访问。
5. 使用完成后在前端终端按 `Ctrl+C` 停止入口。

此命令只让 Vite 前端监听局域网；Vio 后端与 Continuity Engine 仍只监听电脑本机，不会开放局域网监听。Google 与邮箱验证码入口仍暂缓；R2 个人口令会话是真实服务端访问保护，但尚未完成 HTTPS、服务器部署或公开认证，因此该 LAN 入口仍不是生产入口。

## 验证

前端生产构建：

```bash
pnpm build
```

前端自动化测试：

```bash
pnpm test
```

后端测试：

```bash
cd backend
pnpm test
```

后端接口与运行说明见 [`backend/README.md`](backend/README.md)，R1 个人独立聊天见 [`R1_STANDALONE_CHAT_CONTRACT.md`](backend/docs/R1_STANDALONE_CHAT_CONTRACT.md)，通用主体运行时端口见 [`Subject Runtime Port v1`](backend/docs/SUBJECT_RUNTIME_PORT_V1.md)，基础 API 契约见 [`backend/docs/API.md`](backend/docs/API.md)。Continuity Engine Adapter 专用连接契约见 [`docs/后端/14-continuity-engine连接契约v1.1.md`](docs/后端/14-continuity-engine连接契约v1.1.md)，对齐记录与最终接受证据见 [`14a`](docs/后端/14a-Engine-Contract-Response对齐差异说明.md) 和 [`14c`](docs/后端/14c-Engine-Contract-Final-Read-Only-Short-Confirmation-v1.md)。

## 当前边界

- 历史 F1 对话代码读取固定 Profile 的 V5 Message/Turn 公共投影；该代码与证据保留，但不得成为个人身份入口。六导航“对话”现已接入 R1 `/api/v1/personal/chat/*`，只接受 R2 服务端个人会话和当前助手，不认领固定 Profile 或旧无归属缓存。“我的”页的主体运行时卡片只读取 `GET /api/v1/subject-runtime/status`，R2 资料/助手/安全及模型配置读取个人 API；其他未接线模块仍明确使用 `src/data/*Mock.ts` 原型数据。
- Google/邮箱验证码和公开注册已暂缓；R2 个人所有者会话是当前正式业务身份来源，生产装配不接受 `x-vio-user-id` 作为授权依据。历史测试可在 test-support 中显式替代访问端口，但不存在环境后门。
- 通用 Message 创建与重生成的旧接口及历史事实保留；正式个人访问已拒绝可绕过 R1 合同的旧 conversation/message/continuity-turn 写入口。R1 独立路径只把经过严格验证并已锁定的 Provider 结果发布为唯一主体 Message；V5 固定本地 Turn API 仍只把 V2 已保存的 Engine 最终 response 创建为主体 Message，两者不能混用。
- 摘要和 legacy/unverified `state_update` 的历史数据与测试事实保留；正式个人访问已收口其普通写入口，测试兼容只可由显式 test-support 注入。Context 只读投影不生成提示词或消耗 Token，Vio 独立聊天只使用当前助手明确设定、当前默认会话的有界已锁定消息历史和本次用户消息。
- R1 迁移 `025` 为每个助手登记唯一默认会话，并保存 turn、单一逻辑 execution、逐次 Provider attempt、usage/cost、锁定结果和 recovery action。用户级 Idempotency-Key 防止切换助手后复用同键产生第二次事实；读取、刷新、启动及查询均不调用模型。请求可能已发出时进入 `outcome_unknown` 并禁止盲重试；确定未发出或明确 retryable 时才允许同一逻辑执行下的显式新 attempt；结果已锁定而消息未发布时只恢复发布，不再次调用 Provider。
- Vio V1 已实现第一轮 `ContinuityInteractionRequest`、`message_created` PlatformObservation 和 `message_version` fact 的严格本地 Schema/validator、固定 SubjectBinding fixture/hash、逻辑请求构造及请求输入跨重启恢复；没有新增 HTTP 或生产连接入口。
- Vio V2 已实现与 Engine 机器结果契约精确一致的 success/error envelope 白名单校验、operation/response/stateProjection 幂等结果账本、独立投影版本与当前指针、revision 冲突隔离和崩溃恢复；首次合法 `changed=false / revision 0` 会初始化已确认投影 head，但不推进 revision，已有 head 时 `changed=false` 不改变指针；`changed=true` 只有通过 hash、唯一性与 CAS 校验后才推进一次。
- Vio V3 已实现正式本机 HTTP transport 和六态 delivery/outbox；POST 超时后保留原 requestId 并优先查询，只有 `recovery_required` 或 `not_found` 才重投同一份 V1 canonical request，结果仍交给 V2 严格校验与保存。集成默认关闭，只允许 `127.0.0.1`，token 不进入数据库、日志或响应；Engine 不可达时 Vio 仍启动并报告 `degraded`。
- Vio V4 已实现 E5-A 三份严格 Capability Schema、独立迁移 `021` 多 attempt 账本、`chat` 模型路由、Vio Permission → Security/Confirmation → Token Budget 门控、`env:VIO_MODEL_API_KEY_*` 密钥引用及 `openai_compatible` 非流式 HTTP adapter。`capability_required` / `capability_failed` 外层固定使用 `continuity-capability/v1`，`completed` 仍使用 `continuity-integration/v1.1`。模型候选只会先作为带来源的 CapabilityResult 回传 Engine，不能直接成为消息或修改状态。
- Vio V5 已实现固定本地 Profile 的公共轮次创建、纯查询和确认/重试恢复接口。用户 Message、V1 原请求、V3/V4/V2 状态和最终主体 Message 由 `022` 轮次账本关联；Turn 返回账本锁定的精确 MessageVersion，不跟随通用 Message 当前指针，因此后续编辑或 regeneration 不会改写历史用户输入与 Engine 最终回复。相同幂等键只精确重放第一次轮次，进程重启从持久化 checkpoint 恢复，模型原始候选绝不能直接写入 Message。
- HTTP 回传结果未知时先查询，必要时只重发已保存的同一 canonical Result；这与 Provider 真实重试不同。`FAILED_RETRYABLE` 被 Engine 明确接受后进入 `waiting_retry`，只有后端内部明确批准并重新执行路由、权限、安全、预算和 deadline 检查后，才以新的 execution/result ID 再调用一次 Provider；`UNKNOWN` 被接受后保持 fail closed，不再次调用 Provider。成功或终止状态禁止新增执行。
- test-only JSONL Runner 仍只由独立共享测试显式启动，不会被应用、HTTP、前端或正式 transport 装配。S2/S3 已使用 Engine E4 正式 HTTP Server、Vio V3 正式 transport、V1/V2/V3 账本和临时双数据库完成 15/15 共享验收；正式 transport 仍默认关闭且没有公共或前端直连入口。
- AI 助手全局设定只保存用户明确配置的长期身份与行为偏好，不能覆盖平台安全规则，也不会自动形成或修改 SubjectState。
- 用户安全策略只能在已有 Permission 上继续收紧；`session_allow` 使用的开发期安全会话 ID 不是认证凭证，且只在明确确认后的精确范围内短时有效。
- R5 已实现 Vio 自有本地长期记忆，但没有云同步或 R11 完整备份，也没有在仓库、数据库或文档保存真实 API Key。V4 的 `openai_compatible` HTTP adapter 已通过一次可销毁 S4-Live 真实供应商试聊验收；这只是固定测试身份下的本机受控证据，不是生产 Provider、通用身份或公开部署验收。`anthropic_messages`、`glm_compatible` 和 `custom_http` 仍 fail closed。AI Private Space 只有显式输入的数据层、版本、权限安全联动、独立 Context 投影与导出清单预留，不包含意识、自主行为、开放判断或 continuity-engine 生成。旧 MCP/Skill/Plugin/Tool Registry 仍只登记元数据和未执行准备；R6 另以个人统一能力账本实现受限 MCP、本地确定性 Tool 和不可变 Skill/Plugin 编排。它不安装或执行插件代码，不开放任意 Tool，不把随机 loopback MCP 写成真实第三方验收。设备仍只有注册、能力描述、授权和未执行操作日志；没有真实设备连接或控制、厂商 API、支付或真实 AI 私域决策。
- 生活管理只保存显式输入并进行本地统计；提醒不执行，AI 建议不生成，本地记忆不自动进入通用 Context。没有支付、银行同步、健康设备数据、医疗诊断、真实导出或自动数据删除。
- 未认证后端不能直接公开部署。

F1 固定本地 Profile 对话页接线与首次 S4-Live 真实供应商试聊验收已完成；这不等于完整产品可用。R0 已验收，R2 个人访问、多助手、加密凭据及已批准 7/14/30 天政策的受控删除、R1 独立聊天与恢复合同、个人对话页接线、隔离自动化和受控页面闭环均已于 2026-09-05 正式验收通过；R3 多会话实现、隔离回归和受控页面闭环已于 2026-09-06 正式验收通过。手机实机、HTTPS、云部署、跨设备云端同步、R1/R3 真实供应商验证、通用外部身份/Binding、生产认证、多租户、备份和无人值守密钥恢复尚未完成，不自动进入后续阶段。
