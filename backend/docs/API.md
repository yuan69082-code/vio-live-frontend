# Vio Live 后端 API 说明

## 状态与边界

- 当前阶段：平台后端 6｜基础 API 层与前后端连接
- 后端版本：`0.6.0`
- 业务前缀：`/api/v1`
- 开发服务默认地址：`http://127.0.0.1:8787`
- 当前没有真实登录、会话或认证，所有用户/主体归属检查仍是开发期请求范围，不能直接公开部署。

前端开发服务器通过同源 `/api` 与 `/health` 代理访问后端，不在后端开放通配 CORS。前端页面仍使用原有 mock 数据；当前真实连接只在独立 API 客户端和应用启动健康握手中建立。

## 统一返回结构

所有 JSON 响应至少包含以下四个字段：

```json
{
  "success": true,
  "data": {},
  "error": null,
  "timestamp": "2026-07-27T00:00:00.000Z"
}
```

列表接口可额外包含：

```json
{
  "meta": {
    "count": 2
  }
}
```

失败响应使用：

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "validation_error",
    "message": "Request data is invalid.",
    "requestId": "00000000-0000-0000-0000-000000000000",
    "details": {}
  },
  "timestamp": "2026-07-27T00:00:00.000Z"
}
```

- `timestamp` 为后端生成的 UTC ISO-8601 时间。
- `details` 只在存在安全的结构化错误详情时返回。
- 响应头同时返回 `x-request-id`；错误体内的 `requestId` 与其一致。
- 创建成功使用 `201` 并返回 `Location`；一般查询/更新使用 `200`。
- 当前错误状态包括 `400`、`404`、`409`、`413`、`415` 和 `500`。

## 请求规则

- 有请求体的接口必须使用 `Content-Type: application/json`。
- 请求体必须是 JSON 对象，最大 1 MiB。
- ID 是平台不透明字符串；路径参数必须进行 URL 编码。
- `basicSettings` 当前接受普通 JSON 对象，最大 32 KiB；它是阶段性基础结构，不代表前端 mock 已成为稳定业务模型。
- 不得在请求、资源 ID、日志或文档中放入 API Key、密码、Token 或其他秘密值。

## 服务接口

### 健康检查

| 方法 | 路径 | 参数 | 返回 `data` |
| --- | --- | --- | --- |
| `GET` | `/` | 无 | `service`、`version`、`status` |
| `GET` | `/health` | 无 | `status`、`service`、`version`、`database` |

`/health` 只表示服务和开发数据库可用，不表示用户已经登录或认证。

## User API

### 创建用户

`POST /api/v1/users`

请求体：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `email` | 是 | 基础邮箱，按小写归一化；当前不是验证码登录 |
| `displayName` | 否 | 显示名称，最多 80 字符 |

返回用户的 `userId`、`email`、`displayName`、`status`、`createdAt` 和 `updatedAt`。重复邮箱返回 `409 conflict`。

### 查询用户

`GET /api/v1/users/:userId`

路径参数：`userId`。返回该 ID 对应的用户；不存在时返回 `404`。

### 获取开发期当前用户

`GET /api/v1/users/current`

请求头：

| 请求头 | 必填 | 说明 |
| --- | --- | --- |
| `x-vio-user-id` | 是 | 前端开发上下文中的用户 ID |

该请求头只是可替换的开发期用户选择，不是身份凭证、登录会话或授权。服务不会默认读取数据库中的第一位或最新用户。真实认证接入后应替换此解析方式。

## Subject API

### 创建 AI 主体

`POST /api/v1/users/:userId/subjects`

请求体：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `name` | 是 | 主体名称，最多 80 字符 |
| `avatarRef` | 否 | 头像资源引用；不是文件上传接口 |
| `basicSettings` | 否 | 基础设定 JSON 对象 |

### 查询主体列表

`GET /api/v1/users/:userId/subjects`

返回该用户的主体数组和 `meta.count`，按创建时间、主体 ID 稳定排序。

### 查询单个主体

`GET /api/v1/users/:userId/subjects/:subjectId`

同时校验用户与主体归属；跨用户读取与不存在的主体统一返回 `404`。

### 更新主体基础信息

`PATCH /api/v1/users/:userId/subjects/:subjectId`

请求体至少包含以下一个字段，且不接受其他字段：

| 字段 | 规则 |
| --- | --- |
| `name` | 非空字符串，最多 80 字符 |
| `avatarRef` | 字符串；传 `null` 或空字符串可清除头像引用 |
| `basicSettings` | 普通 JSON 对象，使用整对象替换，不做隐式深层合并 |

实际发生变化时，主体更新与一个只含 `changedFields` 的 `subject_updated` Event 在同一事务提交；无变化请求不更新时间，也不重复产生事件。

## Dashboard API

`GET /api/v1/users/:userId/subjects/:subjectId/dashboard`

不接受请求体。返回：

```json
{
  "user": {},
  "subject": {},
  "basicStatus": {
    "userStatus": "active",
    "subjectStatus": "active",
    "ready": true,
    "continuityStatus": "not_available"
  }
}
```

- `ready` 只表示当前用户和主体均为 `active`。
- `continuityStatus=not_available` 明确表示 SubjectState 与连续性引擎尚未接入。
- 本接口不会返回工作台 mock、设备状态、待办、提醒或模型结果，也不会调用外部服务。

## 前端连接

- API 客户端位于 `src/api/`，页面组件不直接散落 `fetch`。
- Vite 开发代理默认转发到 `http://127.0.0.1:8787`，可使用无秘密的 `VITE_BACKEND_PROXY_TARGET` 覆盖。
- 应用入口启动时非阻塞访问 `/health`；后端不可用不会改变或阻断当前 mock 页面。
- 当前页面仍未将登录、首次设置或工作台展示替换为真实数据，mock 文件全部保留。

其他已实现的 Event、Provider/Model、Permission、Security、Confirmation 和 AuditLog 路由见 [`../../docs/后端/12-API与事件契约.md`](../../docs/后端/12-API与事件契约.md) 与 [`../README.md`](../README.md)。
