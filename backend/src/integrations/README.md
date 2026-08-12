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

任何集成都必须经过平台身份、User Space、主体复合归属、Permission、Security Policy、风险确认和审计边界。当前 SQLite 适配已覆盖 Continuity V1 请求、V2 结果/投影、V3 delivery、V4 Capability execution/result 和 V5 Conversation Turn 账本。正式 transport 使用 Node 内置 HTTP 客户端，只接受显式启用的 loopback Engine；V4 仅正式支持 `openai_compatible` Provider，测试 fixture/JSONL bridge 与正式装配隔离。S2/S3、S4 与 V5 shared test 已验证真实本机 HTTP、Capability 和公共轮次的崩溃恢复与幂等，双方从不读取对方数据库。当前仍没有真实认证、真实供应商 live smoke、前端接线、语音、支付、外部存储、MCP/Tool 执行、真实设备 SDK、机器人或生产密钥管理适配。
