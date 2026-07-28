# Vio Live 平台后端

## 当前状态

当前阶段为“平台后端 14｜数据导出与未来迁移”。后端已经可以独立启动，并在既有数据隔离与安全体系上建立版本化导出准备框架：

```text
React 启动 → Vite 同源代理 → 后端健康检查
API 请求 → 版本化路由 → 领域服务 → 开发数据库 → 统一响应
对话事实 → 可追溯摘要 → 跨窗口读取 → 当前主体状态 → 只读上下文投影
主体身份 → 长期全局设定 → 跨窗口读取/更新 → Context 只读投影
Provider 配置 → Model 能力目录 → 默认/备用规则 → 本地选择结果
Tool/MCP/Skill/Plugin 元数据 → 主体能力视图 → Permission 预览
Tool 执行准备 → Permission 检查 → Security 检查/确认 → 未执行使用记录
Device Registry → Capability 描述 → 未配置 Adapter 投影
设备操作准备 → Permission → Security/Confirmation → device_changed Event → 未执行操作日志
用户安全偏好/精确策略 → Permission → Policy → Confirmation → 未执行准备与审计
AI Private Space → Permission → Security Policy → Confirmation → 受控本地读写/投影
生活数据 → life_data Permission → Security Policy → Confirmation → 本地保存/统计/投影
用户创建 → User Space 根归属 → 助手列表/当前助手 → 独立数据边界
资源访问检查 → 数据库复合归属过滤 → Permission → Security Policy → Confirmation
Wake/主动提示准备 → 用户授权/后台限制 → Permission → Security → Event → 固定未执行
Token 请求 → 日/会话预算 → 超额策略 → 可选高风险确认 → 固定不调用模型
Export Schema → 用户/主体归属与字段/外键预检 → data_export Permission → Security/Confirmation → ready 记录
迁移契约准备 → Schema 兼容检查 → 未配置载体描述 → 固定不连接、不传输、不执行
```

已实现：

