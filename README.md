# Vio Live

Vio Live 当前包含 React + Vite + TypeScript 前端，以及位于 `backend/` 的独立 Node.js 平台后端。F1 已将现有对话页接入固定本地 Profile 的 Vio V5 公共 Conversation Turn API；其他前端页面仍保留原有 mock 数据。平台后端已完成账号/主体、全局设定/AI 私域、对话/摘要/状态/Context、事件、模型路由、权限安全、扩展与设备注册，以及管账、预算、月历、身体管理和本地记忆基础。

后端现可按用户保存 Security Policy 与安全偏好，并按 Permission → Policy → Confirmation 保护私域及生活数据。生活模块使用独立 User Space 表和 `life_data` 权限，提供本地确定性统计与受控记忆投影；不会支付、同步银行/健康设备或调用 AI。设备适配器仍只有未配置描述，扩展和设备均不执行真实操作。前端继续通过 Vite 同源代理访问 Vio 后端；除对话页的 V5 固定本地试聊接线外，其他页面尚未迁移到真实 API。

[`Continuity Integration Contract v1.1`](docs/后端/14-continuity-engine连接契约v1.1.md) 已由 Continuity Engine 正式接受，第一轮 test-only、S2/S3 正式本机 HTTP/JSON、S4 Capability 双仓共享验收和 S4-Live 首次真实供应商试聊均已通过。Vio V5 在固定本地试聊 Profile 下提供持久化公共 Conversation Turn API，把现有 Conversation/Message 串入 V1 → V3 → Engine E5-A → V4 → V2，并且只把 Engine 最终 `FirstRoundSuccessResult.response.content` 保存为主体 Message。F1 对话页只消费该公共 API：真实历史来自 Message 列表，发送、查询和显式恢复遵循 V5 状态机，超时或断线使用 `sessionStorage` 保留同一幂等事实。首次真实验收使用可销毁测试身份、独立短路径沙箱和 Alibaba Cloud Model Studio 的 OpenAI-compatible Provider，结论为 PASS。**这仍不表示产品已经生产可用**：通用正式身份/Binding、生产认证、多租户、加密密钥存储、备份和部署均未完成。Continuity Engine 继续是 AI SubjectState 与最终主体表达的权威源，前端也仍只能连接 Vio 后端。

S4-Live 首次真实试聊必须先创建可销毁验收沙箱：固定 v1.1 身份只登记为 `purpose=s4-live-acceptance`、`identityClass=disposable_test`、`promotionAllowed=false`，不得转为正式主体。Binding、Vio SQLite 和 Engine 数据必须位于同一个仓库外沙箱根；Windows 创建与 doctor 还会按 Engine WakeSession 原子写入的最坏路径执行 240 字符安全预算，超限以 `engine_persistence_path_budget_exceeded` 拒绝。应使用全新、仓库外的短绝对路径，例如 `C:\VioS4\first-001`；不得移动或缩写已有沙箱来绕过门禁。门禁上线前创建且唯一问题为超预算的旧沙箱仍可由官方 cleanup 在完整 Manifest/Binding/路径/保护校验和双确认后整根删除；doctor 继续判为 unsafe。清理禁止手工删数据库行、Engine JSON 或修改 revision。命令与完整顺序见 [`backend/scripts/README.md`](backend/scripts/README.md)。

2026-08-14 的首次 S4-Live 正式验收在 `C:\VioS4\first-001` 完成：模型 `qwen-flash-2025-07-28` 只执行一次，Provider 报告 177 input、9 output、186 total Token，轮次最终返回“Vio首次真实试聊连接成功。”CapabilityResult 首次回传成功，Engine 保持 `changed=false / revision=0`，没有内部 Event、StateMutation 或越权状态写入。验收后服务全部停止，官方 cleanup 已整根删除沙箱；Vio 账本费用状态仍为 `not_reported`，验收时供应商概览显示 ¥0，但账单可能延迟，不能据此声明永久最终费用为零。

L1 现提供三个安全准备入口：从正式 fixture/hash 导出仓库外 Binding、以只读 plan 或双确认 apply 幂等准备唯一 `openai_compatible` Provider/Model/路由/权限/有限预算/credential reference，以及在调用前只读运行 readiness doctor。L1 不调用真实供应商；API Key 只从当前进程环境读取，不进入 `.env`、SQLite、日志、输出、文档或 Git。完整 PowerShell 三端步骤见 [`backend/scripts/README.md`](backend/scripts/README.md)。

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
3. Windows 防火墙仅允许该前端进程通过“专用网络”，不要允许公用网络。
4. 禁止使用公网隧道或路由器端口映射暴露此入口。电脑与前端进程必须保持运行，手机才能继续访问。
5. 使用完成后在前端终端按 `Ctrl+C` 停止入口。

此命令只让 Vite 前端监听局域网；Vio 后端与 Continuity Engine 仍只监听电脑本机，不会开放局域网监听。登录页的 Google 与邮箱验证码操作仍是纯演示行为，当前登录不是正式账号认证。

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

后端接口与运行说明见 [`backend/README.md`](backend/README.md)，基础 API 契约见 [`backend/docs/API.md`](backend/docs/API.md)，当前引擎连接契约见 [`docs/后端/14-continuity-engine连接契约v1.1.md`](docs/后端/14-continuity-engine连接契约v1.1.md)，对齐记录与最终接受证据见 [`14a`](docs/后端/14a-Engine-Contract-Response对齐差异说明.md) 和 [`14c`](docs/后端/14c-Engine-Contract-Final-Read-Only-Short-Confirmation-v1.md)。

## 当前边界

