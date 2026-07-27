# 12｜API 与事件契约

## 状态

- 文档状态：基础契约已开始实现
- 实现状态：已建立健康检查、User/Subject、Event、Provider/Model、Permission、Security、Confirmation 和 AuditLog 基础；完整平台 API 未建立
- 当前限制：真实认证、授权、分页、完整契约、兼容治理和生成代码尚未实现

## 目标

建立前端、平台后端、连续性引擎、AI 模型和外部能力之间的稳定边界。接口变化不能依赖页面内部状态，也不能让前端直接持有数据库、密钥或设备厂商协议。

## 接口关系

### 前端与平台后端

前端通过平台接口处理：

- 登录与当前主体
- 工作台摘要和最近变化
- 会话、消息、版本和分支
- 连续性页面可见数据
- AI 私域目录、申请和开放结果
- 模型、MCP、Skill、插件和 Tool 状态
- 设备、权限和访问日志
- 生活管理数据
- 数据导出、备份、恢复和删除入口

### 平台后端与连续性引擎

平台后端传递主体、事件、消息、授权记忆和状态更新；连续性引擎返回当前状态、连续性约束和允许读取的相关内容。

平台接口不暴露连续性引擎内部算法或存储结构。

### 平台后端与模型服务

平台后端负责选择模型、装配上下文、发送本轮内容并接收 `reply` 与 `state_update`。模型服务不直接操作数据库、设备或用户权限。

### 平台后端与外部能力

平台后端负责适配、授权、调用和日志。MCP、Tool 和设备不能绕过平台权限层直接被前端或模型执行。

## 契约中的通用信息

不同接口按需要表达以下信息：

- 当前用户
- 当前智能体主体
- 数据或事件来源
- 创建或发生时间
- 当前版本或状态
- 权限与可见范围
- 与会话、消息、事件、设备或生活模块的关系

秘密密钥和不必要的敏感原文不作为普通接口返回值。

## 软件事件契约

当前实现使用以下事件名：

- `appearance_changed`
- `subject_updated`
- `permission_changed`
- `life_record_created`
- `device_changed`

事件创建体包含 `eventType`、`source`、`occurredAt`、`data`、`summary` 和可选 `subjectId`。服务生成 `eventId` 与 `recordedAt`，并将初始 `status` 设为 `pending`。事件数据不得包含明显的密钥、密码、验证码、Token、Secret 或完整证件号字段。

当前事件接口：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `POST` | `/api/v1/users/:userId/events` | 在指定用户范围创建事件 |
| `GET` | `/api/v1/users/:userId/events` | 查询该用户事件，可按 `subjectId`、`eventType`、`status`、`from`、`to` 和 `limit` 筛选 |
| `GET` | `/api/v1/users/:userId/events/:eventId` | 查询该用户范围内的单个事件 |

这些路由供未来连续性引擎读取和 AI 上下文装配使用，但当前没有连接消费者、连续性引擎或模型。能力变化和数据变化仍是规划范围，尚未成为当前接口接受的事件名。

## 每轮模型契约

当前已实现的模型配置与选择接口：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `POST` | `/api/v1/users/:userId/api-providers` | 创建不含真实 Key 的 Provider 配置 |
| `GET` | `/api/v1/users/:userId/api-providers` | 查询用户 Provider 列表 |
| `GET` | `/api/v1/users/:userId/api-providers/:providerId` | 查询单个 Provider |
| `PATCH` | `/api/v1/users/:userId/api-providers/:providerId/status` | 更新 `enabled`/`disabled` 状态 |
| `POST` | `/api/v1/users/:userId/api-providers/:providerId/models` | 在 Provider 下创建 Model |
| `GET` | `/api/v1/users/:userId/models?capability=...` | 按五类能力标签查询模型 |
| `GET` | `/api/v1/users/:userId/models/:modelId` | 查询单个 Model |
| `POST` | `/api/v1/users/:userId/model-router/select` | 根据 `taskType` 返回启用 Provider 下的规则匹配模型 |

Provider 响应只暴露 API Key 的 `not_configured` 状态，不接受或返回真实 Key、Token、Secret 或凭据引用。Router 响应只包含任务类型、选择规则和模型描述，不包含模型回复，也不产生外部请求。

以下每轮模型内容仍为后续真实接入契约：

上下文装配遵循以下逻辑顺序：系统安全规则、全局设定、主体状态、未解决事件、近期对话、相关长期记忆、用户本轮消息。

模型返回逻辑上包含：