- Node.js 22 ESM 后端启动入口
- 环境变量配置管理
- 开发期 SQLite 数据库与顺序迁移
- User 创建和查询
- 开发期当前用户解析；显式标明不是认证或登录会话
- User 创建时原子建立一对一 User Space；既有用户通过迁移补齐空间与稳定当前助手
- User Space 支持读取用户身份占位、助手列表、当前助手和持久化切换；首个新建助手自动成为当前助手
- 数据隔离层按明确资源类型验证 `user_id`、`assistant_id` 与资源 ID，统一返回用户、AI、设备、生活和事件五类归属
- AI Private Space、Device 和生活资源在归属验证后继续进入 Permission → Security Policy → Confirmation；检查结果不执行资源操作
- Subject 创建、列表、所属用户绑定、查询和基础信息更新
- Subject 实际更新与 `subject_updated` Event 同事务提交
- AI Assistant Global Settings 读取与局部更新，支持名称、头像、人格描述、表达方式、关系定义、长期要求和禁止事项
- 全局设定与 SubjectState 分库存储、语义分离；设定更新不创建或覆盖动态状态版本
- Dashboard 对现有 User/Subject 与基础可用状态的安全聚合
- Conversation 创建、列表和按用户/主体双重归属查询
- `user`、`subject`、`system` 三类 Message 创建及稳定 `sequenceNumber` 排序
- Message 当前版本投影与完整 MessageVersion 历史查询
- 用户消息编辑和主体消息重生成记录；`baseVersionId` 防止陈旧写覆盖当前版本
- `original`、`edited`、`regenerated` 三类不可覆盖消息版本及同消息父版本约束
- ConversationSummary 不可变追加、会话内单调版本及 MessageVersion/Event 来源引用
- 从当前 Conversation 读取同一主体其他窗口的最新摘要
- `state_update` 接收、不可变 SubjectState 历史、当前状态指针和未解决 Event 引用
- 按安全规则占位、完整助手全局设定、当前状态、未解决事件、近期消息、跨窗口摘要、记忆占位和本轮用户消息顺序装配上下文
- 上下文接口明确返回模型、外部 API 与 continuity-engine 均未调用
- Event 创建、单项查询及按用户、主体、时间、类型和状态筛选
- 二十四类基础软件事件和事件数据秘密字段拦截
- AI Private Space 按用户与助手一对一保存，和 User Space 使用独立表；五类私域内容按不可变版本追加
- 私域读取、写入、状态管理、Context 投影和导出准备统一经过 `private_domain` Permission 与 Security Policy
- 私域 Context 只提供独立、受控的数据投影；导出接口只返回版本清单预留，不生成文件或传输正文
- 管账记录支持收入/支出、分类筛选、分类统计和 UTC 月度汇总；金额按最小货币单位保存
- 预算按主体、月份和分类唯一保存，支持阈值提醒规则，不连接支付或银行
- 月历支持纪念日、生理期、亲密记录、普通事件、提醒与局部更新
- 身体管理支持体重/三围记录、目标和确定性趋势差值；AI 建议仅保存调用方显式文本
- 本地记忆支持保存、筛选、参与上下文开关、导出标记和独立受控 Context 投影
- 生活数据使用 `life_data` Permission → Security Policy → Confirmation，Event 不复制敏感正文或数值
- APIProvider 创建、列表/单项查询和启停状态更新，保存 Base URL、接口格式及只读测试状态
- Model 创建、单项查询、费用说明和按 `chat`、`long_text`、`vision`、`image`、`video`、`audio`、`search`、`embedding` 能力查询
- 聊天、长文本、图片、视频、语音、搜索六类任务的默认/备用模型规则创建、查询和更新
- Model Router 优先读取启用规则；默认 Provider 停用时选择已配置备用模型，无规则时使用稳定目录匹配
- Provider/Model 测试状态当前固定为 `not_tested`，不伪造真实连通性结果
- API Key 安全存储端口占位、接口密钥输入拒绝和 Base URL 凭据检查；当前端口明确不支持写入
- Permission 创建、单项/条件查询、更新和可追溯删除
- 十类权限资源、五档权限等级和八种基础操作
- 默认拒绝的 Permission Checker 三态判断
- `allow_once` 首次判断后原子消费；权限创建、变化和撤销分别与 `permission_created`、`permission_changed`、`permission_revoked` 事件同事务提交
- Security 统一检查入口和 `low`、`medium`、`high`、`critical` 四级风险判断
- Security Policy 按用户、资源类型、动作和风险精确匹配，支持 `always_allow`、`session_allow`、`always_confirm`、`deny`、`deny_without_confirm`
- 用户安全偏好支持默认安全等级、高风险策略、低/中风险自动确认范围和禁止范围
- Permission → Security Policy → Confirmation 固定执行顺序；策略只能收紧 Permission，高风险/极高风险始终逐次确认
- `session_allow` 仅在用户明确确认后创建精确作用域、30 分钟的开发期会话授权；安全会话 ID 不承担认证
- API Key、身份、支付、私密记录和 AI Private Domain 五类敏感数据分类元数据
- `not_required`、`every_time`、`user_defined` 三种确认要求
- 绑定完整作用域、Permission 快照与策略指纹，五分钟过期且批准后单次消费的 Confirmation
- 只追加、最小脱敏、与 Event 分离的 AuditLog
- Permission/APIProvider 变更审计及用户范围内的审计只读查询
- 安全预检不提前消费 `allow_once`，确认满足后才完成单次消费
- Tool Registry 保存名称、说明、类型、输入/输出定义、启停状态和 Permission 操作要求
- MCP Registry 保存服务地址与能力说明，但连接状态固定为 `not_connected`，不创建 MCP 客户端
- Skill Registry 保存说明、适用场景与版本；Plugin Registry 保存版本和依赖，但不安装、更新或加载插件代码
- Capability Service 按主体统一查询 Tool、MCP、Skill 与 Plugin，返回分类、权限预览、可选状态和 Tool 最近使用记录
- Tool 执行准备串联 Permission 与 Security；只记录 `ready`、`confirmation_required` 或 `denied`，执行状态固定为 `not_executed`
- Tool 使用记录保存主体、权限/安全决策、结果摘要和零外部调用消耗信息，不接收工具输入或输出正文
- Device Registry 保存手机、手表、空调、扫地机器人、洗衣机、摄像头和通用家电七类设备的用户归属、品牌、名称、启停状态与能力列表
- Device Capability 支持 `view_status`、`power`、`adjust_parameter`、`get_data`，并分别映射 `read` 或 `control` Permission 操作
- Xiaomi、Midea、Apple、Android 和 Generic Adapter 只提供统一未来契约描述，全部固定为 `not_implemented`、不连接、不控制、不调用厂商 API
- 设备授权入口创建精确 Device Permission，并同时记录 `permission_created`、`device_changed` 与最小 AuditLog
- 设备操作准备按 Device 状态、Permission、Security 与 Confirmation 处理；`device_control` 固定进入极高风险确认，执行状态始终为 `not_executed`
- Device Event 记录连接注册、授权变化、注册状态变化和操作请求；所有事件均明确 `not_connected` / `not_executed`
- 设备操作日志保存用户、主体、设备、能力、动作、时间、权限/安全结果、Event 与 AuditLog 引用，不保存控制参数或设备数据
- Wake Framework 保存 `voice`、`desktop`、`schedule`、`event` 四类触发规则、启停状态、结构化触发条件和应用内用户授权；麦克风与系统唤醒始终标记未连接
- 主动提示规则保存触发 Event、紧急/重要/普通/静默优先级和确认要求；准备记录固定 `not_delivered` / `not_performed`
- Token Budget 按用户/主体保存每日与会话预算及 `block`、`require_confirmation`、`defer` 超额策略
- Token 使用记录只接收显式上报元数据，标记平台未调用模型、未计费；预算检查不会预留或消耗 Token
- AI 后台策略保存 `idle` / `active`、后台开关、每小时限制、允许的 Wake 类型和安静时段，不启动调度器
- Wake、主动提示和需确认的 Token 超额准备复用 `proactive_interaction` Permission、Security Policy、Confirmation 与 AuditLog
- Export Schema 版本登记支持 `full`、`selected`、`migration` 三类导出和十二类稳定数据范围
- 导出记录按用户/主体保存 Schema 版本、创建时间、范围、敏感分类、归属/字段/外键检查及最终安全准备结果
- 导出准备使用精确 `data_export:export` Permission，并由 Security Policy 与高风险逐次 Confirmation 审核
- 机器人与其他载体迁移只提供未配置契约和 Schema 兼容准备，固定不连接、不传输、不执行；未来真实执行必须重新检查安全
- 基础服务信息与健康检查
- 所有 JSON 响应统一包含 `success`、`data`、`error` 和 `timestamp`
- 前端独立 API 客户端、Vite 同源代理和非阻塞启动健康握手
- `pnpm test` 当前 49/49 通过，覆盖启动、API 契约、数据导出/迁移准备、主动交互/Token 控制、User Space、当前助手、五类数据边界、生活数据、模型路由、能力/设备注册、权限/策略/安全执行准备、AI 私域版本与隔离、全局设定、摘要来源、上下文装配、迁移升级、事务回滚和持久化

