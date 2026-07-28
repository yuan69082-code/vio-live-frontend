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
- `modules/`：平台业务能力及用例边界，当前还包含 Wake、主动提示、Token Budget/Usage 和助手后台策略服务。
- `integrations/`：数据库、密钥存储、认证、模型、continuity-engine、MCP、Tool 和设备等适配边界；当前密钥存储和设备适配器都只有明确拒绝真实写入或调用的未配置占位。

当前由 `app.js` 进行显式依赖装配，`server.js` 负责进程启动与关闭。业务模块不得绕过仓储直接访问 SQLite；Dashboard 只聚合已有数据，不承担连续性推演。主动交互模块只保存配置、显式计量和安全准备，`voice` 不接麦克风，后台策略不启动调度，提示不投递，Token 检查不调用模型。Model Router、Capability、Tool Usage 和 Device Operation 的既有未调用/未执行边界保持不变。上述模块都不调用 AI、MCP、Tool、设备、厂商 API、外部 API 或 continuity-engine。
