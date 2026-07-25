# 后端源码目录

本目录包含平台后端第一版可执行源码。

规划依赖方向：

```text
interfaces / transport（技术栈确定后建立）
                ↓
             modules
                ↓
              core

integrations 通过 modules 定义的端口接入外部系统
```

- `core/`：跨模块稳定类型、标识和规则边界。
- `modules/`：平台业务能力及用例边界。
- `integrations/`：数据库、认证、模型、continuity-engine、MCP、Tool 和设备等适配边界。

当前由 `app.js` 进行显式依赖装配，`server.js` 负责进程启动与关闭。业务模块不得绕过仓储直接访问 SQLite。