本阶段只新增导出 Schema、完整性预检、安全准备记录和未来载体契约。`ready` 不代表已导出：接口不返回业务正文、不生成文件、不连接外部存储或机器人、不执行真实迁移。前端 `src`、页面与 mock 未修改。

## 运行要求

- Node.js `>=22.5.0`
- pnpm `11.x`

当前使用 Node.js 内置 `node:sqlite`。在 Node.js 22 中该模块仍会显示实验性警告，因此只作为开发环境方案，正式数据库需要后续 ADR 和适配器。

## 快速开始

```bash
cd backend
pnpm install
pnpm start
```

默认监听 `http://127.0.0.1:8787`，默认数据库文件为 `backend/data/vio-live.dev.sqlite`。数据库运行文件已被 Git 忽略。

开发监听：

```bash
pnpm dev
```

测试：

```bash
pnpm test
```

## 前后端本地联调

先在 `backend/` 启动后端，再在仓库根目录启动前端：

```bash
cd backend
pnpm dev
```

```bash
pnpm dev
```

Vite 将 `/api` 和 `/health` 同源代理到默认的 `http://127.0.0.1:8787`。如需调整开发代理目标，可设置无秘密的 `VITE_BACKEND_PROXY_TARGET`。后端不开放通配 CORS。

前端启动入口会执行一次非阻塞 `/health` 请求；后端不可用时，现有 mock 页面仍可打开。完整接口契约见 [`docs/API.md`](docs/API.md)。

## 配置

| 环境变量 | 默认值 | 作用 |
| --- | --- | --- |
| `VIO_BACKEND_HOST` | `127.0.0.1` | HTTP 监听地址 |
| `VIO_BACKEND_PORT` | `8787` | HTTP 监听端口；测试使用 `0` 分配临时端口 |
| `VIO_BACKEND_DB_PATH` | `backend/data/vio-live.dev.sqlite` | 开发数据库路径 |

完整说明见 [`config/README.md`](config/README.md)。

