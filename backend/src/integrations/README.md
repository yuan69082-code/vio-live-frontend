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

任何集成都必须经过平台身份、主体、权限、风险确认和审计边界。当前只实现开发期 SQLite 数据库适配，包括 Provider/Model、能力 Registry、Tool 未执行使用记录、Permission、Confirmation 和 AuditLog 仓储；没有模型、支付、MCP 客户端、Plugin 安装器、Skill/Tool 执行器、设备或手机适配器，也没有为密钥、外部凭据或敏感正文建立集成写入结构。
