# 后端工程脚本

本目录用于放置可复现的开发、检查、迁移和运维脚本。

脚本必须有明确输入、失败行为和适用环境；涉及数据迁移、恢复或删除时必须提供额外保护。`pnpm run prepare:local-chat` 调用 `prepare-local-chat-profile.js`，幂等准备 V5 固定本地用户、助手、会话和 SubjectBinding；已有数据与固定值冲突时 fail closed。该脚本不启动 HTTP、不连接 Engine 或 Provider，也不保存密钥。

## L1 真实供应商试聊准备

以下三个命令均不调用模型、不连接 Provider 或 Engine，也不会产生费用：

- `pnpm run export:local-chat-binding -- --output <仓库外绝对路径>`：直接从正式 `fixedSubjectBindingFixture` 和 RFC 8785/hash 实现导出 Engine `init` 所需 fixture。完全相同的文件会复用；内容不同、非法 JSON 或仓库内路径一律拒绝覆盖。
- `pnpm run prepare:live-chat -- --plan`：只读检查环境与 SQLite，列出 Provider、Model、chat 路由、manage/execute Permission、有限 Token Budget 和 credential binding 的 `present/configured/missing/conflict` 状态。缺少配置以失败退出码结束。
- `pnpm run prepare:live-chat -- --apply --acknowledge-external-provider --acknowledge-possible-charges`：经用户双重确认后，通过现有领域服务创建缺失配置。credential reference 固定为 `env:VIO_MODEL_API_KEY_LIVE`，并真实经过高风险 Confirmation 和 AuditLog。相同配置精确复用；任何同名或作用域冲突都 fail closed，不覆盖、不轮换、不删除。
- `pnpm run doctor:live-chat`：只读检查数据库、Binding、Engine 运行目录/参数、loopback 地址、匹配的 service token 和 API Key 是否存在，输出总体 `ready`、`missing`、`conflict` 或 `unsafe`。它不显示 Key、Token、长度或其他可推断信息。

建议的有限开发预算为每日 `50000`、每轮次 `10000` Token。可用 `VIO_LIVE_DAILY_TOKEN_LIMIT` 与 `VIO_LIVE_SESSION_TOKEN_LIMIT` 显式缩小或调整，但二者必须为有限正整数，session 不得超过 daily，超额策略固定为 `block`。

## Windows PowerShell 首次真实试聊步骤

以下值均为占位符。请使用全新、仓库外且足够短的绝对运行目录；Windows 推荐 `C:\VioS4\first-001`。沙箱创建会在任何写入前预算 Engine WakeSession 最终 JSON 与原子临时文件的最坏路径，超过 240 字符即以 `engine_persistence_path_budget_exceeded` 拒绝且不留目录。不要自动截断、移动旧沙箱或用 `subst`、junction、symlink/reparse point 绕过。不要把真实 Key 或 token 写进 `.env`、JSON、SQLite、日志、文档、Git 或可复用的命令文件。

固定 v1.1 身份只能用于 `s4-live-acceptance` 可销毁验收，身份类型为 `disposable_test` 且 `promotionAllowed=false`。正式主体必须使用另一组身份、新 Binding、新 Vio 数据库和新 Engine 数据目录，禁止将本测试主体晋升为正式主体。

1. 在 Vio 后端终端创建全新的仓库外沙箱；它会导出 Binding 和严格 manifest，但不会创建业务记录或初始化 Engine：

```powershell
cd "C:\Users\Administrator\Documents\vio   live\backend"
$runtimeRoot = "C:\VioS4\first-001"
pnpm run create:live-chat-sandbox -- --root $runtimeRoot
$env:VIO_LIVE_SANDBOX_MANIFEST = Join-Path $runtimeRoot "sandbox.manifest.json"
$bindingFile = Join-Path $runtimeRoot "binding.json"
$vioDatabase = Join-Path $runtimeRoot "vio-data\vio-live.sqlite"
$engineData = Join-Path $runtimeRoot "engine-data"
$cycleId = "vio-live-first-chat-cycle-001"
```

2. 在 Engine 终端只读使用 Engine 代码，把数据写到上述仓库外目录并初始化：

```powershell
cd "C:\Users\Administrator\Documents\continuity-engine"
$env:PYTHONPATH = "src"
python -m continuity_engine.integration_server init `
  --data-dir "<仓库外运行目录>\engine-data" `
  --binding-file "<仓库外运行目录>\binding.json" `
  --binding-fixture-hash "sha256:c75b72194c0158a549f3fb30f04a5147ea11a4e777cb1a9cc1a54da6b93359f6" `
  --cycle-id "vio-live-first-chat-cycle-001"
```

