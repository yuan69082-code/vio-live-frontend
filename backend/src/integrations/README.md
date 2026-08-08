# 外部集成边界

本目录未来承载可替换的外部适配实现，包括：

- 数据库与迁移工具
- 登录身份提供方与邮件服务
- 密钥存储
- continuity-engine
- AI 模型服务
- MCP、Skill、插件和 Tool
- 手机、家电与穿戴设备
- 日志、监控、备份和对象存储

任何集成都必须经过平台身份、User Space、主体复合归属、Permission、Security Policy、风险确认和审计边界。当前实现开发期 SQLite 数据库适配，包括 User Space/当前助手、预定义数据隔离查询、AI Private Space 与不可变版本、Provider/Model、能力/设备注册、生活管理、主动交互、版本化 Export Schema/记录、Permission/Security/Confirmation/AuditLog，以及 Continuity V1 请求、V2 结果/投影和 V3 delivery/outbox 账本。Continuity 正式 transport 使用 Node 内置 HTTP 客户端，只接受无凭据的 `http://127.0.0.1:<port>`，默认关闭并以 Bearer service token 调用 Engine E4；测试 fixture/JSONL bridge 与正式装配隔离。迁移载体 Registry 仍只返回 `not_implemented` / `not_connected` 契约。当前没有真实认证、真实模型、语音、支付、外部存储、MCP/Tool 执行、真实设备 SDK、机器人或厂商客户端，也没有生产密钥/敏感数据加密适配；双方 S2/S3 正式本机共享验收尚未开始。