## 当前路由

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/` | 返回服务名称、版本和运行状态 |
| `GET` | `/health` | 检查服务与开发数据库 |
| `POST` | `/api/v1/users` | 创建基础用户 |
| `GET` | `/api/v1/users/:userId` | 查询用户 |
| `GET` | `/api/v1/users/current` | 使用 `x-vio-user-id` 读取开发期当前用户；不是认证 |
| `GET` | `/api/v1/users/:userId/user-space` | 读取一对一 User Space、开发期身份状态和当前助手 ID |
| `GET` | `/api/v1/users/:userId/user-space/assistants` | 查询用户空间内的助手列表和当前标记 |
| `GET` / `PATCH` | `/api/v1/users/:userId/user-space/current-assistant` | 读取或切换当前助手；只能选择本用户的活动助手 |
| `GET` | `/api/v1/data-access-boundaries` | 查询用户、AI、设备、生活和事件资源的隔离规则元数据 |
| `POST` | `/api/v1/users/:userId/data-access-checks` | 先验证资源复合归属，再按规则进入 Permission 与 Security Policy；不执行资源 |
| `POST` | `/api/v1/users/:userId/subjects` | 为指定用户创建 AI 主体 |
| `GET` | `/api/v1/users/:userId/subjects` | 查询该用户的主体列表 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId` | 按用户和主体双重归属查询主体 |
| `PATCH` | `/api/v1/users/:userId/subjects/:subjectId` | 更新名字、头像引用或基础设定并记录事件 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/global-settings` | 读取 AI 助手长期全局设定 |
| `PATCH` | `/api/v1/users/:userId/subjects/:subjectId/global-settings` | 局部更新长期全局设定并记录事件 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/dashboard` | 聚合用户、主体和基础状态 |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/conversations` | 创建属于当前用户和主体的 Conversation |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/conversations` | 按最近活动时间查询 Conversation 列表 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId` | 按复合归属查询 Conversation |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/messages` | 创建 Message 和 `original` 初始版本 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/messages` | 按 `sequenceNumber` 查询当前消息投影 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/messages/:messageId` | 查询单条 Message 当前版本投影 |
| `PATCH` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/messages/:messageId` | 使用 `baseVersionId` 为用户消息追加编辑版本 |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/messages/:messageId/regenerations` | 使用显式正文为主体消息追加重生成记录，不调用 AI |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/messages/:messageId/versions` | 查询消息的全部版本历史 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/messages/:messageId/versions/:messageVersionId` | 查询单个消息版本 |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/summaries` | 保存带来源引用的不可变会话摘要 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/summaries` | 查询该会话的摘要版本 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/summaries/:summaryId` | 查询摘要及来源引用 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/cross-window-summaries` | 查询同一主体其他窗口的最新摘要 |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/state-updates` | 保存可追溯的主体状态更新 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/state-updates` | 查询主体状态版本历史 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/state-updates/:subjectStateId` | 查询单个主体状态版本 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/state` | 查询当前主体状态；尚无状态时返回 `null` |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/conversations/:conversationId/context` | 装配只读上下文投影，不调用模型或外部服务 |
| `POST` | `/api/v1/users/:userId/subjects/:assistantId/private-spaces` | 创建空 AI Private Space；用于先取得可授权的 `spaceId` |
| `POST` | `/api/v1/users/:userId/subjects/:assistantId/private-spaces/current/read` | 经 Permission 与 Security Policy 读取当前私域元数据 |
| `PATCH` | `/api/v1/users/:userId/subjects/:assistantId/private-spaces/:spaceId/status` | 经安全链更新私域启停状态 |
| `POST` | `/api/v1/users/:userId/subjects/:assistantId/private-spaces/:spaceId/contents` | 经安全链保存五类私域内容的首个不可变版本 |
| `POST` | `/api/v1/users/:userId/subjects/:assistantId/private-spaces/:spaceId/contents/query` | 经安全链查询当前私域内容版本 |
| `POST` / `PATCH` | `/api/v1/users/:userId/subjects/:assistantId/private-spaces/:spaceId/contents/:contentId/read` / `.../:contentId` | 经安全链读取或追加私域内容版本 |
| `POST` | `/api/v1/users/:userId/subjects/:assistantId/private-spaces/:spaceId/contents/:contentId/versions/query` | 经安全链查询不可变版本历史 |
| `POST` | `/api/v1/users/:userId/subjects/:assistantId/private-spaces/:spaceId/context-projections` | 生成独立私域 Context 数据投影，不调用模型或连续性引擎 |
| `POST` | `/api/v1/users/:userId/subjects/:assistantId/private-spaces/:spaceId/export-manifests` | 返回导出结构与版本清单预留，不生成文件或传输正文 |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/life/finance/records` | 经生活数据安全链新增收入或支出记录 |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/life/finance/records/query` | 按类型、分类和时间查询管账记录 |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/life/finance/statistics/categories` | 返回按收支、分类和币种分组的确定性统计 |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/life/finance/summaries/monthly` | 返回指定 UTC 月份的收支与预算汇总 |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/life/finance/budgets` | 按月份和分类新增或更新预算及提醒规则 |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/life/finance/budgets/query` | 查询主体范围预算 |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/life/calendar/entries` | 新增纪念日、生理期、亲密记录或普通事件 |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/life/calendar/entries/query` | 按类型和时间查询月历记录 |
| `PATCH` | `/api/v1/users/:userId/subjects/:subjectId/life/calendar/entries/:calendarEntryId` | 更新月历记录与提醒 |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/life/body/records` | 保存体重/三围及显式 AI 建议字段 |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/life/body/records/query` | 查询身体指标历史 |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/life/body/trends` | 返回指标时间序列与确定性首尾差值 |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/life/body/goals` | 新增或更新主体身体目标 |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/life/body/goals/read` | 读取当前身体目标 |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/life/memories` | 保存用户本地记忆及上下文/导出标记 |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/life/memories/query` | 按上下文与导出标记查询本地记忆 |
| `PATCH` | `/api/v1/users/:userId/subjects/:subjectId/life/memories/:memoryId` | 更新本地记忆上下文与导出标记 |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/life/memories/context-projections` | 读取已明确参与上下文的本地记忆，不调用模型 |
| `GET` | `/api/v1/data-export/schemas` | 查询当前三类 Export Schema 版本及十二类稳定范围定义 |
| `GET` | `/api/v1/data-export/migration-target-contracts` | 查询机器人/其他载体的未配置迁移契约，不建立连接 |
| `POST` / `GET` | `/api/v1/users/:userId/subjects/:subjectId/data-exports` | 创建导出预检记录或查询本主体导出记录，不返回业务正文 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/data-exports/:exportId` | 按复合归属查询单个导出记录、完整性结果和执行边界 |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/data-exports/:exportId/preparations` | 执行 Permission → Security Policy → Confirmation 导出准备，不生成文件 |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/data-exports/:exportId/migration-preparations` | 预留载体 Schema 契约，固定不连接、不传输、不执行迁移 |
| `POST` / `GET` | `/api/v1/users/:userId/subjects/:subjectId/wake-rules` | 创建或查询四类唤醒规则元数据，不接入麦克风或系统唤醒 |
| `PATCH` | `/api/v1/users/:userId/subjects/:subjectId/wake-rules/:wakeId` | 更新唤醒规则、用户授权或启停状态 |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/wake-rules/:wakeId/preparations` | 执行后台策略、Permission 与 Security 准备检查，不真实唤醒 |
| `POST` / `GET` | `/api/v1/users/:userId/subjects/:subjectId/proactive-prompt-rules` | 创建或查询主动提示规则、优先级与触发事件 |
| `PATCH` | `/api/v1/users/:userId/subjects/:subjectId/proactive-prompt-rules/:promptRuleId` | 更新主动提示规则元数据与启停状态 |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/proactive-prompt-rules/:promptRuleId/preparations` | 由既有 Event 准备主动提示并经过安全检查，不生成提示正文 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/proactive-prompt-records` | 查询主动提示准备、抑制或待确认记录 |
| `PUT` / `GET` | `/api/v1/users/:userId/subjects/:subjectId/token-budget` | 写入或读取每日、会话 Token 预算与超额策略 |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/token-budget/checks` | 计算预计用量并返回允许、延后、阻止或待确认，不调用模型 |
| `POST` / `GET` | `/api/v1/users/:userId/subjects/:subjectId/token-usage-records` | 保存或查询显式上报的 Token 消耗元数据，不计费 |
| `PUT` / `GET` | `/api/v1/users/:userId/subjects/:subjectId/background-policy` | 写入或读取助手 idle/active 与后台限制配置，不启动调度器 |
| `POST` | `/api/v1/users/:userId/events` | 为用户或其主体记录软件事件 |
| `GET` | `/api/v1/users/:userId/events` | 按主体、时间、类型、状态和数量筛选事件 |
| `GET` | `/api/v1/users/:userId/events/:eventId` | 按用户归属查询单个事件 |
| `POST` | `/api/v1/users/:userId/api-providers` | 创建模型服务商配置 |
| `GET` | `/api/v1/users/:userId/api-providers` | 查询用户的 Provider 列表 |
| `GET` | `/api/v1/users/:userId/api-providers/:providerId` | 按用户归属查询 Provider |
| `PATCH` | `/api/v1/users/:userId/api-providers/:providerId/status` | 更新 Provider 启停状态 |
| `POST` | `/api/v1/users/:userId/api-providers/:providerId/models` | 为 Provider 注册模型 |
| `GET` | `/api/v1/users/:userId/models?capability=chat` | 按能力查询模型目录 |
| `GET` | `/api/v1/users/:userId/models/:modelId` | 按用户归属查询模型 |
| `POST` | `/api/v1/users/:userId/model-routing-rules` | 创建任务默认/备用模型规则 |
| `GET` | `/api/v1/users/:userId/model-routing-rules` | 查询用户的模型路由规则 |
| `GET` | `/api/v1/users/:userId/model-routing-rules/:taskType` | 查询指定任务规则 |
| `PATCH` | `/api/v1/users/:userId/model-routing-rules/:taskType` | 更新规则模型或启停状态 |
| `POST` | `/api/v1/users/:userId/model-router/select` | 按任务类型返回规则匹配模型，不执行调用 |
| `POST` / `GET` | `/api/v1/users/:userId/tools` | 创建或查询 Tool Registry 条目 |
| `GET` | `/api/v1/users/:userId/tools/:toolId` | 按用户归属查询 Tool 条目 |
| `PATCH` | `/api/v1/users/:userId/tools/:toolId/status` | 更新 Tool 注册启停状态，不执行 Tool |
| `POST` / `GET` | `/api/v1/users/:userId/mcp-registrations` | 创建或查询 MCP Registry 条目 |
| `GET` | `/api/v1/users/:userId/mcp-registrations/:mcpId` | 按用户归属查询 MCP 条目；连接状态固定未连接 |
| `PATCH` | `/api/v1/users/:userId/mcp-registrations/:mcpId/status` | 更新 MCP 注册启停状态，不建立连接 |
| `POST` / `GET` | `/api/v1/users/:userId/skills` | 创建或查询 Skill Registry 条目 |
| `GET` | `/api/v1/users/:userId/skills/:skillId` | 按用户归属查询 Skill 条目 |
| `PATCH` | `/api/v1/users/:userId/skills/:skillId/status` | 更新 Skill 注册启停状态，不执行 Skill |
| `POST` / `GET` | `/api/v1/users/:userId/plugins` | 创建或查询 Plugin Registry 元数据 |
| `GET` | `/api/v1/users/:userId/plugins/:pluginId` | 按用户归属查询 Plugin 条目；安装状态固定未安装 |
| `PATCH` | `/api/v1/users/:userId/plugins/:pluginId/status` | 更新 Plugin 注册启停状态，不安装或加载插件 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/capabilities` | 按主体统一查询能力、分类、Permission 状态与最近使用 |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/tools/:toolId/execution-preparations` | 执行 Permission → Security 准备并记录未执行结果 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/tool-usage-records` | 查询主体的 Tool 使用准备记录 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/tool-usage-records/:toolUsageId` | 查询单条 Tool 使用准备记录 |
| `GET` | `/api/v1/device-adapters` | 查询 Xiaomi/Midea/Apple/Android/Generic 未来 Adapter 契约；全部未实现 |
| `POST` / `GET` | `/api/v1/users/:userId/devices` | 创建或按类型、品牌、状态查询 Device Registry |
| `GET` | `/api/v1/users/:userId/devices/:deviceId` | 按用户归属查询设备、能力与未连接 Adapter 投影 |
| `PATCH` | `/api/v1/users/:userId/devices/:deviceId/status` | 更新设备注册启停状态，不改变真实连接状态 |
| `POST` | `/api/v1/users/:userId/devices/:deviceId/authorizations` | 为主体和设备能力创建精确 Permission 并记录设备授权事件 |
| `POST` | `/api/v1/users/:userId/subjects/:subjectId/devices/:deviceId/operation-preparations` | 执行 Device Permission → Security → Confirmation 准备，不控制设备 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/device-operation-logs` | 查询主体的设备操作准备日志 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId/device-operation-logs/:deviceOperationLogId` | 查询单条设备操作准备日志 |
| `POST` | `/api/v1/users/:userId/permissions` | 创建主体范围的权限规则并记录事件 |
| `GET` | `/api/v1/users/:userId/permissions` | 按主体、资源、操作或状态查询规则 |
| `GET` | `/api/v1/users/:userId/permissions/:permissionId` | 按用户归属查询单个规则 |
| `PATCH` | `/api/v1/users/:userId/permissions/:permissionId` | 更新权限等级或活动状态并记录事件 |
| `DELETE` | `/api/v1/users/:userId/permissions/:permissionId` | 将规则标记为已删除并记录事件 |
| `POST` | `/api/v1/users/:userId/permission-checks` | 按主体、资源和操作返回 `allow`、`ask` 或 `deny` |
| `GET` | `/api/v1/security/sensitive-data-categories` | 查询五类敏感数据分类元数据，不返回敏感正文 |
| `POST` | `/api/v1/users/:userId/security-checks` | 按 Permission → Policy → Confirmation 返回安全资格，不执行资源 |
| `GET` / `PATCH` | `/api/v1/users/:userId/security-preferences` | 读取或局部更新用户安全偏好 |
| `POST` / `GET` | `/api/v1/users/:userId/security-policies` | 创建或筛选用户安全策略 |
| `GET` / `PATCH` / `DELETE` | `/api/v1/users/:userId/security-policies/:policyId` | 查询、更新或可追溯删除安全策略 |
| `GET` | `/api/v1/users/:userId/audit-logs` | 按主体、操作、资源、风险和结果查询审计记录 |
| `GET` | `/api/v1/users/:userId/audit-logs/:auditLogId` | 按用户归属查询单条审计记录 |
| `GET` | `/api/v1/users/:userId/confirmations/:confirmationId` | 查询本用户的具体操作确认 |
| `PATCH` | `/api/v1/users/:userId/confirmations/:confirmationId` | 批准或拒绝待确认操作；不执行资源 |

