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

任何集成都必须经过平台身份、User Space、主体复合归属、Permission、Security Policy、风险确认和审计边界。R0-A 已冻结通用端口，R0-B 已默认装配 None Adapter 与只读状态，R0-C 已接入展示，但聊天编排仍沿用既有路径。现有 SQLite 适配及 HTTP transport 承载 Engine 专用 V1—V5 账本；V4 的 `openai_compatible` 执行与 test fixture/JSONL bridge 隔离，S2/S3、S4、V5 的真实本机历史验收保留。

R2 新增个人 SQLite 仓储、跨平台进程内凭据库和 Provider 认证检查适配器。凭据库只把 AES-256-GCM 密文写入个人账本，库密钥由个人口令派生密钥包装；浏览器以临时 RSA-OAEP/AES-GCM 运输提交，不读取原文。认证检查只支持经过 DNS/IP、HTTPS、重定向、超时和响应大小门禁的 `openai_compatible /models`，测试环境只能通过显式依赖注入授权随机 loopback origin。它不复用真实 Engine、不自动跟随重定向，也不调用生成接口。

R3 新增 SQLite 多会话仓储与仓库外受管附件存储适配器。对象键由服务端生成，读取和删除必须同时匹配 owner、assistant、conversation、attachment 及 `personal_managed_copies` 登记；公共响应不暴露绝对路径。R3 模型执行继续复用 R1 的 OpenAI-compatible 适配器，loopback 仅限测试注入，不增加新的供应商接口或外部运行时依赖。

现行顺序与权限见 [ADR-034](../../../docs/决策记录.md#adr-034)。R1 整理 Vio 自身适配边界并完成聊天解耦，不要求真实 Engine 陪测。首次彻底解耦后，未经用户另行要求重连，不探测、读取、启动或修改真实引擎；通用端口须完整验证，具体外部运行时接入另行处理，不作为 Vio 完成或发布条件。当前文档收尾不运行任何集成，不改变既有 transport 或数据库语义。
