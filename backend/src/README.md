# 后端源码目录

本目录包含平台后端第一版可执行源码。

规划依赖方向：

```text
          http / transport
                ↓
             modules
                ↓
              core

integrations 通过 modules 定义的端口接入外部系统
```

- `core/`：跨模块稳定类型、标识和规则边界。
- `http/`：HTTP 路由、统一 JSON 返回和开发期请求上下文。
- `modules/`：平台业务能力及用例边界，当前还包含数据导出预检、记录、R1—R5 独立聊天/上下文/记忆及 R6 统一能力执行服务。
- `integrations/`：数据库、密钥存储、认证、模型、continuity-engine、MCP、Tool、设备和迁移载体等适配边界；当前包含各阶段 SQLite 账本、R1 OpenAI-compatible 执行器、R6 MCP Streamable HTTP 客户端，以及默认关闭的 Engine 本机 HTTP/JSON transport。设备与迁移载体适配器仍只有明确拒绝真实写入、连接或调用的未配置占位。

当前由 `app.js` 进行显式依赖装配，`server.js` 负责进程启动与关闭。Vio 独立聊天及 R6 能力执行只在个人会话、当前助手、Permission/Security/Confirmation 和对应恢复规则下工作；查询与启动不会发起模型或能力执行。R6 生产 MCP 仅允许受保护的公开 HTTPS，测试 loopback 由显式依赖注入开放；本地 Tool/Skill/Plugin 不获得任意代码执行权。V3 只有在显式启用且配置本机地址/token 后才装配历史 Engine 专用 HTTP transport；test-only fixture/JSONL transport 仍不注册到应用或 HTTP。业务模块不得绕过仓储直接访问 SQLite，Dashboard 只聚合已有数据，不承担连续性推演。
