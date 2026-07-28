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
- `modules/`：平台业务能力及用例边界，当前包含 User、User Space、数据隔离、Subject、Assistant Global Settings、AI Private Space、Conversation、Message、MessageVersion、ConversationSummary、SubjectState、Context、Event、Provider/Model、模型路由规则、能力注册、统一能力视图、Tool 使用准备、Device Registry、Device Capability、设备操作准备、Permission、Security Policy、Security、Confirmation 与审计等服务。
- `integrations/`：数据库、密钥存储、认证、模型、continuity-engine、MCP、Tool 和设备等适配边界；当前密钥存储和设备适配器都只有明确拒绝真实写入或调用的未配置占位。

当前由 `app.js` 进行显式依赖装配，`server.js` 负责进程启动与关闭。业务模块不得绕过仓储直接访问 SQLite；Dashboard 只聚合已有数据，不承担连续性推演。User Space 只保存开发期身份状态和当前助手指针，数据隔离模块只编排预定义复合归属查询与既有安全链。Assistant Global Settings、SubjectState 与 AI Private Space 是三个独立事实域：长期用户设定、带来源动态状态、受安全门保护的高敏感私域版本。通用 Context 不自动读取私域，私域投影使用独立 Permission/Policy 入口。Conversation、Message、MessageVersion、ConversationSummary、SubjectState 与私域内容采用复合归属和不可变版本。所有内容均由开发调用方显式提交。Model Router、Capability、Tool Usage 和 Device Operation 的既有未调用/未执行边界保持不变。上述模块都不调用 AI、MCP、Tool、设备、厂商 API、外部 API 或 continuity-engine。
