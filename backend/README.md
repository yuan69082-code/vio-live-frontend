# Vio Live 平台后端

## 当前状态

当前阶段为“平台后端 7｜对话与消息版本基础”。后端已经可以独立启动，并在统一 JSON 契约之上建立可追溯的 Conversation、Message 与 MessageVersion 闭环：

```text
React 启动 → Vite 同源代理 → 后端健康检查
API 请求 → 版本化路由 → 领域服务 → 开发数据库 → 统一响应
对话 → 顺序消息 → 当前版本指针 → 不可覆盖的版本历史 → 最小软件事件
```

已实现：

- Node.js 22 ESM 后端启动入口
- 环境变量配置管理
- 开发期 SQLite 数据库与顺序迁移
- User 创建和查询
- 开发期当前用户解析；显式标明不是认证或登录会话
- Subject 创建、列表、所属用户绑定、查询和基础信息更新
- Subject 实际更新与 `subject_updated` Event 同事务提交
- Dashboard 对现有 User/Subject 与基础可用状态的安全聚合
- Conversation 创建、列表和按用户/主体双重归属查询
- `user`、`subject`、`system` 三类 Message 创建及稳定 `sequenceNumber` 排序
- Message 当前版本投影与完整 MessageVersion 历史查询
- 用户消息编辑和主体消息重生成记录；`baseVersionId` 防止陈旧写覆盖当前版本
- `original`、`edited`、`regenerated` 三类不可覆盖消息版本及同消息父版本约束
- Event 创建、单项查询及按用户、主体、时间、类型和状态筛选
- 九类基础软件事件和事件数据秘密字段拦截
- APIProvider 创建、列表/单项查询和启停状态更新
- Model 创建、单项查询及按 `chat`、`vision`、`image`、`video`、`embedding` 能力查询
- 仅针对启用 Provider 的确定性 Model Router 规则匹配
- API Key 安全占位结构、接口密钥输入拒绝和 Base URL 凭据检查
- Permission 创建、单项/条件查询、更新和可追溯删除
- 七类权限资源、五档权限等级和八种基础操作
- 默认拒绝的 Permission Checker 三态判断
- `allow_once` 首次判断后原子消费，权限写入与 `permission_changed` 事件同事务提交
- Security 统一检查入口和 `low`、`medium`、`high`、`critical` 四级风险判断
- API Key、身份、支付、私密记录和 AI Private Domain 五类敏感数据分类元数据
- `not_required`、`every_time`、`user_defined` 三种确认要求
- 绑定完整作用域、Permission 快照与策略指纹，五分钟过期且批准后单次消费的 Confirmation
- 只追加、最小脱敏、与 Event 分离的 AuditLog
- Permission/APIProvider 变更审计及用户范围内的审计只读查询
- 安全预检不提前消费 `allow_once`，确认满足后才完成单次消费
- 基础服务信息与健康检查
- 所有 JSON 响应统一包含 `success`、`data`、`error` 和 `timestamp`
- 前端独立 API 客户端、Vite 同源代理和非阻塞启动健康握手
- `pnpm test` 当前 17/17 通过，覆盖启动、API 契约、版本不可变、陈旧写防护、事务回滚、持久化、冲突和跨用户/主体/对话隔离

