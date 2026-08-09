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
- `modules/`：平台业务能力及用例边界，当前还包含数据导出预检、记录与未来载体契约服务。
- `integrations/`：数据库、密钥存储、认证、模型、continuity-engine、MCP、Tool、设备和迁移载体等适配边界；当前包含 Vio V1/V2 SQLite 账本仓储、V3 delivery/outbox 仓储和默认关闭的本机 HTTP/JSON transport。密钥存储、设备与迁移载体适配器仍只有明确拒绝真实写入、连接或调用的未配置占位。

当前由 `app.js` 进行显式依赖装配，`server.js` 负责进程启动与关闭。V3 只有在显式启用且配置本机地址/token 后才装配正式 HTTP transport；启动时优先从本地 V2 checkpoint 恢复，再对未知结果执行查询，不因 Engine 不可达阻止 Vio 启动。该装配已通过 S2/S3 真实 loopback HTTP 正常、崩溃与重启共享验收；test-only fixture/JSONL transport 仍不注册到应用或 HTTP。业务模块不得绕过仓储直接访问 SQLite；Dashboard 只聚合已有数据，不承担连续性推演。数据导出、主动交互、Model Router、Capability、Tool Usage 和 Device Operation 的既有未调用/未执行边界保持不变。除显式启用的 Continuity 本机 HTTP transport 外，模块都不调用 AI、MCP、Tool、设备、机器人、厂商 API 或外部 API。
