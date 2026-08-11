# 后端配置治理

本目录用于保存可提交的配置说明，不保存真实值。当前服务直接读取进程环境变量，不依赖 `.env` 文件或第三方配置库。

- 密钥、Token、密码和用户数据不得提交。
- 环境变量在启动时统一读取和校验。
- 开发、测试和生产环境必须明确隔离。
- 前端不得读取后端秘密配置。

## 当前环境变量

| 名称 | 默认值 | 作用 |
| --- | --- | --- |
| `VIO_BACKEND_HOST` | `127.0.0.1` | HTTP 监听地址 |
| `VIO_BACKEND_PORT` | `8787` | HTTP 监听端口 |
| `VIO_BACKEND_DB_PATH` | `backend/data/vio-live.dev.sqlite` | 开发数据库文件；测试可使用 `:memory:` 或临时路径 |
| `VIO_CONTINUITY_ENGINE_ENABLED` | `false` | 是否装配正式本机 Continuity HTTP transport；仅接受 `true` / `false` |
| `VIO_CONTINUITY_ENGINE_BASE_URL` | `http://127.0.0.1:8766` | Engine E4 本机 HTTP origin；启用时必须显式提供且只接受 `127.0.0.1`、无路径/凭据 |
| `VIO_CONTINUITY_ENGINE_TOKEN` | 无 | Engine E4 Bearer service token；启用时必填且至少 32 字符，不保存到数据库或日志 |
| `VIO_CONTINUITY_ENGINE_CONNECT_TIMEOUT_MS` | `2000` | 建立本机连接的超时毫秒数 |
| `VIO_CONTINUITY_ENGINE_RESPONSE_TIMEOUT_MS` | `20000` | 连接建立后等待完整响应的超时毫秒数 |
| `VIO_CONTINUITY_ENGINE_MAX_RESPONSE_BYTES` | `1048576` | Engine HTTP 响应体字节上限 |
| `VIO_MODEL_PROVIDER_CONNECT_TIMEOUT_MS` | `5000` | Provider 建立连接的超时毫秒数 |
| `VIO_MODEL_PROVIDER_RESPONSE_TIMEOUT_MS` | `60000` | Provider 完整响应超时毫秒数 |
| `VIO_MODEL_PROVIDER_MAX_REQUEST_BYTES` | `1048576` | Provider 请求体字节上限 |
| `VIO_MODEL_PROVIDER_MAX_RESPONSE_BYTES` | `2097152` | Provider 响应体字节上限 |
| `VIO_MODEL_API_KEY_*` | 无 | V4 credential binding 可引用的密钥环境变量；只允许通过 `env:VIO_MODEL_API_KEY_*` 引用，值不得写入文件、SQLite、日志或响应 |

配置值不会返回给前端。数据库路径可以迁移到其他适配器，但业务模块不得直接读取该环境变量。Continuity 集成默认关闭；启用时只连接本机，token 仅在进程内用于 `Authorization: Bearer ...`，不得写入 Git、SQLite、日志或错误响应。Provider secretRef 由独立 credential binding 保存，真实值仅在模型调用瞬间从环境读取；环境变量名称和 Base URL 都必须先通过严格校验。`/health` 只暴露 `disabled`、`ready`、`degraded`，不返回 token、密钥配置、完整 Engine URL、Binding 或请求正文。