成功与失败响应均统一包含 `success`、`data`、`error` 和 UTC `timestamp`；列表可额外返回 `meta`。Conversation、Message 和 MessageVersion 路由逐层校验用户、主体、对话和消息归属，但这仍不是身份认证。当前路由只服务于开发闭环，不代表完整公开 API 已完成；真实认证加入前不能直接公开部署。

## 目录结构

```text
backend/
├─ config/                    # 配置说明
├─ data/                      # 被忽略的开发数据库运行目录
├─ docs/                      # ADR、开发日志和阶段路线
├─ migrations/               # 开发数据库顺序迁移
├─ scripts/                  # 工程脚本说明
├─ src/
│  ├─ core/                  # 错误、ID 和校验
│  ├─ http/                  # JSON 传输与基础路由
│  ├─ integrations/database/ # SQLite、迁移和仓储适配
│  ├─ integrations/migrations/ # 未配置的未来载体迁移契约
│  ├─ integrations/secrets/  # 未配置的安全密钥存储端口占位
│  ├─ modules/users/         # User 业务规则
│  ├─ modules/user-spaces/   # User Space、助手列表与当前助手
│  ├─ modules/data-isolation/ # 资源归属和访问边界编排
│  ├─ modules/subjects/      # Subject 业务规则
│  ├─ modules/assistant-global-settings/ # AI 助手长期全局设定
│  ├─ modules/assistant-private-spaces/ # AI 私域、内容版本与受控投影
│  ├─ modules/life-management/ # 管账、月历、身体管理与本地记忆
│  ├─ modules/dashboard/     # 现有 User/Subject 基础聚合
│  ├─ modules/conversations/ # 用户/主体范围的对话容器
│  ├─ modules/messages/      # 顺序消息与当前版本投影
│  ├─ modules/message-versions/ # 编辑/重生成的不可覆盖版本链
│  ├─ modules/conversation-summaries/ # 可追溯、不可变会话摘要
│  ├─ modules/subject-states/ # state_update 与当前状态指针
│  ├─ modules/contexts/       # 跨窗口只读上下文装配
│  ├─ modules/events/        # Event 类型、记录和查询规则
│  ├─ modules/api-providers/ # Provider 配置与安全边界
│  ├─ modules/models/        # Model 目录与能力标签
│  ├─ modules/model-routing-rules/ # 默认/备用模型路由规则
│  ├─ modules/model-router/  # 本地规则匹配，不调用模型
│  ├─ modules/data-exports/  # Export Schema、预检、记录与迁移契约
│  ├─ modules/proactive-interactions/ # Wake、主动提示、Token 与后台策略
│  ├─ modules/capability-registries/ # Tool/MCP/Skill/Plugin 注册元数据
│  ├─ modules/capabilities/  # 主体范围统一能力与权限投影
│  ├─ modules/tool-usage/    # Tool 安全准备与未执行使用记录
│  ├─ modules/devices/       # Device Registry、能力、Adapter 契约和操作准备
│  ├─ modules/permissions/   # 权限规则、五档语义与三态判断
│  ├─ modules/security-policies/ # 用户安全策略、偏好和短时会话授权
│  ├─ modules/security/      # 安全编排、风险识别和执行前资格
│  ├─ modules/sensitive-data/ # 敏感分类元数据，不保存正文
│  ├─ modules/confirmations/ # 具体操作确认与防重放
│  ├─ modules/audit-logs/    # 最小、只追加安全审计
│  ├─ app.js                 # 依赖装配和服务生命周期
│  ├─ config.js              # 配置加载
│  └─ server.js              # 后端启动入口
├─ test-support/             # 测试辅助代码
├─ tests/                    # 闭环测试
├─ package.json
└─ pnpm-lock.yaml
```