主体消息和“重生成”版本的正文都由开发调用方显式提交；后端只验证、保存和切换当前版本，不调用 AI、模型 Router 或供应商 API。本阶段没有实现分支、消息删除、窗口重置、上下文装配、连续性引擎、MCP/Skill/Tool 实际调用，也没有实现真实登录、正式数据库、真实 API Key、真实支付、真实设备、手机权限或 AI 私域业务。前端页面与 mock 未修改，现有对话页没有迁移到这些真实接口。

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
| `POST` | `/api/v1/users/:userId/subjects` | 为指定用户创建 AI 主体 |
| `GET` | `/api/v1/users/:userId/subjects` | 查询该用户的主体列表 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId` | 按用户和主体双重归属查询主体 |
| `PATCH` | `/api/v1/users/:userId/subjects/:subjectId` | 更新名字、头像引用或基础设定并记录事件 |
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
| `POST` | `/api/v1/users/:userId/model-router/select` | 按任务类型返回规则匹配模型，不执行调用 |
| `POST` | `/api/v1/users/:userId/permissions` | 创建主体范围的权限规则并记录事件 |
| `GET` | `/api/v1/users/:userId/permissions` | 按主体、资源、操作或状态查询规则 |
| `GET` | `/api/v1/users/:userId/permissions/:permissionId` | 按用户归属查询单个规则 |
| `PATCH` | `/api/v1/users/:userId/permissions/:permissionId` | 更新权限等级或活动状态并记录事件 |
| `DELETE` | `/api/v1/users/:userId/permissions/:permissionId` | 将规则标记为已删除并记录事件 |
| `POST` | `/api/v1/users/:userId/permission-checks` | 按主体、资源和操作返回 `allow`、`ask` 或 `deny` |
| `GET` | `/api/v1/security/sensitive-data-categories` | 查询五类敏感数据分类元数据，不返回敏感正文 |
| `POST` | `/api/v1/users/:userId/security-checks` | 按 Permission、风险和确认要求返回安全资格，不执行资源 |
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
│  ├─ modules/users/         # User 业务规则
│  ├─ modules/subjects/      # Subject 业务规则
│  ├─ modules/dashboard/     # 现有 User/Subject 基础聚合
│  ├─ modules/conversations/ # 用户/主体范围的对话容器
│  ├─ modules/messages/      # 顺序消息与当前版本投影
│  ├─ modules/message-versions/ # 编辑/重生成的不可覆盖版本链
│  ├─ modules/events/        # Event 类型、记录和查询规则
│  ├─ modules/api-providers/ # Provider 配置与安全边界
│  ├─ modules/models/        # Model 目录与能力标签
│  ├─ modules/model-router/  # 本地规则匹配，不调用模型
│  ├─ modules/permissions/   # 权限规则、五档语义与三态判断
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

- 当前物理结构包括 `schema_migrations`、`users`、`subjects`、`conversations`、`messages`、`message_versions`、`events`、`api_providers`、`models`、`model_capabilities`、`permissions`、`security_confirmations` 和 `audit_logs`。
- `Subject` 使用外键绑定所属 `User`，查询时仍显式同时校验 `owner_user_id` 与 `subject_id`。
- Subject 基础信息实际变化时与 `subject_updated` Event 同一 SQLite 事务提交；无变化更新不写库或发事件。
- Conversation、Message 和 MessageVersion 都保存 `user_id`、`subject_id`、`conversation_id` 复合归属；消息和版本不能跨用户、主体或对话引用。
- Message 使用对话内唯一且递增的 `sequence_number` 稳定排序，并以复合外键 `current_version_id` 投影当前正文与版本号。
- MessageVersion 正文由数据库触发器阻止覆盖；同一消息的版本号唯一，`parent_version_id` 只能引用同一用户、主体、对话和消息的版本。
- 编辑和重生成要求调用方提交当前 `baseVersionId`；不匹配时返回冲突，不追加陈旧版本。
- Conversation/Message/Version 写入、当前指针切换、最近活动时间和对应 Event 在同一事务提交。平台自动生成的四类对话事件只保存 ID、版本、发送者或状态等最小字段，不包含 Conversation `title` 或 Message `content`。
- 主体事件使用 `(user_id, subject_id)` 组合外键，数据库层同时保证用户和主体归属。
- 事件按发生时间保存为 UTC ISO-8601，并为用户、主体、类型和状态查询建立索引。
- Provider 归属于用户，Model 同时保存用户和 Provider 归属，能力标签使用独立关系表。
- `api_key_secret_ref` 当前受数据库约束只能为 `NULL`；接口不接受 API Key，只返回“未配置”状态。
- Router 只读取本地模型目录，从启用 Provider 中按稳定创建顺序返回首个能力匹配项。
- Permission 同时保存用户、主体、资源类型、资源 ID、操作、权限等级和状态；复合外键阻止跨用户主体规则。
- 当前同一用户/主体/资源/操作只允许一个未终结规则；`allow_once` 使用后标记为 `consumed`，删除标记为 `deleted`。
- Permission 变更与对应 Event 使用同一 SQLite 事务，任一写入失败时整体回滚。
- Confirmation 同时绑定用户、主体、资源、动作、风险、Permission 快照和策略指纹；五分钟后过期，批准结果只能被匹配请求消费一次。
- AuditLog 没有任意 payload、正文或详情 JSON 字段，也不提供客户端创建、更新或删除路由；资源引用必须使用平台不透明 ID，当前凭据形态拦截只是启发式规则，不是完整 DLP。
- Event 与 AuditLog 分离：前者记录软件变化，后者记录安全治理事实。
- 内部嵌套写入加入同一最外层 SQLite 事务，保证安全确认、单次权限消费和审计结果一致。
- `basicSettings` 在开发 SQLite 中保存为 JSON 文本，业务层只接收普通 JSON 对象。
- SQL 和 `node:sqlite` 只存在于 `integrations/database` 与 `migrations`；业务服务只依赖仓储行为。
- 已执行迁移不得修改，后续结构通过新迁移演进。
- 正式数据库迁移需要新的数据库适配器和迁移计划，不能直接把开发文件当作生产方案。

## 系统边界

平台后端与 continuity-engine 保持平行。Conversation/Message 只是平台持久化和版本记录，不装配上下文、不生成回复、不更新 SubjectState 或 Memory；主体消息正文由开发调用方提供。Dashboard 对尚未接入的连续性状态仍返回 `not_available`。Security 仍只返回执行资格，不连接支付、手机权限、MCP、Skill、Tool、设备或 AI 私域，也不改变 continuity-engine 或模型调用边界。分支、删除和窗口重置仍未实现。

稳定规划见 [`../docs/后端/README.md`](../docs/后端/README.md)，逻辑数据模型见 [`../docs/后端/数据库设计.md`](../docs/后端/数据库设计.md)，技术决策见 [`docs/ADR.md`](docs/ADR.md)。
