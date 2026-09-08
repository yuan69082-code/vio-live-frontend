# R6 前端交接

状态：R6 能力中心真实接线、前端门禁、助手隔离返修和受控本地页面闭环已完成；总体协调窗口已于 2026-09-08 正式验收 R6 通过。

接口权威来源：`backend/docs/R6_UNIFIED_CAPABILITY_EXECUTION_CONTRACT.md` 的 2026-09-08 冻结版。前端没有另建身份、权限、数据库、MCP 或 Provider 规则。

## 页面接线

- 六个主导航保持不变；“能力”页保留 R2 已验收的真实 Provider/Model 管理，并把 MCP、Skill、Plugin、Tool 原型替换为统一真实能力管理器。
- 当前用户来自 R2 个人会话，能力读写和执行绑定服务端当前助手；页面不发送测试身份头、`userId` 或 `assistantId`。
- 能力目录使用 `GET /api/v1/personal/capabilities`，严格接受 `vio-capability-catalog/v1`；支持 `model_api` 投影、`local_tool`、`mcp_tool`、`skill` 和 `plugin_action` 五类事实。
- 配置动作已接：内置确定性 Tool 安装、受信 MCP 服务登记及发现、1–8 步 Skill 安装、1–16 动作 Plugin 安装，以及 Plugin 启用、停用和卸载。
- MCP 发现的 `failed` / `outcome_unknown` 是服务端持久化事实；页面只通过原能力 ID 和原幂等键调用 discovery query，不自动重发 `tools/list`。结束核对后，只有用户再次点击才创建新操作键。
- 生产表单只接受无凭据、查询和片段的 HTTPS 地址；仅在本机开发页、目标同为 loopback HTTP 时允许提交受控测试地址，后端的注入白名单和目标校验仍是最终权限边界。
- 显式执行已接：选择当前已启用能力和服务端给出的操作、提交严格 JSON、等待安全确认、批准/拒绝、取消未越界执行、安全重试、重新读取、按原幂等键查询及仅在服务端确认 `not_found` 且仍持有同一内存输入时原键重发。
- 统一历史支持类别/状态筛选、25 条分页、下一页游标和执行详情；展示服务端状态、尝试次数、外部调用事实、输入哈希、受控结果、Token 与费用事实，不把旧 `registry_only` / `not_executed` 记录当成真实执行。
- 手机与设备区只显示“0 个已验证连接 · R9 未施工”，不再展示模拟在线设备、模拟授权或管理按钮；R9 设备执行、R7 主动执行与完整权限中心均未开始。

## 安全、恢复与隔离

- 配置和执行均有页面互斥；安全确认往返和未知结果重试复用原配置幂等键。即使浏览器存储不可用，配置请求仍使用组件内保存的同一键。
- 执行恢复使用独立恢复键；只有服务端 `retryable` 才展示“安全重试”，`outcome_unknown` 只允许查询，取消只对服务端仍标为未越界的状态开放。
- `sessionStorage` 只保存版本、随机原幂等键和必要的不透明 capabilityId / executionId，并按所有者/助手命名空间隔离；能力输入、配置正文、MCP 地址、结果、凭据和完整响应不进入浏览器持久存储或 URL。未决 MCP 发现可在刷新后恢复为“仅查询原键”的页面状态。
- 身份失效、退出或用户变化会清除该用户全部 R6 恢复索引。助手切换会立即清空旧目录、历史、表单、输入、结果和请求观察，但保留该旧助手无正文的独立恢复索引，切回后仍可按原键安全查询。
- 所有读写均复用 `PersonalContext.guarded` 与作用域 generation/AbortController；卸载、身份或助手变化后的迟到成功、失败和 `finally` 不得写入新视图。
- 公共 DTO 采用 exact parser：多余字段、未知枚举、不可能状态组合、非法哈希/时间/游标、超大或过深 JSON 均拒绝为 `invalid_response`。MCP 官方允许缺省 `outputSchema`，因此冻结的 `outputSchemaHash` 精确为 `string | null`。

## 当前验证记录