3. 在 Engine 终端设置仅本进程有效的本地 service token，并以 capability 模式启动：

```powershell
$env:CONTINUITY_ENGINE_INTEGRATION_TOKEN = "<至少32字符的随机本地service-token>"
python -m continuity_engine.integration_server serve `
  --data-dir "<仓库外运行目录>\engine-data" `
  --port 8766 `
  --thinking-mode capability
```

4. 在 Vio 后端终端设置同一 token、Engine/Binding 参数、Provider 非秘密配置与当前进程 Key：

```powershell
cd "C:\Users\Administrator\Documents\vio   live\backend"
$env:VIO_BACKEND_DB_PATH = "<仓库外运行目录>\vio-data\vio-live.sqlite"
$env:VIO_LIVE_SANDBOX_MANIFEST = "<仓库外运行目录>\sandbox.manifest.json"
$env:VIO_CONTINUITY_ENGINE_ENABLED = "true"
$env:VIO_CONTINUITY_ENGINE_BASE_URL = "http://127.0.0.1:8766"
$env:VIO_CONTINUITY_ENGINE_TOKEN = "<与Engine完全相同的service-token>"
$env:CONTINUITY_ENGINE_INTEGRATION_TOKEN = "<与Engine完全相同的service-token>"
$env:VIO_LIVE_BINDING_FILE = "<仓库外运行目录>\binding.json"
$env:VIO_LIVE_ENGINE_DATA_DIR = "<仓库外运行目录>\engine-data"
$env:VIO_LIVE_ENGINE_CYCLE_ID = "vio-live-first-chat-cycle-001"
$env:VIO_LIVE_ENGINE_THINKING_MODE = "capability"
$env:VIO_LIVE_PROVIDER_BASE_URL = "https://<供应商基础地址>/v1"
$env:VIO_LIVE_MODEL_NAME = "<真实模型名称>"
$env:VIO_MODEL_API_KEY_LIVE = "<真实API-Key；只放当前进程环境>"
$env:VIO_LIVE_DAILY_TOKEN_LIMIT = "50000"
$env:VIO_LIVE_SESSION_TOKEN_LIMIT = "10000"
```

5. 先只读计划，确认后再 apply，最后 doctor：

```powershell
pnpm run prepare:live-chat -- --plan
pnpm run prepare:live-chat -- --apply `
  --acknowledge-external-provider `
  --acknowledge-possible-charges
pnpm run doctor:live-chat
pnpm start
```

6. 在第三个终端启动现有前端：

```powershell
cd "C:\Users\Administrator\Documents\vio   live"
pnpm dev
```

7. 打开 F1 对话页发送消息。若页面显示安全确认、预算确认或受控重试，必须由用户明确点击。Provider 原始候选先形成 CapabilityResult 回到 Engine；只有 Engine 最终主体回复能够进入 assistant Message。

8. 验收结束后先停止前端、Vio 与 Engine，再只读查看清理计划并双确认整套删除：

```powershell
pnpm run cleanup:live-chat-sandbox -- --manifest $env:VIO_LIVE_SANDBOX_MANIFEST --plan
pnpm run cleanup:live-chat-sandbox -- --manifest $env:VIO_LIVE_SANDBOX_MANIFEST --apply `
  --acknowledge-services-stopped `
  --acknowledge-destroy-entire-sandbox
```

清理唯一目标是 `canonicalSandboxRoot`。门禁上线前创建、且唯一不安全原因是 `engine_persistence_path_budget_exceeded` 的旧沙箱，doctor 仍会返回 unsafe，但 cleanup plan 会在全部其他严格校验通过后返回 `cleanupEligible=true`、`legacyUnsafeReason=engine_persistence_path_budget_exceeded` 和唯一整根删除目标；apply 仍必须提供上述双确认。Manifest/Binding 篡改、路径错配、保护路径、reparse、未知内容、占用或其他错误不会进入兼容路径。禁止手工删除 SQLite 行、单个 Engine JSON 或修改/回退 revision。清理完成后若要正式使用，必须重新创建正式身份、Binding、Vio 数据库与 Engine 数据目录。

`prepare:live-chat` 与 `doctor:live-chat` 都不调用模型。只有页面发送消息且必要确认完成后，才可能产生真实 Provider 调用和费用。关闭终端会清除当前进程秘密，之后必须重新设置。Engine 与 Vio 数据库始终独立，Vio 不读取 Engine 数据库；前端始终只连接 Vio 后端。
