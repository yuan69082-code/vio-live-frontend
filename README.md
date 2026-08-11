# Vio Live

Vio Live 当前包含 React + Vite + TypeScript 前端，以及位于 `backend/` 的独立 Node.js 平台后端。前端页面仍保留并使用原有 mock 数据；平台后端已完成账号/主体、全局设定/AI 私域、对话/摘要/状态/Context、事件、模型路由、权限安全、扩展与设备注册，以及管账、预算、月历、身体管理和本地记忆基础。

后端现可按用户保存 Security Policy 与安全偏好，并按 Permission → Policy → Confirmation 保护私域及生活数据。生活模块使用独立 User Space 表和 `life_data` 权限，提供本地确定性统计与受控记忆投影；不会支付、同步银行/健康设备或调用 AI。设备适配器仍只有未配置描述，扩展和设备均不执行真实操作。前端入口仍只通过 Vite 同源代理非阻塞检查 `/health`，页面尚未迁移到这些真实 API。

[`Continuity Integration Contract v1.1`](docs/后端/14-continuity-engine连接契约v1.1.md) 已由 Continuity Engine 正式接受，第一轮 test-only、S2/S3 正式本机 HTTP/JSON 以及 S4 Capability 双仓共享验收均已通过。Vio V4 已按 Continuity Engine E5-A 基线 `cba52126db2fb5eca57d9b5c0c80884693c59a6f` 经真实双进程 loopback HTTP 验证持久化 CapabilityRequest、权限/安全/预算门控、`openai_compatible` Provider HTTP 执行、环境变量 secretRef、可信 Token/费用事实、严格 CapabilityResult 回传、精确重放和双方重启恢复。自动化验收只连接随机 loopback 受控 Provider，没有调用真实供应商、使用真实密钥或产生费用。**这仍不表示产品已经可用**：真实供应商 live smoke、Vio 公共对话 API 串接、前端真实回复、生产认证、多租户和部署均未完成。Continuity Engine 继续是 AI SubjectState 唯一权威源，前端也仍只能连接 Vio 后端。

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

## 验证

前端生产构建：

```bash
pnpm build
```

后端测试：

```bash
cd backend
pnpm test
```

后端接口与运行说明见 [`backend/README.md`](backend/README.md)，基础 API 契约见 [`backend/docs/API.md`](backend/docs/API.md)，当前引擎连接契约见 [`docs/后端/14-continuity-engine连接契约v1.1.md`](docs/后端/14-continuity-engine连接契约v1.1.md)，对齐记录与最终接受证据见 [`14a`](docs/后端/14a-Engine-Contract-Response对齐差异说明.md) 和 [`14c`](docs/后端/14c-Engine-Contract-Final-Read-Only-Short-Confirmation-v1.md)。

## 当前边界

- 页面、组件和 `src/data/*Mock.ts` 仍是前端原型数据源。
- 没有真实 Google/邮箱验证码登录或会话；`x-vio-user-id` 只用于开发期当前用户上下文。
- 主体消息和重生成内容由开发调用方显式提交，只形成数据与事件记录，不代表 AI 已生成回复。
- 摘要和 legacy/unverified `state_update` 仍由开发调用方显式提交；Context 只读投影不生成提示词或消耗 Token。正式本机连接不使用该旧写入口，Vio V2 通过独立投影账本保存 Engine 结果；现有 `state_update` 仍须收口或停用，Context 仍只作为平台事实来源。
- Vio V1 已实现第一轮 `ContinuityInteractionRequest`、`message_created` PlatformObservation 和 `message_version` fact 的严格本地 Schema/validator、固定 SubjectBinding fixture/hash、逻辑请求构造及请求输入跨重启恢复；没有新增 HTTP 或生产连接入口。
- Vio V2 已实现与 Engine 机器结果契约精确一致的 success/error envelope 白名单校验、operation/response/stateProjection 幂等结果账本、独立投影版本与当前指针、revision 冲突隔离和崩溃恢复；首次合法 `changed=false / revision 0` 会初始化已确认投影 head，但不推进 revision，已有 head 时 `changed=false` 不改变指针；`changed=true` 只有通过 hash、唯一性与 CAS 校验后才推进一次。
- Vio V3 已实现正式本机 HTTP transport 和六态 delivery/outbox；POST 超时后保留原 requestId 并优先查询，只有 `recovery_required` 或 `not_found` 才重投同一份 V1 canonical request，结果仍交给 V2 严格校验与保存。集成默认关闭，只允许 `127.0.0.1`，token 不进入数据库、日志或响应；Engine 不可达时 Vio 仍启动并报告 `degraded`。
- Vio V4 已实现 E5-A 三份严格 Capability Schema、独立迁移 `021` 多 attempt 账本、`chat` 模型路由、Vio Permission → Security/Confirmation → Token Budget 门控、`env:VIO_MODEL_API_KEY_*` 密钥引用及 `openai_compatible` 非流式 HTTP adapter。`capability_required` / `capability_failed` 外层固定使用 `continuity-capability/v1`，`completed` 仍使用 `continuity-integration/v1.1`。模型候选只会先作为带来源的 CapabilityResult 回传 Engine，不能直接成为消息或修改状态。
- HTTP 回传结果未知时先查询，必要时只重发已保存的同一 canonical Result；这与 Provider 真实重试不同。`FAILED_RETRYABLE` 被 Engine 明确接受后进入 `waiting_retry`，只有后端内部明确批准并重新执行路由、权限、安全、预算和 deadline 检查后，才以新的 execution/result ID 再调用一次 Provider；`UNKNOWN` 被接受后保持 fail closed，不再次调用 Provider。成功或终止状态禁止新增执行。
- test-only JSONL Runner 仍只由独立共享测试显式启动，不会被应用、HTTP、前端或正式 transport 装配。S2/S3 已使用 Engine E4 正式 HTTP Server、Vio V3 正式 transport、V1/V2/V3 账本和临时双数据库完成 15/15 共享验收；正式 transport 仍默认关闭且没有公共或前端直连入口。
- AI 助手全局设定只保存用户明确配置的长期身份与行为偏好，不能覆盖平台安全规则，也不会自动形成或修改 SubjectState。
- 用户安全策略只能在已有 Permission 上继续收紧；`session_allow` 使用的开发期安全会话 ID 不是认证凭证，且只在明确确认后的精确范围内短时有效。
- 没有通用 Memory，也没有在仓库、数据库或文档保存真实 API Key。V4 已具备生产可配置的 `openai_compatible` HTTP adapter，但真实供应商 live smoke 未执行；`anthropic_messages`、`glm_compatible` 和 `custom_http` 仍 fail closed。AI Private Space 只有显式输入的数据层、版本、权限安全联动、独立 Context 投影与导出清单预留，不包含意识、自主行为、开放判断或 continuity-engine 生成。MCP/Skill/Plugin/Tool 目前只有注册、权限投影和未执行准备记录；设备目前只有注册、能力描述、授权和未执行操作日志。没有真实 MCP 连接、插件安装、Tool/Skill 执行、设备连接或控制、厂商 API、支付、真实 AI 私域决策、公共对话 API 串接或前端真实回复。
- 生活管理只保存显式输入并进行本地统计；提醒不执行，AI 建议不生成，本地记忆不自动进入通用 Context。没有支付、银行同步、健康设备数据、医疗诊断、真实导出或自动数据删除。
- 未认证后端不能直接公开部署。

S4 双仓共享验收已经完成；真实供应商 live smoke、V5 公共对话 API 与 F1 前端接线仍未开始，须等待后续独立任务。
