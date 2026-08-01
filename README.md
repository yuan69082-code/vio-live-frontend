# Vio Live

Vio Live 当前包含 React + Vite + TypeScript 前端，以及位于 `backend/` 的独立 Node.js 平台后端。前端页面仍保留并使用原有 mock 数据；平台后端已完成账号/主体、全局设定/AI 私域、对话/摘要/状态/Context、事件、模型路由、权限安全、扩展与设备注册，以及管账、预算、月历、身体管理和本地记忆基础。

后端现可按用户保存 Security Policy 与安全偏好，并按 Permission → Policy → Confirmation 保护私域及生活数据。生活模块使用独立 User Space 表和 `life_data` 权限，提供本地确定性统计与受控记忆投影；不会支付、同步银行/健康设备或调用 AI。设备适配器仍只有未配置描述，扩展和设备均不执行真实操作。前端入口仍只通过 Vite 同源代理非阻塞检查 `/health`，页面尚未迁移到这些真实 API。

[`Continuity Integration Contract v1.1`](docs/后端/14-continuity-engine连接契约v1.1.md) 已由 Continuity Engine 正式接受。Engine E1/E2/E3 已在引擎提交 `c732f35` 完成；Vio V1 现已实现第一轮三份严格机器 Schema、本地 RFC 8785/hash、固定测试 Binding 装载，以及未发送逻辑请求的构造和跨重启持久化。**这不表示 Vio 已连接 continuity-engine**：Vio 投影接收、双方共享测试、网络传输和生产 Integration Adapter 仍未开始。Continuity Engine 继续是 AI SubjectState 唯一权威源，前端也仍只能连接 Vio 后端。

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
- 摘要和 `state_update` 也由开发调用方显式提交；Context 只读投影不生成提示词或消耗 Token。连接设计要求现有 `state_update` 后续收口为受信引擎投影入口或停用，Context 只作为平台事实来源，二者都不代表引擎已经接通。
- Vio V1 已实现第一轮 `ContinuityInteractionRequest`、`message_created` PlatformObservation 和 `message_version` fact 的严格本地 Schema/validator、固定 SubjectBinding fixture/hash、逻辑请求构造及请求输入跨重启恢复；没有新增 HTTP 或生产连接入口。
- Engine 侧 ContractTestAdapter 和结果账本已经由 Engine E1/E2/E3 实现，但 Vio 尚未连接它。Vio V2 的 operation/response/stateProjection 接收与幂等恢复、revision 冲突隔离、双方共享测试、网络传输和生产 Adapter 仍未实现。
- AI 助手全局设定只保存用户明确配置的长期身份与行为偏好，不能覆盖平台安全规则，也不会自动形成或修改 SubjectState。
- 用户安全策略只能在已有 Permission 上继续收紧；`session_allow` 使用的开发期安全会话 ID 不是认证凭证，且只在明确确认后的精确范围内短时有效。
- 没有通用 Memory、真实 API Key、模型连通性测试或模型调用。AI Private Space 只有显式输入的数据层、版本、权限安全联动、独立 Context 投影与导出清单预留，不包含意识、自主行为、开放判断或 continuity-engine 生成。MCP/Skill/Plugin/Tool 目前只有注册、权限投影和未执行准备记录；设备目前只有注册、能力描述、授权和未执行操作日志。没有真实 MCP 连接、插件安装、Tool/Skill 执行、设备连接或控制、厂商 API、支付、真实 AI 私域决策或 continuity-engine 接入。
- 生活管理只保存显式输入并进行本地统计；提醒不执行，AI 建议不生成，本地记忆不自动进入通用 Context。没有支付、银行同步、健康设备数据、医疗诊断、真实导出或自动数据删除。
- 未认证后端不能直接公开部署。