- 对话页已停止使用 `conversationMock.messages`，只读取固定本地 Profile 的 V5 Message/Turn 公共投影；其余页面和未接线模块仍使用原有 `src/data/*Mock.ts` 原型数据。
- 没有真实 Google/邮箱验证码登录或会话；`x-vio-user-id` 只用于开发期当前用户上下文。
- 通用 Message 创建与重生成正文仍由开发调用方显式提交；唯一例外是 V5 固定本地 Turn API，它只把 V2 已保存的 Engine 最终 response 创建为主体 Message。
- 摘要和 legacy/unverified `state_update` 仍由开发调用方显式提交；Context 只读投影不生成提示词或消耗 Token。正式本机连接不使用该旧写入口，Vio V2 通过独立投影账本保存 Engine 结果；现有 `state_update` 仍须收口或停用，Context 仍只作为平台事实来源。
- Vio V1 已实现第一轮 `ContinuityInteractionRequest`、`message_created` PlatformObservation 和 `message_version` fact 的严格本地 Schema/validator、固定 SubjectBinding fixture/hash、逻辑请求构造及请求输入跨重启恢复；没有新增 HTTP 或生产连接入口。
- Vio V2 已实现与 Engine 机器结果契约精确一致的 success/error envelope 白名单校验、operation/response/stateProjection 幂等结果账本、独立投影版本与当前指针、revision 冲突隔离和崩溃恢复；首次合法 `changed=false / revision 0` 会初始化已确认投影 head，但不推进 revision，已有 head 时 `changed=false` 不改变指针；`changed=true` 只有通过 hash、唯一性与 CAS 校验后才推进一次。
- Vio V3 已实现正式本机 HTTP transport 和六态 delivery/outbox；POST 超时后保留原 requestId 并优先查询，只有 `recovery_required` 或 `not_found` 才重投同一份 V1 canonical request，结果仍交给 V2 严格校验与保存。集成默认关闭，只允许 `127.0.0.1`，token 不进入数据库、日志或响应；Engine 不可达时 Vio 仍启动并报告 `degraded`。
- Vio V4 已实现 E5-A 三份严格 Capability Schema、独立迁移 `021` 多 attempt 账本、`chat` 模型路由、Vio Permission → Security/Confirmation → Token Budget 门控、`env:VIO_MODEL_API_KEY_*` 密钥引用及 `openai_compatible` 非流式 HTTP adapter。`capability_required` / `capability_failed` 外层固定使用 `continuity-capability/v1`，`completed` 仍使用 `continuity-integration/v1.1`。模型候选只会先作为带来源的 CapabilityResult 回传 Engine，不能直接成为消息或修改状态。
- Vio V5 已实现固定本地 Profile 的公共轮次创建、纯查询和确认/重试恢复接口。用户 Message、V1 原请求、V3/V4/V2 状态和最终主体 Message 由 `022` 轮次账本关联；Turn 返回账本锁定的精确 MessageVersion，不跟随通用 Message 当前指针，因此后续编辑或 regeneration 不会改写历史用户输入与 Engine 最终回复。相同幂等键只精确重放第一次轮次，进程重启从持久化 checkpoint 恢复，模型原始候选绝不能直接写入 Message。
- HTTP 回传结果未知时先查询，必要时只重发已保存的同一 canonical Result；这与 Provider 真实重试不同。`FAILED_RETRYABLE` 被 Engine 明确接受后进入 `waiting_retry`，只有后端内部明确批准并重新执行路由、权限、安全、预算和 deadline 检查后，才以新的 execution/result ID 再调用一次 Provider；`UNKNOWN` 被接受后保持 fail closed，不再次调用 Provider。成功或终止状态禁止新增执行。
- test-only JSONL Runner 仍只由独立共享测试显式启动，不会被应用、HTTP、前端或正式 transport 装配。S2/S3 已使用 Engine E4 正式 HTTP Server、Vio V3 正式 transport、V1/V2/V3 账本和临时双数据库完成 15/15 共享验收；正式 transport 仍默认关闭且没有公共或前端直连入口。
- AI 助手全局设定只保存用户明确配置的长期身份与行为偏好，不能覆盖平台安全规则，也不会自动形成或修改 SubjectState。
- 用户安全策略只能在已有 Permission 上继续收紧；`session_allow` 使用的开发期安全会话 ID 不是认证凭证，且只在明确确认后的精确范围内短时有效。
- 没有通用 Memory，也没有在仓库、数据库或文档保存真实 API Key。V4 的 `openai_compatible` HTTP adapter 已通过一次可销毁 S4-Live 真实供应商试聊验收；这只是固定测试身份下的本机受控证据，不是生产 Provider、通用身份或公开部署验收。`anthropic_messages`、`glm_compatible` 和 `custom_http` 仍 fail closed。AI Private Space 只有显式输入的数据层、版本、权限安全联动、独立 Context 投影与导出清单预留，不包含意识、自主行为、开放判断或 continuity-engine 生成。MCP/Skill/Plugin/Tool 目前只有注册、权限投影和未执行准备记录；设备目前只有注册、能力描述、授权和未执行操作日志。没有真实 MCP 连接、插件安装、Tool/Skill 执行、设备连接或控制、厂商 API、支付或真实 AI 私域决策。
- 生活管理只保存显式输入并进行本地统计；提醒不执行，AI 建议不生成，本地记忆不自动进入通用 Context。没有支付、银行同步、健康设备数据、医疗诊断、真实导出或自动数据删除。
- 未认证后端不能直接公开部署。

F1 固定本地 Profile 对话页接线与首次 S4-Live 真实供应商试聊验收已完成；本机个人日常使用化、通用身份/Binding、生产认证、多租户、加密密钥存储、备份与部署仍须等待后续独立任务。
