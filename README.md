# Vio Live

Vio Live 当前包含 React + Vite + TypeScript 前端，以及位于 `backend/` 的独立 Node.js 平台后端。前端页面仍保留并使用原有 mock 数据；平台后端已完成 User、Subject、AI Assistant Global Settings、Conversation、Message、MessageVersion、ConversationSummary、SubjectState、只读 Context、Event、Provider/Model 目录、默认/备用模型路由规则、Permission、Security、AuditLog、Tool/MCP/Skill/Plugin Registry、主体能力视图，以及基础 API 连接层。

后端现可按用户保存 Provider/Model 路由配置与四类扩展能力注册元数据，并按主体统一查询注册分类、Permission 状态和 Tool 最近使用。Tool 执行准备只完成 Permission 与 Security/Confirmation 检查并保存 `not_executed` 记录；MCP 不连接，Plugin 不安装，Skill/Tool 不执行。前端入口仍只通过 Vite 同源代理非阻塞检查 `/health`，页面尚未迁移到这些真实 API。

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

后端接口与运行说明见 [`backend/README.md`](backend/README.md)，基础 API 契约见 [`backend/docs/API.md`](backend/docs/API.md)。

## 当前边界

- 页面、组件和 `src/data/*Mock.ts` 仍是前端原型数据源。
- 没有真实 Google/邮箱验证码登录或会话；`x-vio-user-id` 只用于开发期当前用户上下文。
- 主体消息和重生成内容由开发调用方显式提交，只形成数据与事件记录，不代表 AI 已生成回复。
- 摘要和 `state_update` 也由开发调用方显式提交；Context 只读投影不生成提示词或消耗 Token。
- AI 助手全局设定只保存用户明确配置的长期身份与行为偏好，不能覆盖平台安全规则，也不会自动形成或修改 SubjectState。
- 没有 Memory、真实 API Key、模型连通性测试或模型调用。MCP/Skill/Plugin/Tool 目前只有注册、权限投影和未执行准备记录，没有真实 MCP 连接、插件安装、Tool/Skill 执行、设备、支付、AI 私域或 continuity-engine 接入。
- 未认证后端不能直接公开部署。