- 首轮 R6 组件专项 5/5 失败：全部是新测试使用单元素查询匹配到列表与选择项的重复可见文本，不是产品请求失败；改为按复数/语义角色断言，未删除业务断言。
- 第二轮组件专项 3/5；修复“只读历史不应冒充新执行成功提示”的测试前提，并以当前执行卡状态直接证明 `outcome_unknown` 不出现重试入口。
- 随后补强助手切换立即清空旧视图、切回恢复原键、服务端证明可重试、未越界取消、Plugin 停用/卸载状态和配置内存幂等键。
- 最终专项命令 `pnpm test src/api/personal-capability-api.test.ts src/api/personal-capability-recovery.test.ts src/components/capability/UnifiedCapabilityManager.test.tsx src/components/personal/useScopedAction.test.tsx`：4 文件、36/36。
- 组件独立复跑：`UnifiedCapabilityManager.test.tsx` 17/17。覆盖 StrictMode、重复点击、配置/执行确认、未知结果、原键恢复、助手切换、迟到成功/失败/`finally`、卸载和服务端证明的安全重试。
- 第一次最终全量在 332 项中 331 通过、1 失败：MCP loopback 表单用例在 27 文件并发时未在默认等待窗口内看到完成提示；同一未修改代码的组件独立复跑为 17/17，随后全量复跑为 27 文件、332/332。未延长超时、未删除或放宽断言。
- `pnpm run typecheck` 通过；`pnpm run build` 通过，136 modules transformed。仅有既有的单一产物超过 500 kB 提示（JS 569.60 kB，gzip 165.18 kB），不是构建失败。
- 后端在首轮浏览器联调中被实际发现“R6 定义曾按 owner 共享”的缺陷；前端切换时已正确重新请求，未在浏览器过滤掩盖问题。后端把定义、发现、配置和执行幂等事实修正为 owner + current-assistant 作用域后，后端 R6 17/17、迁移组合 50/50、默认全量 477 项（476 pass、0 fail、1 个既有 RFC 条件跳过）。最终页面复验使用修复后的全新临时数据库，不复用受污染夹具。

## 受控本地页面证据

- 环境只包含临时个人身份、隔离 SQLite、随机 loopback MCP、确定性内置 Tool 和既有受控 loopback Provider；没有访问真实供应商、真实 MCP、真实凭据、真实 Engine 或业务互联网。
- 助手一真实安装并确认 `builtin.text.inspect/v1`，执行结果由服务端返回字符数、行数与内容哈希，`externalCall=not_performed`、Token/费用均为 `not_incurred`。
- 助手一真实登记 MCP、完成 `2026-07-28` `tools/list`（1 个严格校验工具）并调用 `echo`；页面只展示受控结果，记录 `externalCall=performed`、费用未产生。
- 真实安装两步 Skill（本地 Tool + MCP）、执行并读取两个服务端 step 结果；真实安装 Plugin manifest、执行 action，随后完成停用、重新启用和卸载。卸载后不再可选为新执行，旧执行事实仍保留。
- 同一 owner 的助手一和助手二分别安装同名内置 Tool、分别执行并得到不同输入哈希；切换助手二时目录/历史不包含助手一 MCP、Skill、Plugin 或执行，切回后助手一原历史恢复。服务重启后再次切换，隔离和各自历史仍保持。
- 第二 owner 登录后目录、依赖和历史均不包含第一 owner 的 Tool、MCP、Skill、Plugin 或执行。跨 owner 的 discovery、dependency、lifecycle、execution 和 by-key 拒绝另由修复后的后端 R6 17/17 覆盖。
- 首次 capability POST 响应被受控丢弃后，页面明确显示结果未知；按浏览器保存的原幂等键查询到 `waiting_confirmation`，批准后同一执行完成，没有换键盲重发。
- MCP 发现越过外部边界后模拟 timeout，页面保持 `outcome_unknown` 并只允许按原键查询；刷新页面后仍恢复为仅查询状态，查询冻结事实也没有假报成功或自动再次 `tools/list`。
- 受控服务重启后，显式刷新恢复正确目录和不可变历史。390px 测试视口实际 `innerWidth=391`、`documentScrollWidth=391`、`bodyScrollWidth=391`，无横向溢出；键盘 Enter 可触发真实刷新；浏览器日志为 0 error、0 warning。视口已在验证后恢复。

## 未完成与边界

- 手机实机、真实第三方 MCP、真实供应商和生产 HTTPS 部署未执行；390px 受控浏览器证据不能替代手机实机或真实外部服务验收。
- 不包含 R7 主动执行/完整权限中心、R9 设备执行、插件市场、任意脚本、云同步、部署、真实第三方 MCP、真实收费模型或真实凭据验收。
- R6 已由总体协调窗口正式验收；共同工程日志与 Git 交付由后端窗口统一收尾，前端窗口未独立执行 `git add`、commit、fetch 或 push。
