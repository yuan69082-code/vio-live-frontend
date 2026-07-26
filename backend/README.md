# Vio Live 平台后端

## 当前状态

当前阶段为“平台后端 4｜权限系统基础”。后端已经可以独立启动，并完成权限规则、三态判断和事件联动闭环：

```text
创建用户/主体 → 创建权限规则 → 按资源与操作判断 → 返回允许/询问/拒绝 → 记录权限变化事件
```

已实现：

- Node.js 22 ESM 后端启动入口
- 环境变量配置管理
- 开发期 SQLite 数据库与顺序迁移
- User 创建和查询
- Subject 创建、所属用户绑定和查询
- Event 创建、单项查询及按用户、主体、时间、类型和状态筛选
- 五类基础软件事件和事件数据秘密字段拦截
- APIProvider 创建、列表/单项查询和启停状态更新
- Model 创建、单项查询及按 `chat`、`vision`、`image`、`video`、`embedding` 能力查询
- 仅针对启用 Provider 的确定性 Model Router 规则匹配
- API Key 安全占位结构、接口密钥输入拒绝和 Base URL 凭据检查
- Permission 创建、单项/条件查询、更新和可追溯删除
- 七类权限资源、五档权限等级和八种基础操作
- 默认拒绝的 Permission Checker 三态判断
- `allow_once` 首次判断后原子消费，权限写入与 `permission_changed` 事件同事务提交
- 基础服务信息与健康检查
- 版本化 JSON 基础路由和统一错误结果
- 启动、持久化、冲突和跨用户隔离测试

本阶段没有实现真实登录、正式数据库、真实 API Key、模型调用、供应商 SDK、事件消费器、连续性引擎、MCP/Skill/Tool 实际调用、真实设备、手机权限或 AI 私域业务。

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
| `POST` | `/api/v1/users/:userId/subjects` | 为指定用户创建 AI 主体 |
| `GET` | `/api/v1/users/:userId/subjects/:subjectId` | 按用户和主体双重归属查询主体 |
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

当前路由只服务于本阶段闭环，不代表完整公开 API 已完成。真实认证加入前，不能将该服务直接公开部署。

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
│  ├─ modules/events/        # Event 类型、记录和查询规则
│  ├─ modules/api-providers/ # Provider 配置与安全边界
│  ├─ modules/models/        # Model 目录与能力标签
│  ├─ modules/model-router/  # 本地规则匹配，不调用模型
│  ├─ modules/permissions/   # 权限规则、五档语义与三态判断
│  ├─ app.js                 # 依赖装配和服务生命周期
│  ├─ config.js              # 配置加载
│  └─ server.js              # 后端启动入口
├─ test-support/             # 测试辅助代码
├─ tests/                    # 闭环测试
├─ package.json
└─ pnpm-lock.yaml
```

## 数据库边界

- 当前物理结构包括 `schema_migrations`、`users`、`subjects`、`events`、`api_providers`、`models`、`model_capabilities` 和 `permissions`。
- `Subject` 使用外键绑定所属 `User`，查询时仍显式同时校验 `owner_user_id` 与 `subject_id`。
- 主体事件使用 `(user_id, subject_id)` 组合外键，数据库层同时保证用户和主体归属。
- 事件按发生时间保存为 UTC ISO-8601，并为用户、主体、类型和状态查询建立索引。
- Provider 归属于用户，Model 同时保存用户和 Provider 归属，能力标签使用独立关系表。
- `api_key_secret_ref` 当前受数据库约束只能为 `NULL`；接口不接受 API Key，只返回“未配置”状态。
- Router 只读取本地模型目录，从启用 Provider 中按稳定创建顺序返回首个能力匹配项。
- Permission 同时保存用户、主体、资源类型、资源 ID、操作、权限等级和状态；复合外键阻止跨用户主体规则。
- 当前同一用户/主体/资源/操作只允许一个未终结规则；`allow_once` 使用后标记为 `consumed`，删除标记为 `deleted`。
- Permission 变更与对应 Event 使用同一 SQLite 事务，任一写入失败时整体回滚。
- `basicSettings` 在开发 SQLite 中保存为 JSON 文本，业务层只接收普通 JSON 对象。
- SQL 和 `node:sqlite` 只存在于 `integrations/database` 与 `migrations`；业务服务只依赖仓储行为。
- 已执行迁移不得修改，后续结构通过新迁移演进。
- 正式数据库迁移需要新的数据库适配器和迁移计划，不能直接把开发文件当作生产方案。

## 系统边界

平台后端与 continuity-engine 保持平行。本阶段 Permission 只管理平台内规则和判断结果，不执行受控资源，不连接手机权限、MCP、Skill、Tool 或设备，也不改变 continuity-engine 或模型调用边界。

稳定规划见 [`../docs/后端/README.md`](../docs/后端/README.md)，逻辑数据模型见 [`../docs/后端/数据库设计.md`](../docs/后端/数据库设计.md)，技术决策见 [`docs/ADR.md`](docs/ADR.md)。
