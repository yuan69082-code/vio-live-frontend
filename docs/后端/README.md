# Vio Live 平台后端规划

## 文档定位

本目录保留《Vio Live 产品与开发总规划 v2.4｜平台后端与前端版》的历史来源；现行阶段顺序与职责按《Vio 完整工程施工监工规划 R0-R13 独立架构版》2026-09-04 四项决定修订执行，见 [ADR-034](../决策记录.md#adr-034) 与 [现行路线](13-部署运维测试与路线图.md#r0-r13-order)。

R0-A/B/C 及 R0 整阶段已验收并推送；当前聊天仍沿用既有链路，状态卡不证明独立聊天完成。R2 已于 **2026-09-05 正式验收通过**：个人所有者访问、首次设置、同用户多助手、会话撤销、访问审计/诊断、Provider/Model、加密凭据、认证连接检查及 7/14/30 天政策下的受控账户删除均完成本机闭环。邮箱、Google 和公开注册继续暂缓；R1 独立聊天与 R3 多会话尚未开始。

已确认产品顺序：R0 → R2 → R1 → R3 至 R13，编号不变；R2 已正式验收，下一阶段仍须单独授权。R2 完成个人访问和同一用户多个助手的创建、列表、选择与普通切换；R3 再完成每个助手多个会话及隔离。R8 完成公共机制及截至 R7 已完成模块的前端接线；R9—R11 各自完成对应前后端真实联调，R13 全量复验；保留工作台、对话、连续性、AI 私域、能力、我的六个导航。后续元素不能算作 R8 已完成，不扩展助手市场或多助手协作，不减少原真实功能或安全墙要求。

仓库已有平台后端、开发数据库和各业务数据基础。既有 Engine 专用 v1.1、S2/S3、S4、V5 共享验收保留；F1 已接入固定本地 V5 公共轮次 API，2026-08-14 首次 S4-Live 真实供应商试聊也已通过。共享自动测试使用受控 loopback Provider，S4-Live 则是独立人工真实供应商证据，两者不混算。最终主体 Message 在该专用链路内仍只来自 Engine/V2；一次固定可销毁身份试聊不等于真实认证、多助手产品能力、通用 Binding、完整独立聊天或生产部署完成。验收事实见 [BE-ADR-038](../../backend/docs/ADR.md) 和 [工程日志](../工程日志.md)。

## 系统边界

以下区分 Vio 自有层与可选外部系统，不把外部运行时列为必装层：

1. 用户端前端：承载登录、工作台、对话、连续性、AI 私域、能力、设备和设置页面。
2. Vio Core 平台后端：负责账号、助手、会话消息、模型供应商、本地记忆与上下文、权限安全、事件、扩展与设备、工作生活数据、费用及导出备份恢复。
3. 可选外部主体运行时：通过通用端口与适配器提供额外连续性、表达和投影。Continuity Engine 仅为特定适配器，未选用时不要求其存在。
4. AI 模型：提供语言、图像、视频和语音等模型能力。
5. 外部能力：包括 MCP、Skill、插件、Tool、手机、家电、穿戴设备和第三方服务。

两种模式的回复来源、上下文、状态及执行权见 [端口规则](../../backend/docs/SUBJECT_RUNTIME_PORT_V1.md#mode-semantics)。R0 冻结、R1 实际解耦；首次彻底解耦后，未经用户另行要求重连，不探测、读取、启动或修改真实引擎。通用接口必须验证，真实外部运行时接入不作为 Vio 完成或发布条件；今后优先独立适配器/接口扩展，不擅改核心或对方仓库。

## 当前状态

- 项目当前包含 React + Vite + TypeScript 前端，以及独立的 Node.js 平台后端工程。
- 历史 F1 代码仍读取固定本地 Profile 的 V5 Message/Turn，新个人主入口不挂载它、不认领旧缓存；R2 的访问、首次设置、资料/助手、访问安全与能力配置页已接真实个人 API。R1 身份化独立聊天尚未实现。
- 已建立独立 `backend/` 工程、README、后端 ADR、开发日志和阶段实施路线。
- 后端可以独立启动，并提供统一响应、健康检查、User/User Space/Subject/Dashboard、当前助手与数据隔离检查、Assistant Global Settings、Conversation/Message/MessageVersion、Event、Provider/Model、Model Routing Rule、扩展/设备、主动交互、Data Export、Permission、Security Policy、安全偏好、Security、Confirmation 和 AuditLog 基础接口。
- 主动交互基础支持四类 Wake、Event 驱动提示、四级消息优先级、每日/会话 Token 预算、显式使用账本和 `idle` / `active` 后台策略；所有运行能力固定未连接或未执行。
- 数据导出基础支持三类版本化 Schema、十二类范围、复合归属/必需字段/外键预检、安全确认和导出记录；载荷、文件、外部存储与迁移固定未生成/未连接/未执行。
- 已完成核心逻辑数据模型，并使用开发期 SQLite 实现账号/主体、设定/私域、对话/摘要/状态、事件、模型路由、能力/设备、主动交互、Export Schema/DataExportRecord、权限/安全/确认/审计及迁移记录。
- R2 个人所有者拥有一个 User Space，可真实创建、读取、修改、选择多个助手；切换不能改变设定、私域、消息、记忆、上下文或费用的既有归属。R3 的各助手多个会话尚未实施。
- R2 账户整体删除通过既有账户级高风险确认，立即撤销旧会话并阻止业务与凭据使用；独立删除访问能力只可查任务、受控撤销或到期重试。迁移 `024` 以任务/所有者/实际行范围授权删除，保留普通历史不可变保护；状态区分在线数据、受管文件/备份和 SQLite/WAL，不声明物理擦除用户自存副本。接口与期限以 [R2 个人合同](../../backend/docs/R2_PERSONAL_CONTRACT.md) 为准，不冒充 R3 单消息删除或 R11 完整备份。
- 统一数据隔离检查覆盖用户、AI、设备、生活和事件五类资源，先执行数据库复合归属过滤，再对私域/设备/生活资源执行 Permission 与 Security Policy；所有结果固定未执行。
- Conversation 当前只支持主体范围的线性文本流；Message 保存稳定顺序和当前版本指针，MessageVersion 保存不可覆盖的原始、编辑和重生成记录。
- ConversationSummary 按会话不可变追加并引用 MessageVersion/Event 来源；跨窗口只读取同主体其他 Conversation 的最新摘要。
- legacy/unverified SubjectState 仍保存开发调用方 `state_update`；R1 须收口普通写入口并保留历史来源，不把旧状态当作外部权威。仅在选择 Engine 适配器时，Engine 对其 SubjectState 唯一权威，Vio 只存受控投影；独立模式仍拥有自己的业务事实，但不伪造外部状态。
- AI Assistant Global Settings 一对一绑定 Subject，支持长期身份与偏好读取/更新；它不会创建、覆盖或切换动态 SubjectState。
- 现有 Context API 只读投影设定、状态记录、事件、近期消息和跨窗口摘要，Memory 等仍为占位；该端点不调用模型。独立模式的自有 Context/记忆由 Vio 负责，在后续阶段完成；仅在既有 Engine 合同内，Vio 提供经权限筛选的事实，Engine 组织其最终认知 Context。
- AI Private Space 当前只有显式输入、不可变版本、安全投影和导出准备基础，不自动进入通用 Context。v1.1 的三域分隔及绑定主体引擎决定私域内容创建/编辑是特定适配器的历史合同规则，继续保留；不能据此要求独立 Vio 安装 Engine 或取消其自有记忆/私域职责。完整私域产品在 R10 验收，跨系统读写当时不在第一轮最小测试内。
- 生活管理使用独立生活数据表保存财务、预算、四类月历、身体指标/目标和本地记忆，并由 User Space 作为用户归属根；所有敏感访问经过 `life_data` Permission 与 Security Policy。
- Event 当前支持用户/可选主体归属、二十四种事件类型，以及按用户、主体、发生时间、类型和状态筛选；对话、安全、私域、生活和主动交互事件不复制正文、音频或敏感操作数据，尚无事件消费者。
- R2 已提供个人 Provider/Model 配置、加密凭据保存/轮换/撤销和 `/models` 认证检查；该检查不生成。V4 的 `openai_compatible` 执行、usage 账本与历史 S4-Live 验收保持独立，不把认证检查等同于生成能力验证。
- Permission 当前支持十类资源（含 `proactive_interaction`、`data_export`）、五档权限、精确操作判断和创建/变化/撤销生命周期事件；不执行任何真实外部资源操作。
- Security Policy 支持五种规则、用户默认风险/高风险/自动确认/禁止偏好和 30 分钟精确会话授权；策略只能收紧 Permission，高/极高风险保持逐次确认。
- Security 当前按 Permission → Policy → Confirmation 返回执行资格，明确标记未执行；确认绑定完整作用域、权限/策略版本和开发期安全会话并单次消费。
- SensitiveData 只定义五类分类元数据；AuditLog 与 Event 分离且只保存最小脱敏字段。
- Tool/MCP/Skill/Plugin 当前只保存注册元数据并按主体投影权限；MCP 未连接、Plugin 未安装、Skill/Tool 未执行。Tool 准备记录只表示 Permission 与 Security 门槛结果。
- Device 当前按用户保存七类设备和四类能力元数据，主体授权复用 Permission；统一 Adapter 只有小米、美的、Apple、Android 和通用类型的未配置描述。设备始终标记未连接、状态未观测，操作准备与日志始终标记未执行，不包含厂商客户端或真实控制参数。
- 当前已有个人服务端会话认证和 SQLite 持久化，但没有公网 HTTPS/服务器部署、生产认证与多租户验收，基础路由不得直接公开部署。
- 总规划记录的部分连续性底层框架不等于平台后端已经完成。
- 已完成：Vio 与 Continuity Engine 长期架构、SubjectState 权威、Observation/内部 Event 边界，以及第一轮 Schema、固定 SubjectBinding、幂等、revision、错误、投影和 ContractTestAdapter 入口的契约对齐；Continuity Engine 已正式接受 v1.1。
- 历史基线：S2/S3 使用 E4 `189441f9bad2a34119b4ef10365a4385ed0949cc`，S4 在 E5-A `cba52126db2fb5eca57d9b5c0c80884693c59a6f` 上通过；这些不是本轮读取或要求真实 Engine 当前保持的基线。专用服务的 loopback 边界及 test-only Runner 隔离保留。
- V1—V4 账本与执行/回传基础均已完成；历史 S2/S3 15/15、S4 7/7、V1—V4 101/101 与当时后端 159/159 只记录对应阶段。R0 最近历史证据及本轮未运行项统一见 [R0 矩阵](../../backend/docs/SUBJECT_RUNTIME_PORT_V1.md#r0-evidence)，不混报为本轮通过数。
- V3 默认关闭，不提供公共交付路由；显式启用时只连接本机 Engine，Engine 不可达不会阻止 Vio 启动。共享子进程 transport 仍只在 `test-support` 和独立共享测试中启用。
- 历史 S2/S3 正式本机连接状态：V1 → V3 → Engine E4 → V2 已通过真实 loopback HTTP 正常、错误、崩溃与重启恢复验收；历史 S4 在 E5-A 上验证 V1 → V3 → V4 → Engine → V2 Capability 闭环。两阶段的 Wake、Thinking、Event、StateUpdateRecord、revision、result、projection 和 receipt 均保持幂等。
- V5 固定本地 Profile 公共轮次 API、迁移 `022` 和恢复账本已完成；用户 Message 可经 V1 → V3 → Engine E5-A → V4 → V2 形成唯一 Engine 最终主体 Message。
- F1 真实页面回复和首次真实供应商试聊已通过；Vio 费用账本为 `not_reported`，不把供应商概览的 ¥0 当作最终账单。R2 个人访问、多助手及账户整体删除已完成本机验证，最终证据在 R2 合同/日志；独立聊天、通用外部 Binding、生产认证、多租户和部署仍未完成。
- 分支、消息删除、窗口重置、真实摘要生成、语义检索、私域披露/删除、真实导出文件/下载/外部存储、备份恢复、生活记录删除、自动提醒、健康设备、真实语音/系统唤醒、后台调度、消息投递、正式数据库、公共 Capability 产品入口、通用对话 Profile 与其前端接线、真实 MCP、插件安装、Skill/Tool 执行、真实设备/机器人连接控制、载体迁移及其他厂商 API/外部执行仍待归属阶段；仅已有固定 V5/F1 和状态页接线可记为已实现。V4/S4-Live 已有一次真实 usage 事实，不代表完整费用管理或最终账单对账完成；支付/银行接入未实现，真实转账、代扣、账户冻结及助手市场/协作仍暂缓，不因本轮文档收尾扩展范围。
- GitHub 只保存代码和文档，不保存运行数据、用户数据或密钥。

## 文档目录

- [Subject Runtime Port v1 后端合同](../../backend/docs/SUBJECT_RUNTIME_PORT_V1.md)
- [R0 要求与验收证据矩阵](../../backend/docs/SUBJECT_RUNTIME_PORT_V1.md#r0-evidence)
- [四项决定 ADR-034](../决策记录.md#adr-034)
- [R0-R13 现行施工顺序](13-部署运维测试与路线图.md#r0-r13-order)

- [01-总体架构与系统边界.md](01-总体架构与系统边界.md)
- [02-领域模型与数据库设计.md](02-领域模型与数据库设计.md)
- [数据库设计.md](数据库设计.md)
- [数据关系图.md](数据关系图.md)
- [03-账号认证与数据隔离.md](03-账号认证与数据隔离.md)
- [04-事件总线与审计版本.md](04-事件总线与审计版本.md)
- [05-对话上下文与连续性接口.md](05-对话上下文与连续性接口.md)
- [06-模型路由密钥与Token管理.md](06-模型路由密钥与Token管理.md)
- [07-扩展能力与设备适配.md](07-扩展能力与设备适配.md)
- [08-权限安全与隐私治理.md](08-权限安全与隐私治理.md)
- [09-AI私域后端规则.md](09-AI私域后端规则.md)
- [10-生活管理后端.md](10-生活管理后端.md)
- [11-数据导出备份与迁移.md](11-数据导出备份与迁移.md)
- [12-API与事件契约.md](12-API与事件契约.md)
- [13-部署运维测试与路线图.md](13-部署运维测试与路线图.md)
- [14-continuity-engine连接契约v1.md](14-continuity-engine连接契约v1.md)
- [14-continuity-engine连接契约v1.1.md](14-continuity-engine连接契约v1.1.md)
- [14a-Engine-Contract-Response对齐差异说明.md](14a-Engine-Contract-Response对齐差异说明.md)
- [14b-Continuity-Engine第二次审核报告.md](14b-Continuity-Engine第二次审核报告.md)
- [14c-Engine-Contract-Final-Read-Only-Short-Confirmation-v1.md](14c-Engine-Contract-Final-Read-Only-Short-Confirmation-v1.md)

## 维护规则

- 本目录记录稳定规划和约束，不记录具体实现代码。
- 后端详细工程记录写入 `backend/docs/开发日志.md`，项目级摘要继续写入 `docs/工程日志.md`。
- 版本变化继续写入 `docs/更新记录.md`。
- 后端局部技术取舍写入 `backend/docs/ADR.md`；影响平台总体边界的决策同步到 `docs/决策记录.md`。
- 未经新的产品决策，不在本目录扩展总规划之外的产品功能。
- 密钥、密码、Token、用户原始数据和设备凭据不得写入文档或 GitHub。

## 工程设计入口

- [后端工程 README](../../backend/README.md)
- [后端 API 说明](../../backend/docs/API.md)
- [后端 ADR](../../backend/docs/ADR.md)
- [后端开发日志](../../backend/docs/开发日志.md)
- [第一阶段实施路线](../../backend/docs/第一阶段实施路线.md)
