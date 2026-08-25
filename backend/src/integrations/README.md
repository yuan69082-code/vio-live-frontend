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

任何集成都必须经过平台身份、User Space、主体复合归属、Permission、Security Policy、风险确认和审计边界。R0-A 已在 `modules/subject-runtime/` 冻结通用 Subject Runtime Port v1；外部运行时集成今后必须通过该端口和独立适配器进入，Continuity Engine 只是一个可选适配器。当前 SQLite 适配已覆盖 Continuity Engine Adapter 专用的 V1 请求、V2 结果/投影、V3 delivery、V4 Capability execution/result 和 V5 Conversation Turn 账本。正式 transport 使用 Node 内置 HTTP 客户端，只接受显式启用的 loopback Engine；V4 仅正式支持 `openai_compatible` Provider，测试 fixture/JSONL bridge 与正式装配隔离。S2/S3、S4 与 V5 shared test 已验证该适配器的真实本机 HTTP、Capability 和公共轮次崩溃恢复与幂等，双方从不读取对方数据库。R0-A 没有切换应用装配；该解耦属于 R1。
