# Vio Live

Vio Live 当前包含 React + Vite + TypeScript 前端，以及位于 `backend/` 的独立 Node.js 平台后端。前端页面仍保留并使用原有 mock 数据；平台后端已完成 User、Subject、Event、模型目录与规则路由、Permission、Security、AuditLog，以及基础 API 连接层。

当前阶段首次建立了真实浏览器到后端的开发连接：前端入口通过 Vite 同源代理非阻塞检查 `/health`。这不代表登录、首次设置或工作台页面已经切换为真实数据，也不代表真实认证已经完成。

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
- 没有真实 API Key、模型调用、MCP、Tool、设备、支付、AI 私域或 continuity-engine 接入。
- 未认证后端不能直接公开部署。
