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
- `modules/`：平台业务能力及用例边界，当前包含 User、Subject、Assistant Global Settings、Conversation、Message、MessageVersion、ConversationSummary、SubjectState、Context、Event、Provider/Model、模型路由规则、权限与安全等服务。
- `integrations/`：数据库、密钥存储、认证、模型、continuity-engine、MCP、Tool 和设备等适配边界；当前密钥存储只有拒绝写入的未配置占位。

当前由 `app.js` 进行显式依赖装配，`server.js` 负责进程启动与关闭。业务模块不得绕过仓储直接访问 SQLite；Dashboard 只聚合已有数据，不承担连续性推演。Assistant Global Settings 是用户明确配置且可更新的长期设定，SubjectState 是带来源且不可变追加的动态状态，两者独立。Conversation、Message、MessageVersion、ConversationSummary 与 SubjectState 采用复合归属和不可变版本；主体消息、摘要和 `state_update` 均由开发调用方显式提交。Context 只读投影已有事实。Model Router 只读取用户范围的 Provider、Model 与默认/备用规则，不读取或写入 Context、SubjectState 或 Global Settings；两者都不调用 AI、外部 API 或 continuity-engine。