- 给用户的回复
- 状态更新

状态更新至少覆盖当前情绪、强度、变化原因、未解决事件和下一轮连续性约束。

## 权限与错误原则

当前 Permission 接口：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `POST` | `/api/v1/users/:userId/permissions` | 创建主体、资源、操作范围的权限规则 |
| `GET` | `/api/v1/users/:userId/permissions` | 按主体、资源类型、资源 ID、操作或状态筛选规则 |
| `GET` | `/api/v1/users/:userId/permissions/:permissionId` | 查询单个权限规则 |
| `PATCH` | `/api/v1/users/:userId/permissions/:permissionId` | 更新权限等级或 `active`/`inactive` 状态 |
| `DELETE` | `/api/v1/users/:userId/permissions/:permissionId` | 将权限规则标记为 `deleted` |
| `POST` | `/api/v1/users/:userId/permission-checks` | 输入主体、资源与操作，返回 `allow`、`ask` 或 `deny` |

Checker 只进行完全匹配和平台判断，不执行资源动作。`allow_once` 在首次成功判断后转为 `consumed`；权限变更与 `permission_changed` 事件同事务提交。`canAsk` 只描述是否允许后续申请，不等于已经创建授权申请流程。

当前 Security、Confirmation 和 AuditLog 接口：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/api/v1/security/sensitive-data-categories` | 返回五类分类元数据，不返回敏感正文 |
| `POST` | `/api/v1/users/:userId/security-checks` | 按 Permission、风险和确认返回 `allow`、`confirm` 或 `deny` |
| `GET` | `/api/v1/users/:userId/confirmations/:confirmationId` | 查询用户范围内的具体操作确认 |
| `PATCH` | `/api/v1/users/:userId/confirmations/:confirmationId` | 批准或拒绝待确认记录，不执行资源 |
| `GET` | `/api/v1/users/:userId/audit-logs` | 按主体、操作、资源、风险、结果和数量筛选审计 |
| `GET` | `/api/v1/users/:userId/audit-logs/:auditLogId` | 查询用户范围内的单条审计 |

安全检查的 `operationType` 当前只允许：`general_access`、`permission_change`、`api_configuration_change`、`privacy_access_request`、`payment_operation`、`device_control`、`sensitive_data_access`、`data_deletion`。

确认决定请求体固定为 `{ "decision": "approve" }` 或 `{ "decision": "reject" }`。审计列表查询参数固定为 `subjectId`、`operationType`、`resourceType`、`result`、`riskLevel`、`limit`。

安全检查只接受 `subjectId`、`resourceType`、平台不透明 `resourceId`、`action`、`operationType`、`sensitiveDataCategories` 和可选 `confirmationId`，会拒绝额外字段和任意 payload。资源 ID 校验会启发式拦截常见凭据形态，但不等同于完整 DLP；正式接入资源时必须使用可信服务端资源注册表，不能把敏感值塞入 ID。中风险 `user_defined` 在正式服务端偏好完成前安全默认需要确认。响应包含 Permission 结果、风险原因、确认状态和审计 ID；`preflightPassed` 仅表示预检通过，`executionAllowed` 固定为 `false`，`executionStatus` 固定为 `not_executed`，不会产生支付、设备、私域或外部调用。

AuditLog 没有客户端写入、更新或删除接口；Confirmation 批准结果绑定 Permission 快照、完整作用域和安全策略指纹，五分钟后过期，并在安全检查中单次消费。错范围、过期和重放尝试返回拒绝并生成最小审计。

- 未登录、主体不匹配或权限不足时不能返回受保护数据。
- 外部能力不可用时，应明确失败，不伪造成功结果。
- 危险操作需要具体确认，不能只依赖长期授权。
- 接口错误不得泄露密钥、密码、内部凭据或其他用户数据。
- 重试、冲突处理和接口版本规则需要在实现前补充，但本文件暂不指定方案。

## 变更管理

- 正式接口变更需要同步更新本文件、工程日志和更新记录。
- 影响架构边界、权限或数据模型的变更需要新增 ADR。
- 前端模拟数据结构不能直接被视为最终接口契约。
- 未经规划确认，不新增总规划之外的接口能力。

## 第一版验收方向

- 手机前端只通过平台接口访问受控数据。
- 用户和主体信息贯穿需要隔离的请求。
- 连续性、模型和外部能力各自保持独立边界。
- 权限失败、服务不可用和危险操作具有明确结果。
- 接口不会返回密钥或其他用户数据。