## 数据库边界

- 当前物理结构由 `001`—`017` 顺序迁移维护；`017` 新增版本化 Export Schema、十二类范围定义与导出记录，并扩展 `data_export` 安全资源。
- User 创建与 User Space 建立在同一事务提交；首个 Subject 创建会在当前指针为空时原子选为当前助手。迁移为既有用户回填一个空间，并按最早活动 Subject 稳定选择当前助手。
- 当前助手只是用户空间内的导航选择，不改变 Subject、Assistant Global Settings、Assistant Private Space、SubjectState、对话、事件或生活数据的既有归属。
- 数据隔离仓储只使用预定义资源查询，并按资源要求组合 `user_id`、`assistant_id` 与资源 ID；不存在或错配组合统一按未找到处理，不通过先查全局 ID 再做应用层过滤。
- User/普通 AI 元数据与 Event 使用所有权校验；AI Private Space、Device 和生活数据在所有权校验后继续使用现有精确 Permission 与 Security Policy。隔离检查只返回 `ready`、`confirmation_required` 或 `denied`，所有执行状态固定为 `not_executed`。
- `Subject` 使用外键绑定所属 `User`，查询时仍显式同时校验 `owner_user_id` 与 `subject_id`。
- Subject 基础信息实际变化时与 `subject_updated` Event 同一 SQLite 事务提交；无变化更新不写库或发事件。
- `assistant_global_settings` 与 Subject 一对一绑定；名称和头像仍以 `subjects` 为唯一身份来源，人格、表达、关系、长期要求与禁止事项保存在独立设定表。新建 Subject 与默认设定原子提交，设定更新与最小 `subject_updated` Event 原子提交。
- 全局设定是可由用户明确修改的长期配置；SubjectState 是带来源、不可变追加的动态状态历史。更新任何全局设定都不会新增、切换或覆盖 SubjectState。
- `assistant_private_spaces` 与普通 User Space 表分离，每个用户/助手组合唯一；内容版本使用复合外键绑定相同用户、助手、Space 和 Content 父链。
- 私域内容更新只追加新版本，数据库触发器禁止直接修改或删除历史；通用 Context 不读取私域，独立投影必须通过 `private_domain` Permission 和高风险确认。
- 生活数据按 `user_id + subject_id` 复合归属保存；四个固定 `life_data` 资源范围分别保护财务、月历、身体和本地记忆。金额以整数分保存，身体 AI 建议仅为显式输入，本地记忆投影只读取用户标记参与 Context 的记录。
- Conversation、Message 和 MessageVersion 都保存 `user_id`、`subject_id`、`conversation_id` 复合归属；消息和版本不能跨用户、主体或对话引用。
- Message 使用对话内唯一且递增的 `sequence_number` 稳定排序，并以复合外键 `current_version_id` 投影当前正文与版本号。
- MessageVersion 正文由数据库触发器阻止覆盖；同一消息的版本号唯一，`parent_version_id` 只能引用同一用户、主体、对话和消息的版本。
- 编辑和重生成要求调用方提交当前 `baseVersionId`；不匹配时返回冲突，不追加陈旧版本。
- Conversation/Message/Version 写入、当前指针切换、最近活动时间和对应 Event 在同一事务提交。平台自动生成的四类对话事件只保存 ID、版本、发送者或状态等最小字段，不包含 Conversation `title` 或 Message `content`。
- ConversationSummary 使用会话内单调版本并禁止原地修改或直接删除；每个摘要至少引用一个同会话 MessageVersion 或同主体 Event，来源与摘要在同一事务提交。
- 跨窗口查询只返回同一用户与主体下、排除当前 Conversation 后每个其他 Conversation 的最新活动摘要，不扫描或复制全部历史消息。
- SubjectState 通过不可变版本和独立 `subject_state_heads` 当前指针保存；`state_update` 来源必须是同主体 MessageVersion、Event 或 ConversationSummary，未解决 Event 也使用复合外键约束。
- 主体事件使用 `(user_id, subject_id)` 组合外键，数据库层同时保证用户和主体归属。
- 事件按发生时间保存为 UTC ISO-8601，并为用户、主体、类型和状态查询建立索引。
- Provider 归属于用户并保存 Base URL、接口格式、启停状态和测试状态；Model 同时保存用户和 Provider 归属、费用说明与测试状态，能力标签使用独立关系表。
- `api_key_secret_ref` 当前受数据库约束只能为 `NULL`；安全存储端口返回 `writeSupported=false`，接口不接受 API Key，只返回“未配置”状态。
- `model_routing_rules` 按用户和六类任务唯一保存默认模型、可选备用模型与启停状态；复合外键阻止跨用户模型引用，模型必须具备对应任务能力。
- Router 优先使用启用规则的默认模型；默认 Provider 停用时选择已配置且 Provider 启用的备用模型。规则停用或不存在时才按稳定目录顺序回退，所有结果都标记模型与外部 API 未调用。
- Permission 同时保存用户、主体、资源类型、资源 ID、操作、权限等级和状态；复合外键阻止跨用户主体规则。
- 当前同一用户/主体/资源/操作只允许一个未终结规则；`allow_once` 使用后标记为 `consumed`，删除标记为 `deleted`。
- Permission 创建、变化和撤销与对应生命周期 Event 使用同一 SQLite 事务，任一写入失败时整体回滚。
- Security Policy 按用户、资源、动作和风险保存精确规则；用户偏好保存安全等级、高风险策略、自动确认范围与禁止范围。策略只能收紧 Permission，且 `high` / `critical` 平台底线不能被放宽。
- Confirmation 同时绑定用户、主体、资源、动作、风险、Permission 快照、安全策略版本、开发期安全会话和策略指纹；五分钟后过期，批准结果只能被匹配请求消费一次。
- `session_allow` 只在低/中风险确认通过后生成精确范围、30 分钟授权；策略更新或作用域、主体、安全会话变化都会使其失配。
- AuditLog 没有任意 payload、正文或详情 JSON 字段，也不提供客户端创建、更新或删除路由；资源引用必须使用平台不透明 ID，当前凭据形态拦截只是启发式规则，不是完整 DLP。
- Event 与 AuditLog 分离：前者记录软件变化，后者记录安全治理事实。
- `export_schema_versions`、`export_schema_types` 与 `export_schema_scopes` 固定保存 Schema 版本、三类导出类型及十二类范围；`data_export_records` 只保存选择、计数、完整性/安全结果和审计引用，不保存业务正文。
- 导出记录必须按 `(user_id, subject_id, export_id)` 复合查询；`payload_status=not_generated`、`file_status=not_created`、`external_storage_status=not_connected`、`migration_status=not_executed` 由数据库约束固定。
- `wake_rules`、`proactive_prompt_rules`、`token_budgets` 与 `assistant_background_policies` 均按用户/主体复合归属；提示记录绑定同用户触发 Event 和 Security AuditLog。
- `token_usage_records` 保存显式上报的输入/输出/总 Token、预算会话与可选 Model 引用；数据库同时约束 `model_call_status=not_performed_by_platform` 和 `billing_status=not_billed`，不冒充平台真实调用或计费。
- 内部嵌套写入加入同一最外层 SQLite 事务，保证安全确认、单次权限消费和审计结果一致。
- 四类能力注册表均按用户归属，名称在用户范围内唯一；注册状态默认 `disabled`。Tool、MCP 和 Skill 分别关联现有 Permission 的 `tool`、`mcp`、`skill` 资源类型，Plugin 当前只保存注册元数据，不扩张 Permission 枚举或形成安装权限。
- `tool_usage_records` 同时复合绑定用户、主体、Tool 和安全审计记录。当前数据库约束只允许 `execution_status=not_executed`，消费信息固定记录零外部调用、零 Token 和无计费结果。
- `device_registry` 与能力关系按用户归属，名称在用户范围内唯一且创建默认停用；不保存外部设备 ID、位置、凭据或真实状态。`adapter_type` 只是未来适配器分派元数据。
- `device_operation_logs` 复合绑定用户、主体、Device、AuditLog 和 `device_changed` Event；数据库约束只允许 `execution_status=not_executed`。设备授权当前通过现有 Permission 保存，不建立重复授权表。
- `basicSettings` 在开发 SQLite 中保存为 JSON 文本，业务层只接收普通 JSON 对象。
- SQL 和 `node:sqlite` 只存在于 `integrations/database` 与 `migrations`；业务服务只依赖仓储行为。
- 已执行迁移不得修改，后续结构通过新迁移演进。
- 正式数据库迁移需要新的数据库适配器和迁移计划，不能直接把开发文件当作生产方案。

## 系统边界

平台后端与 continuity-engine 保持平行。User Space 只承担账号数据根与当前助手选择，不合并助手数据。AI Assistant Global Settings、SubjectState、AI Private Space 与 User Space 生活数据保持独立语义和存储边界；切换当前助手不会复制或重写这些记录。通用 Context 不自动读取私域或本地记忆。数据导出只形成版本化范围、完整性预检、安全准备和未来载体契约，不返回正文、不生成文件、不连接存储/机器人、不执行迁移。主动交互也不判断唤醒音频、不生成提示正文、不运行后台任务或调用模型。真实登录、系统语音、模型、外部存储、机器人、支付/银行、健康设备和 continuity-engine 仍未实现。

稳定规划见 [`../docs/后端/README.md`](../docs/后端/README.md)，逻辑数据模型见 [`../docs/后端/数据库设计.md`](../docs/后端/数据库设计.md)，技术决策见 [`docs/ADR.md`](docs/ADR.md)。
