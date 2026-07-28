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

任何集成都必须经过平台身份、主体、Permission、Security Policy、风险确认和审计边界。当前只实现开发期 SQLite 数据库适配，包括 AI Private Space 与不可变版本、Provider/Model、能力 Registry、Tool 未执行使用记录、Device Registry/Capability/未执行操作日志、Permission、Security Policy、用户安全偏好、短时策略会话、Confirmation 和 AuditLog 仓储。私域正文只写入专用本地表，不进入 Event/AuditLog 或外部集成。设备目录提供小米、美的、Apple、Android 和通用类型的未配置 Adapter 描述，全部固定 `not_implemented` 且没有连接或控制方法实现。当前没有模型、支付、MCP 客户端、Plugin 安装器、Skill/Tool 执行器、真实设备 SDK、机器人或厂商客户端，也没有生产密钥/敏感数据加密适配。
