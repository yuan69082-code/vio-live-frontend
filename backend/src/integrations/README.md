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

任何集成都必须经过平台身份、User Space、主体复合归属、Permission、Security Policy、风险确认和审计边界。当前实现开发期 SQLite 数据库适配，包括 User Space/当前助手、预定义数据隔离查询、AI Private Space 与不可变版本、Provider/Model、能力/设备注册、生活管理、主动交互、版本化 Export Schema/记录、Permission/Security/Confirmation/AuditLog，以及 Continuity V1 请求与 V2 结果/投影账本。Continuity transport 目前只有明确不可调用的默认端口和测试目录中的 fixture，不存在生产适配器。迁移载体 Registry 仅返回 `not_implemented` / `not_connected` 契约，不接收地址、凭据或业务数据。当前没有真实认证、Engine 网络连接、模型、语音、支付、外部存储、MCP/Tool 执行、真实设备 SDK、机器人或厂商客户端，也没有生产密钥/敏感数据加密适配。
