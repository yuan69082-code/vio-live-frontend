# Vio Live 后端 ADR 决策记录

## BE-ADR-038：首次真实供应商验收只能证明可销毁测试身份下的本机链路

- 日期：2026-08-14
- 状态：已采用，仅记录 S4-Live 首次正式验收
- 决策：首次真实供应商试聊必须使用 `purpose=s4-live-acceptance`、`identityClass=disposable_test`、`promotionAllowed=false` 的固定测试身份，以及仓库外短路径独立沙箱。验收通过后只记录最小、脱敏的执行与权威边界事实，并由官方 cleanup 整根删除沙箱；该身份、Binding、Vio SQLite 和 Engine data 均不得晋升或复用为正式个人数据。
- 验收事实：2026-08-14 在 `C:\VioS4\first-001` 使用 Alibaba Cloud Model Studio OpenAI-compatible Provider 与 `qwen-flash-2025-07-28` 完成一次 Provider execution；Provider 报告 177 input、9 output、186 total Token，finish reason 为 `stop`。CapabilityResult 为 `SUCCEEDED`，首次回传 HTTP 200，result outbox completed；Turn completed，最终主体表达“Vio首次真实试聊连接成功。”只来自 Engine `FirstRoundSuccessResult`。Engine 保持 `changed=false / revision=0`，没有内部 Event、StateMutation 或越权状态写入。
- 费用与清理：Vio 账本只确认 `cost_status=not_reported`。验收时供应商费用概览显示 ¥0，但官方用量与账单可能延迟，因此不将其表述为永久最终费用为零。验收后 5173/8787/8766 均无监听，官方 cleanup 只删除完整 `C:\VioS4\first-001`，未命中 protected/repository path，最终路径不存在。
- 边界：本决策不改变 v1.1、V1–V5、Engine 权威、Capability Schema、公共 API 或前端接口。一次 PASS 不代表通用身份/Binding、生产认证、多租户、加密密钥存储、备份或部署完成；当前只允许本机受控使用，不得公开部署。

## BE-ADR-036：S4-Live 固定身份只能存在于可销毁同根沙箱

- 状态：接受
- 决定：固定 v1.1 身份登记为 `s4-live-acceptance / disposable_test / promotionAllowed=false`；Binding、Vio SQLite 与 Engine data 必须同属严格 manifest 的仓库外 canonical root。
- Windows 路径门禁：创建前及 manifest/doctor 读取时，按 Engine `awakening/sessions/<64字符subject hash>/<64字符session hash>.json` 和 Python 原子临时文件 `.sessionHash.<8字符随机名>.tmp` 的代表性最坏路径计算，安全上限固定为 240 字符。超限返回 `unsafe / engine_persistence_path_budget_exceeded`，不得产生半创建目录或通过截断、搬移、`subst`、junction、symlink/reparse point 绕过。
- 历史清理兼容：默认读取、inspection 和 doctor 不允许绕过路径门禁。cleanup 先执行同一严格读取；仅当失败精确为上述稳定原因码时，私有 cleanup-only 模式才跳过该单项并重新执行完整 Manifest、Binding、canonical path、protected path、reparse、白名单、占用和整根目标校验。其他错误不能进入兼容模式；plan 只读，apply 仍需双确认。
- 清理：只允许服务停止后的整根删除，禁止逐行、逐 JSON 或 revision 回滚；仓库、默认数据目录、用户目录、Documents 与磁盘根均为保护路径。
- 边界：不改变 V1–V5、Engine 权威、Capability Schema 或公共 API。正式主体不得复用该身份或数据。

## 使用规则

- 本文件记录只影响 `backend/` 的工程与技术决策。
- 影响前端、continuity-engine、产品范围、权限或平台总体边界的决策，需要同步到 `docs/决策记录.md`。
- 每项决策标明状态；“待决策”内容不能被实现代码提前固化。
- 被替代的决策保留原记录，并注明替代关系。

## BE-ADR-001｜后端使用独立顶层目录

- 日期：2026-07-25
- 状态：已采用
- 决策：平台后端统一放在仓库顶层 `backend/`，不与前端根目录 `src/`、构建配置或依赖混合。
- 原因：前端已经完成并保持稳定；独立目录可以明确两套工程的职责、依赖和验证边界。
- 影响：后端源码、测试、配置说明和工程脚本都必须位于 `backend/` 内。第一阶段不得修改前端 `src/`。

## BE-ADR-002｜第一阶段只建立设计骨架

- 日期：2026-07-25
- 状态：已采用
- 决策：第一阶段只建立目录、职责、文档治理、实施路线和准入门槛，不初始化框架、不安装依赖、不启动服务。
- 原因：数据库、认证、API、部署和密钥方案尚未形成正式技术决策，提前初始化会把未确认选择固化进工程。
- 影响：本阶段没有可执行后端、端口、数据库迁移、网络请求或模型调用。

## BE-ADR-003｜采用模块边界与集成边界分离的工程结构

- 日期：2026-07-25
- 状态：已采用
- 决策：未来后端源码分为共享内核 `core`、平台业务模块 `modules` 和外部适配 `integrations`；具体框架目录可在技术栈确定后细化，但不得破坏依赖方向。
- 原因：账号、主体、事件、权限等平台规则需要保持稳定，而数据库、模型、continuity-engine、MCP 和设备实现需要能够替换。
- 影响：业务模块不能直接依赖具体供应商 SDK；外部系统通过明确契约和适配器进入平台。

## BE-ADR-004｜用户与主体双重归属是数据设计前置条件

- 日期：2026-07-25
- 状态：已采用
- 决策：所有需要隔离的业务数据和调用上下文必须明确表达 `user_id` 与 `subject_id`，并同时携带来源、时间、状态或版本、可见范围等必要信息。
- 原因：Vio Live 同时存在账号级数据和智能体主体级连续状态，只依赖登录用户无法防止同一用户下的主体数据混用。
- 影响：数据模型、API 契约、事件、权限、导出和测试设计都必须验证双重归属。

## BE-ADR-005｜平台后端与 continuity-engine 保持平行边界

- 日期：2026-07-25
- 状态：已采用
- 决策：平台后端不实现 continuity-engine 的身份、关系、情绪、记忆影响或状态演化算法，只维护调用契约、授权范围、请求来源和写入结果。
- 原因：连续性能力需要独立演进，并且不能与平台账号、权限、模型或数据库实现耦合。
- 影响：`integrations` 中只能出现 continuity-engine 的端口与适配实现；其内部存储和算法不进入本工程。

## BE-ADR-006｜先确定逻辑数据模型，再选择物理数据库

- 日期：2026-07-25
- 状态：已采用
- 决策：第二阶段只定义核心对象、字段语义、关系、约束、分类和生命周期，不提前确定数据库产品、物理表、字段类型、索引、ORM 或迁移工具。
- 原因：用户/主体隔离、版本关系和数据权利是稳定产品约束，不应被尚未选择的存储技术反向塑造。
- 影响：`docs/后端/数据库设计.md` 和 `docs/后端/数据关系图.md` 是逻辑设计输入，不能直接当作生产数据库迁移；物理实现必须等待数据库 ADR。

## BE-ADR-007｜核心数据使用三类标记并允许叠加

- 日期：2026-07-25
- 状态：已采用
- 决策：核心对象按“用户数据、AI 主体数据、平台数据”标记；一个对象可以同时具有多个分类，敏感等级与该分类独立表达。
- 原因：对话、权限、事件等对象同时承载用户内容、主体连续性和平台治理职责，单一分类无法准确表达归属与保护要求。
- 影响：导出、删除、授权、日志和上下文装配必须按字段实际分类和敏感等级执行，不能仅凭对象名称决定可见性。

## BE-ADR-008｜状态、消息版本和事件保留可追溯历史

- 日期：2026-07-25
- 状态：已采用
- 决策：`SubjectState`、`MessageVersion` 和 `Event` 的重要变化不使用原地覆盖抹去历史；当前状态通过版本号、当前标记或逻辑指针选择，删除与重置通过受控状态或标记表达。
- 原因：Vio Live 需要支持主体状态延续、消息编辑与重生成、分支、删除、重置、导出和审计，覆盖式写入无法保持这些关系。
- 影响：物理数据库需要提供唯一性、并发控制和保留策略；历史版本仍受用户删除权、保留期限和隐私政策约束。

## BE-ADR-009｜基础服务采用 Node.js 22 ESM 与标准库 HTTP

- 日期：2026-07-25
- 状态：已采用
- 决策：平台后端第一版基础服务使用 Node.js 22 ESM；启动、HTTP 服务、UUID 和测试优先使用 Node.js 标准库，当前不引入 Web 框架或第三方运行依赖。
- 原因：本阶段只有健康检查、User 和 Subject 最小闭环，标准库足以提供可验证运行能力，并能避免在接口和认证范围尚未完成前引入额外框架耦合。
- 影响：运行环境要求 Node.js `>=22.5.0`；后续如引入 Web 框架，必须保持业务服务和仓储边界，并通过新 ADR 说明迁移原因。测试使用 Node.js 内置测试运行器。

## BE-ADR-010｜开发数据库采用 SQLite、顺序迁移和仓储适配

- 日期：2026-07-25
- 状态：已采用，仅限开发环境
- 决策：开发环境使用 Node.js 内置 `node:sqlite` 和本地 SQLite 文件；物理结构由有序 SQL 迁移创建，User 与 Subject 通过仓储适配访问，业务层不直接执行 SQL。
- 原因：SQLite 可以在不连接外部数据库服务的前提下完成真实持久化闭环；迁移记录和仓储边界保留了替换正式数据库的路径。
- 影响：`node:sqlite` 在当前 Node.js 22 中仍为实验模块，不能据此宣布生产数据库完成；正式数据库、备份、并发、加密和部署需要后续 ADR。SQLite 运行文件不得进入 Git。

## BE-ADR-011｜基础路由使用版本化 JSON 与统一错误结果

- 日期：2026-07-25
- 状态：已采用，范围仅限本阶段
- 决策：健康检查保留在 `/health`，User 和 Subject 闭环使用 `/api/v1` 前缀；成功结果使用 `{ data }`，失败结果使用 `{ error: { code, message, requestId } }`，并限制 JSON 请求体大小。
- 原因：最小闭环需要稳定、可测试的传输边界和明确失败语义，同时不能把前端模拟结构直接当作数据库或业务模型。
- 影响：当前路由不是完整公开 API；真实认证、授权、分页、正式接口版本和契约生成仍需后续阶段决定。未认证前不得公开部署。

## BE-ADR-012｜软件事件采用不可覆盖记录与用户嵌套查询

- 日期：2026-07-25
- 状态：已采用
- 决策：Event 作为已经发生的软件变化记录，创建后不提供内容更新或删除路由；事件通过 `/api/v1/users/:userId/events` 创建和查询，主体事件在数据库中使用 `(user_id, subject_id)` 组合外键校验归属，初始状态统一为 `pending`。
- 原因：事件需要为未来连续性读取和上下文装配提供可追溯事实；用户嵌套路由和组合外键可以防止仅凭 `subject_id` 产生跨用户事件，避免覆盖式写入破坏来源和时间关系。
- 影响：当前只记录和筛选事件，不消费事件、不调用模型，也不实现状态更新器；`consumed`、`ignored`、`failed` 只作为未来处理状态保留。事件数据拒绝明显的密钥、密码、验证码和 Token 字段。

## BE-ADR-013｜模型目录、规则路由与真实调用适配分离

- 日期：2026-07-26
- 状态：已采用；目录顺序路由由 BE-ADR-026 扩展为显式默认/备用规则并保留兼容回退
- 决策：APIProvider 与 Model 作为用户范围内的本地配置目录持久化；Model Router 只按任务能力读取启用 Provider 下的模型，并按 Provider 创建时间、Provider ID、Model 创建时间和 Model ID 的稳定顺序返回首个匹配项。Router 不包含供应商 SDK、网络请求或模型响应逻辑。
- 原因：本阶段需要先验证服务配置、能力标签和调度边界，同时不能因“选择模型”而产生真实费用、Token 消耗或外部数据传输。
- 影响：停用 Provider 后，其模型仍保留在配置查询中，但不会被 Router 选择。优先级、备用模型、费用、健康状态和实际调用需要后续独立决策。

## BE-ADR-014｜API Key 字段仅预留且当前禁止写入

- 日期：2026-07-26
- 状态：已采用，范围仅限本阶段
- 决策：`api_providers` 预留 `api_key_secret_ref` 字段，但当前数据库约束要求其必须为 `NULL`；Provider 接口拒绝 API Key、Token、Secret、凭据引用等输入，响应只返回 `not_configured` 状态。Base URL 同时拒绝用户信息、密码和凭据查询参数。
- 原因：密钥库、加密、轮换和运行环境注入方案尚未决策，普通 SQLite 或 API 返回值都不是可接受的密钥存储位置。
- 影响：当前 Provider 只能用于本地目录和路由规则验证，不能连接任何真实服务。未来接入密钥库时必须通过新迁移和 ADR 放开安全引用，仍不得保存或返回 Key 明文。

## BE-ADR-015｜权限按用户、主体、资源与操作精确匹配并默认拒绝

- 日期：2026-07-26
- 状态：已采用
- 决策：Permission 规则必须同时绑定 `user_id`、`subject_id`、`resource_type`、`resource_id` 和 `action`；当前不提供通配规则。Checker 只读取完全匹配且状态为 `active` 的规则，没有匹配时返回 `deny`。五档映射为：`always_allow → allow`、`ask_every_time → ask`、`allow_once → allow`、`denied/forbidden_ask → deny`，并用 `canAsk` 区分两种拒绝。
- 原因：只按资源类别或总开关授权会把权限扩大到未确认主体、实例或操作；默认拒绝可避免新增资源在没有规则时被误放行。
- 影响：调用方必须提供完整操作范围。当前没有主体无关规则、通配符、继承、优先级或高风险操作确认；这些能力需要后续独立设计。

## BE-ADR-016｜权限变更与事件同事务提交，单次许可和删除保留终态

- 日期：2026-07-26
- 状态：已采用；Event 类型细分由 BE-ADR-029 修订
- 决策：Permission 创建、实际更新、删除和 `allow_once` 消费必须与对应 `permission_changed` Event 在同一 SQLite 事务中提交。`allow_once` 首次成功判断后变为 `consumed`；删除变为 `deleted`，不物理抹除记录。
- 原因：权限规则与事件任一单独成功都会造成实际判断和审计视图不一致；单次许可若不原子消费可能被重复使用；物理删除会破坏权限变化追溯。
- 影响：`consumed` 和 `deleted` 规则不参与判断，且不能再更新；默认列表排除 `deleted`，但可通过明确状态筛选查看。正式数据库需要提供等价事务和并发保证，保留期限仍待隐私策略决定。

## BE-ADR-017｜安全检查采用分层收紧与非执行预检

- 日期：2026-07-27
- 状态：已采用；用户 Security Policy 层由 BE-ADR-029 扩展
- 决策：统一安全检查固定按 Permission、规则化风险、确认要求的顺序返回 `allow`、`confirm` 或 `deny`，只能收紧权限结果，不能用确认绕过拒绝。风险使用 `low`、`medium`、`high`、`critical` 四级；低风险不要求确认，中风险进入用户自定义确认，高风险和极高风险每次确认。响应中的 `executionStatus` 固定为 `not_executed`，本阶段不执行资源。安全预检不消费 `allow_once`，仅当权限、风险和确认全部满足时才在同一事务内消费。
- 原因：Permission 的长期允许不等于高风险操作可以直接执行；若预检阶段提前消费单次许可，用户尚未确认就会丢失授权；若安全检查同时承担执行，会越过本阶段没有真实能力适配器的边界。
- 影响：现有独立 Permission Checker 接口保持首次判断消费 `allow_once` 的语义；Security Service 使用非消费预览，并在最终返回可执行资格前消费。风险规则目前是平台内确定性基线，生产阶段必须由服务端资源元数据推导，不能信任客户端标签降低风险。

## BE-ADR-018｜敏感数据只建分类元数据，AuditLog 与 Event 分离

- 日期：2026-07-27
- 状态：已采用，生产保留策略待定
- 决策：SensitiveData 只定义 `api_key`、`identity_information`、`payment_information`、`private_record`、`ai_private_domain` 五类分类元数据，分类查询没有正文写入入口。AuditLog 使用独立只追加表，保存请求范围所属用户、可选主体、操作类型、资源引用、动作、风险、结果、可选确认引用和时间；没有任意请求正文、payload 或详情 JSON 字段，也不开放创建、更新或删除接口。按契约不得把秘密值作为资源引用传入；当前要求平台不透明 ID 并启发式拦截常见凭据形态，但该规则不是完整 DLP，生产阶段仍需可信资源注册表和专用扫描。Event 继续表示软件变化，不替代安全审计，也不因存在审计记录而进入 AI 上下文。
- 原因：安全治理事实与供平台感知的软件变化具有不同可见范围和保留目的；任意 payload 会把 API Key、身份、支付或私域原文带入普通数据库和日志。
- 影响：Permission 变更与 APIProvider 配置变更会生成最小审计记录；以 `privacy_access_request` 为操作类型的安全预检也可以形成审计，但本阶段没有 PrivateDomain 申请、读取或执行模块。API Key 仍不得写入，`api_key_secret_ref` 仍为 `NULL`。当前审计 `user_id` 只是请求范围归属，不代表已认证操作者；生产认证、审计保留期限、用户可见范围、法定留存和脱敏策略需要后续安全与法律审查。

## BE-ADR-019｜确认绑定完整作用域、权限快照并单次消费

- 日期：2026-07-27
- 状态：已采用
- 决策：Confirmation 支持 `not_required`、`every_time`、`user_defined` 三种要求；需要持久化时只保存后两种。确认记录绑定用户、主体、操作类型、资源类型、资源 ID、动作、风险等级、Permission ID/等级/更新时间快照及安全策略指纹，状态可由 `pending` 进入 `approved`、`rejected` 或 `expired`，由 `approved` 进入 `consumed` 或 `expired`。已批准确认五分钟内只能在完全匹配的安全请求中消费一次，不能跨用户、主体、资源、动作、敏感分类、策略或权限版本复用。
- 原因：仅保存“用户已确认”会产生跨资源复用和重放风险；权限在确认后发生变化时，旧确认也不能继续放行。
- 影响：确认批准只表示本次安全门槛已满足，不表示真实操作已经执行。确认自请求起五分钟后过期；高风险请求每次都需要新确认。中风险 `user_defined` 在正式服务端偏好存储完成前一律安全默认要求确认，安全检查请求不能自行关闭。确认同时保存安全策略指纹，敏感分类或其他风险依据变化后旧确认失效。

## BE-ADR-020｜所有 JSON 响应使用统一 envelope

- 日期：2026-07-27
- 状态：已采用；替代 BE-ADR-011 中仅 `{ data }` / `{ error }` 的响应外形
- 决策：所有 JSON 成功与失败响应固定包含 `success`、`data`、`error` 和 UTC ISO-8601 `timestamp`。成功时 `error=null`，失败时 `data=null`；列表可以额外保留 `meta`，错误继续包含安全的 `code`、`message`、`requestId` 和可选 `details`。HTTP 状态码、`Location`、`x-request-id`、1 MiB 请求限制及 `/api/v1` 版本前缀保持不变。
- 原因：前端需要一个可统一解析的成功、业务失败和传输失败边界；只依赖 HTTP 状态或判断某个字段是否存在会让每个页面重复实现错误分支。
- 影响：现有数据字段和路由语义不改，但所有消费者必须读取 envelope。完整兼容治理、分页标准和生成契约仍待后续；当前服务仍不是公开 API。

## BE-ADR-021｜开发期前后端使用同源代理与可替换用户上下文

- 日期：2026-07-27
- 状态：已采用，仅限本地开发
- 决策：Vite 开发服务器把 `/api` 与 `/health` 代理到默认 `http://127.0.0.1:8787`，可由无秘密的 `VITE_BACKEND_PROXY_TARGET` 覆盖；后端不为此开放通配 CORS。`GET /api/v1/users/current` 只从 `x-vio-user-id` 读取开发期用户选择，不默认取数据库首条记录。前端在 `src/api/` 集中处理请求，并仅在入口执行一次非阻塞健康握手。
- 原因：同源代理可以在不放宽跨域策略的情况下建立首次真实连接；集中客户端避免页面散落 `fetch`。当前没有真实登录或会话，默认选择某个数据库用户会制造错误身份语义。
- 影响：`x-vio-user-id` 不是认证凭证，也不提供授权保护；这些未认证路由不得公开。页面和 mock 本阶段不替换，后端不可用不阻断原型 UI。真实认证接入时应替换请求上下文解析器，而不是把该请求头升级为正式身份方案。

## BE-ADR-022｜Subject 更新与事件原子提交，Dashboard 只投影已有事实

- 日期：2026-07-27
- 状态：已采用
- 决策：Subject PATCH 只允许 `name`、`avatarRef`、`basicSettings`，其中 `basicSettings` 使用整对象替换。只有实际变化才更新时间，并与只含 `changedFields` 的 `subject_updated` Event 在同一数据库事务提交。Dashboard 不建新表，只聚合 owner-scoped User 与 Subject；未实现的连续性状态明确返回 `not_available`。
- 原因：主体基础信息是后续 AI 感知的软件变化，若更新与事件分离会造成真实状态和事件视图不一致。Dashboard 不能从前端 mock、主体设定或模型配置猜测尚不存在的 SubjectState、待办、设备或连续性数据。
- 影响：空 PATCH、未知字段和跨用户 Subject 均失败；无变化请求不发事件。Dashboard 的 `ready` 只表示用户和主体均为活动状态，不表示连续性引擎、模型或外部能力可用。

## BE-ADR-023｜会话消息采用复合归属、当前指针与不可变版本链

- 日期：2026-07-28
- 状态：已采用
- 决策：`006_create_conversations_messages_and_events.sql` 建立 `conversations`、`messages` 和 `message_versions`。三表都保存 `user_id`、`subject_id` 与 `conversation_id`，并通过复合外键把消息和版本限制在同一用户、主体、会话及消息范围。`Message` 表示稳定逻辑消息，在会话内使用唯一递增 `sequence_number` 排序，并以 `current_version_id` 指向当前内容；原始、用户编辑和主体重生成内容分别追加为 `original`、`edited`、`regenerated` 的 `MessageVersion`，父版本必须属于同一消息，数据库触发器禁止原地修改或直接删除版本。编辑和重生成必须提交等于当前指针的 `baseVersionId`，陈旧写入返回 `409`。消息写入、版本追加、当前指针更新、会话活动时间更新及对应 Event 必须在同一事务完成。
- 原因：Vio Live 需要保留消息变化历史，同时防止跨归属引用、覆盖式写入、并发陈旧更新及部分提交造成当前内容和事件不一致。稳定 Message 与不可变版本分离后，读取当前内容和追溯历史都有明确来源。
- 影响：平台自动生成 `conversation_created`、`message_created`、`message_updated`、`message_regenerated` 四类事件，事件数据只保存必要 ID、发送者或版本关系，不保存会话标题或消息内容；加上原五类 Event，当前共九类。`subject` 消息和重生成内容均由开发调用方显式提交，后端只记录版本，不调用 AI。当前未实现分支、删除、重置、上下文装配、连续性引擎、MCP 或 Tool；前端页面和 mock 未修改。路由仍未接入真实认证，复合归属只保证请求范围一致性，不代表调用者身份，因而不得公开部署。

## BE-ADR-024｜摘要与主体状态不可变追加，上下文装配保持只读

- 日期：2026-07-28
- 状态：已采用，仅限开发期连续性基础
- 决策：ConversationSummary 在单一 Conversation 内使用单调版本并不可原地修改或直接删除；每个摘要必须在同一事务保存至少一个经过复合归属校验的 MessageVersion 或 Event 来源。跨窗口读取只在相同用户与主体范围内，排除当前 Conversation，并为每个其他 Conversation 返回最新摘要。SubjectState 接收显式 `state_update`，将当前状态、情绪、强度、变化原因、连续性约束、未解决 Event 和 MessageVersion/Event/ConversationSummary 来源保存为不可变版本；独立 `subject_state_heads` 只维护当前指针。Context Service 不持久化新对象，按产品规定顺序只读装配主体设定、当前状态、未解决事件、近期消息和跨窗口摘要，并明确将系统规则与 Memory 标记为保留或未实现。
- 原因：摘要与状态如果覆盖写入或缺少来源，将无法解释跨窗口连续从何而来；如果 Context Service 在没有模型、Memory、权限筛选和 continuity-engine 的阶段自行生成提示词或推演状态，会把基础数据投影误当成真实连续性能力。不可变记录、强来源引用和独立当前指针可以兼顾历史追溯与快速读取，只读装配则保持模型和连续性边界。
- 影响：摘要、状态和来源均按用户/主体复合归属隔离，事务故障不会留下无来源摘要、孤立状态或错误当前指针。摘要和 `state_update` 都由开发调用方提交，不代表 AI 已生成或 continuity-engine 已计算；本阶段不新增摘要/状态 Event，避免派生数据形成自动消费回路。Context 响应固定标记模型、外部 API 与 continuity-engine 未调用，Memory 返回 `not_implemented`。真实摘要生成、相关性检索、Token 预算、Memory、权限过滤、分支、删除、重置和生产保留策略仍需后续独立决策。

## BE-ADR-025｜助手全局设定与动态主体状态分离

- 日期：2026-07-28
- 状态：已采用，仅限开发期全局设定基础
- 决策：AI Assistant Global Settings 是 Subject 的一对一、可由用户明确更新的长期配置。`subjects.name` 和 `subjects.avatar_ref` 继续作为助手身份的唯一事实来源，避免复制身份字段；新表 `assistant_global_settings` 保存人格描述、表达方式、关系定义、长期要求和禁止事项。服务层把两处数据投影成单一全局设定对象，并在同一事务更新身份字段、扩展设定和最小 `subject_updated` Event。Context 读取该投影作为 `subjectGlobalSettings`，不再把通用 `basicSettings` 冒充完整长期设定。
- 原因：名称和头像已被 Subject、Dashboard 与现有 API 使用，复制到新表会产生双写漂移；而把长期设定继续塞入无类型的 `basicSettings`，又无法形成稳定接口和与 SubjectState 的清晰边界。独立一对一扩展表兼容既有身份数据，同时为表达、关系和长期规则提供明确结构。
- 影响：创建 Subject 时必须原子创建默认空白全局设定，迁移为既有主体回填空白结构但不从旧 JSON 猜测人格。全局设定允许原地更新且无变化不写库；SubjectState 仍为带来源的不可变动态状态历史，任何设定更新都不能创建、覆盖或切换状态版本。长期要求和禁止事项只能约束助手偏好，不能削弱系统最低安全规则。当前不生成设定、不调用模型、外部 API 或 continuity-engine，也不修改前端页面。

## BE-ADR-026｜显式默认/备用规则与模型执行分离

- 日期：2026-07-28
- 状态：已采用，仅限开发期本地模型路由配置
- 决策：APIProvider 保存用户范围的服务类型、Base URL、接口格式、启停状态和只读测试状态；Model 保存 Provider 归属、模型名称/类型、能力标签、费用说明和只读测试状态。`model_routing_rules` 按用户与 `chat`、`long_text`、`image`、`video`、`audio`、`search` 六类任务唯一保存默认模型、可选备用模型及规则状态，并用复合外键阻止跨用户引用。Router 优先读取启用规则：默认 Provider 启用时选默认模型，否则只在已明确配置且 Provider 启用时选备用模型；显式规则不可用时明确失败。规则不存在或停用时保留稳定目录匹配作为兼容回退。所有选择结果都明确标记模型和外部 API 未调用。
- 原因：默认和备用选择是用户配置事实，不能依赖目录插入顺序隐式表达；但当前又禁止接入真实供应商，因此“选择配置”不能被误认为“调用模型”或“测试成功”。把目录、规则、选择和未来执行适配分开，可以验证调度与隔离，同时避免网络、费用、Token 或数据外传。
- 影响：`vision` 与 `embedding` 保留为目录能力标签，但不属于本阶段六类可路由任务。Provider/Model `test_status` 目前只能为 `not_tested`，不得由客户端伪造；真实探测、故障重试、动态健康检查、费用计算和模型调用必须由后续受信适配器与独立 ADR 实现。API Key 仍由拒绝写入的安全存储端口占位，数据库引用保持 `NULL`。Router 不读取或改写 Context、SubjectState、Assistant Global Settings，也不接入 MCP、Tool 或 continuity-engine。

## BE-ADR-027｜扩展能力注册、权限投影与真实执行分层

- 日期：2026-07-28
- 状态：已采用，仅限开发期能力扩展管理基础
- 决策：Tool、MCP、Skill 和 Plugin 分别使用用户范围注册表保存最小元数据，创建时安全默认停用。Tool、MCP 与 Skill 以现有 Permission 的 `tool`、`mcp`、`skill` 资源类型声明所需操作；Capability Service 按主体只读预览 Permission，不消费 `allow_once`。Plugin 当前只登记版本与依赖，不扩张 Permission 资源枚举，也不实现安装或代码加载。Tool 的“执行准备”只串联注册状态、Permission、Security 与 Confirmation，并追加 `tool_usage_records`；数据库约束执行状态只能为 `not_executed`，接口不接收实际执行参数。
- 原因：注册或启用只说明平台知道一项能力，不能被误认为外部服务已连接、插件已安装或工具已运行。先固定目录、主体权限视图、安全门槛和可审计记录，可以验证隔离与治理流程，同时避免在缺少执行沙箱、供应链校验、秘密注入、撤销和失败恢复设计时产生真实副作用。
- 影响：MCP 响应固定 `not_connected`，Plugin 固定 `not_installed`，Skill/Tool 固定 `not_implemented`；Tool 准备结果只能为 `ready`、`confirmation_required` 或 `denied`，即使为 `ready` 也明确未执行。使用记录保存权限/安全决策、最小结果摘要、关联 AuditLog 和零外部调用消耗，不保存输入、输出或秘密。未来真实 MCP 客户端、Plugin 安装器、Skill/Tool 执行器必须使用新的受信适配层和独立 ADR，并重新审查 Plugin 权限、供应链安全、幂等、超时、撤销、审计与用户确认语义；当前不连接设备、第三方服务、模型或 continuity-engine。

## BE-ADR-028｜设备注册、适配契约和设备执行严格分离

- 日期：2026-07-28
- 状态：已采用，仅限开发期设备适配基础
- 决策：Device Registry 只保存用户范围的七类设备、品牌、名称、启停状态、Adapter 类型与四种能力关系，不保存厂商设备 ID、位置、凭据或真实状态。Xiaomi、Midea、Apple、Android 与 Generic 只实现统一 Adapter 契约描述，所有连接、状态读取和执行方法均标记不支持。设备能力映射到现有 `device` Permission 的 `read` / `control` action；操作准备固定通过 `Security(device_control)` 与 Confirmation，随后原子追加最小 `device_changed` Event 和 `device_operation_logs`。数据库约束执行状态只能为 `not_executed`。
- 原因：注册、适配器选择、安全准备和真实设备副作用属于不同信任层。缺少厂商认证、设备身份校验、秘密存储、撤销、超时、幂等、状态可信度及隐私治理时，不能让“已启用”或“确认通过”被误认为设备已连接或已受控。先建立不含执行参数的稳定契约，可以验证用户/主体隔离、权限、极高风险确认、事件和日志一致性，而不触碰真实手机、摄像头、家电或穿戴数据。
- 影响：Device 创建默认停用；所有响应固定 `not_connected`、`not_observed`、`not_implemented`。`connection_registered` 只表示连接元数据登记，`registry_status_changed` 只表示注册状态变化，`operation_requested` 只表示安全准备请求。设备操作即使返回 `ready` 也不执行，不接收参数，不调用 SDK 或厂商 API。设备授权复用 Permission 表而不建立重复授权表；同一设备映射到相同 action 的能力共享 Permission 范围。未来每个真实厂商 Adapter 必须新增独立 ADR，覆盖设备身份、凭据、数据分类、状态签名、超时/重试/幂等、立即停止、撤销、离线行为、审计和安全测试。

## BE-ADR-029｜用户安全策略是 Permission 之后的收紧层

- 日期：2026-07-28
- 状态：已采用，仅限开发期自定义安全栏
- 决策：基础执行顺序固定为 Permission → Security Policy → Confirmation → execution preparation。Security Policy 以用户、资源类型、动作和有效风险等级精确匹配，不能将 Permission 的拒绝改为允许。用户偏好可以抬高默认风险、禁止范围、控制低/中风险自动确认和定义高风险策略；平台仍强制 `high` / `critical` 每次确认。`session_allow` 只有在明确确认被完全匹配的安全检查消费后，才生成绑定用户、主体、策略版本、安全会话、资源实例、动作和风险的 30 分钟授权；安全会话 ID 不是身份凭证。策略或偏好版本参与 Confirmation 指纹，策略更新使旧确认和授权失配。
- 原因：基础授权、用户安全偏好和具体高风险操作确认是不同信任层。若策略可以放宽 Permission 或平台底线，配置错误会直接扩大权限；若“会话允许”只依赖客户端字符串，也会成为可伪造的长期放行。精确、短时、确认后生成且版本绑定的授权能保留用户便利性，同时维持默认拒绝和防重放边界。
- 影响：新增 `security_policies`、`user_security_preferences`、`security_policy_session_grants`，Confirmation 增加策略版本、会话、原因、风险说明与用户选择。Permission 生命周期事件拆分为 `permission_created`、`permission_changed`、`permission_revoked`，新建确认产生 `confirmation_required`；策略/偏好变更和最终安全结果进入最小 AuditLog。全部响应仍固定未执行；没有真实 Tool、设备、外部服务或认证会话。SQLite 父表重建仅允许迁移首行显式声明关闭外键，并必须在提交前通过 `PRAGMA foreign_key_check`。

## BE-ADR-030｜AI 私域独立存储、不可变版本与安全门分层

- 日期：2026-07-28
- 状态：已采用，仅限 AI 私域数据基础
- 决策：AI Private Space 使用独立于 User Space 的 `assistant_private_spaces` 与 `assistant_private_content_versions` 表。`assistant_id` 映射已有 Subject；每个用户与助手最多一个 Space。五类正文只接受调用方显式 JSON 输入并按 `content_id` 追加不可变版本，`baseVersionId` 防止陈旧写；Event 和 AuditLog 不复制正文。创建空 Space 是生成精确 `spaceId` 的引导操作，不接收或读取正文；Space 建立后，元数据读取、正文读写、状态管理、Context 投影和导出准备分别使用 `private_domain` 的 `read`、`write`、`manage`、`export` 权限，并固定经过 Permission → Security Policy → Confirmation。通用 Conversation Context 不自动读取私域，私域使用独立受控投影接口。导出阶段只返回不含正文的版本清单，不生成文件。
- 原因：若私域与普通用户内容混存、自动进入通用 Context 或把正文复制到事件/日志，会扩大高敏感数据的暴露面。Space ID 又必须先存在才能创建精确资源权限，因此需要一个不含内容的受限引导步骤。不可变版本同时满足来源、版本和未来迁移需求，而不把当前阶段扩展为披露决策、意识或自主行为系统。
- 影响：新增迁移 `013_create_ai_private_spaces.sql`、十五类 Event、私域仓储/服务/API 和隔离测试。所有私域安全检查分类为高风险并逐次确认；安全结果保持 `not_executed` 以表明没有外部副作用，批准后只执行本地数据库操作。当前不实现目录申请/开放结果、删除、真实文件导出、生产加密、模型/continuity-engine 生成、机器人或外部服务连接；这些能力必须分别形成后续 ADR。

## BE-ADR-031｜生活数据使用独立表、最小货币单位与统一高敏感安全范围

- 日期：2026-07-28
- 状态：已采用，仅限生活管理基础
- 决策：财务、月历、身体与本地记忆分别使用专用 User Space 表，并全部保存 `user_id + subject_id` 复合归属。Permission/Security 新增 `life_data` 资源类型，以 `finance`、`calendar`、`body`、`local-memory` 四个主体范围资源 ID 管理读写。敏感操作固定使用 `sensitive_data_access + private_record`，因此至少为高风险并逐次确认。金额以最小货币单位整数存储，API 以两位小数字符串返回；月度汇总按 UTC 月份确定性计算。生活 Event 只保存模块、记录 ID 和变化类型。
- 原因：财务、健康、生理期、亲密记录和本地记忆不能借用 AI 私域或通用 Memory 的语义，也不能依赖浮点金额。集合级稳定资源范围解决“记录创建前尚无记录 ID”的授权先后问题，同时保持用户/主体隔离。将统计限定为本地确定性计算，可在不接银行、设备或模型时提供可验证闭环。
- 影响：新增迁移 `014_create_life_management_foundation.sql`、`life_data` 安全资源、两类事件以及生活管理仓储/服务/API。AI 建议字段只接受调用方显式文本；趋势只是数值差，不构成医疗诊断。本地记忆 Context 使用独立安全投影，不自动注入通用 Context。当前不实现支付、银行/设备同步、自动提醒执行、删除或真实文件导出；未来接入必须新增安全与合规决策。

## BE-ADR-032｜User Space 保存当前助手，资源访问先验证复合归属再进入安全链

- 日期：2026-07-28
- 状态：已采用，仅限开发期账号与数据隔离基础
- 决策：每个 User 必须有且只有一个 `user_spaces` 根记录，保存开发期身份模式、空间状态和可空 `current_assistant_id`。User 与 User Space 原子创建；首个 Subject 在指针为空时自动成为当前助手，后续切换只更新该指针。Assistant Global Settings、Assistant Private Space 和 SubjectState 继续使用独立表及用户/助手复合归属，绝不因切换而复制、合并或改写。统一数据隔离仓储只允许预定义资源类型和固定 SQL 查询，并在数据库查询中带齐用户、助手与资源 ID；敏感的私域、设备和生活数据必须在归属命中后继续经过既有 Permission → Security Policy → Confirmation。
- 原因：仅由 URL 或应用层先按全局 ID 取记录、再比较所有者，容易在新增模块时产生遗漏和存在性泄露；把“当前助手”存进 Subject 又会把用户导航偏好混入助手身份。独立 User Space 指针与固定复合查询既能支持多助手切换，也能保持各助手长期设定、动态状态和私域边界不变。所有权与授权是两类判断：所有权错配必须先按未找到终止，所有权成立也不能绕过高敏感安全规则。
- 影响：新增迁移 `015_create_user_spaces_and_data_isolation.sql`、User Space/数据隔离仓储与服务，以及空间、助手切换、边界描述和资源预检 API。迁移为既有用户回填空间并稳定选择最早活动助手；User Space 身份固定标记 `development_unverified`，不把 URL、请求头或安全会话 ID 当作认证。访问检查只返回 `ready`、`confirmation_required` 或 `denied` 且固定未执行。真实登录、第三方身份、生产行级安全、数据库租户分区、语音和外部服务仍需后续独立决策。

## BE-ADR-033｜主动交互采用“配置、预算、安全准备、真实执行”四层分离

- 日期：2026-07-28
- 状态：已采用，仅限主动交互与 Token 控制基础
- 决策：Wake、主动提示、Token Budget 和助手后台策略均按 `user_id + subject_id` 独立保存。`voice` 只是一种 Wake 元数据类型，用户授权只表示 Vio Live 应用内选择，不等于麦克风或系统权限。主动提示必须引用同范围 Event，消息优先级只决定准备记录排序与静默抑制；`requires_confirmation` 把安全最低风险抬高到 `high`。每日/会话预算只根据显式上报的 Token 使用账本判断，超额使用 `block`、`defer` 或高风险确认。Wake、提示和需确认的超额请求统一使用精确 `proactive_interaction` Permission → Security Policy → Confirmation；所有结果固定不执行。
- 原因：浏览器配置、操作系统唤醒、模型生成和消息投递是不同信任边界。若“启用语音”直接等同于麦克风监听，或预算检查直接触发模型，会在缺少系统权限、模型适配和费用凭证时产生不可验证副作用。把显式计量元数据与平台真实调用状态分开，也可避免测试数据被误认为供应商账单。
- 影响：新增迁移 `016_create_proactive_interaction_and_token_controls.sql`、四类 Wake、四级消息优先级、主动提示准备记录、Token Budget/Usage、后台策略及六类最小 Event。Permission/Security 增加 `proactive_interaction` 资源；Security 接受只能抬高风险的内部最低风险提示。Token 使用记录固定 `explicit_api_input`、`not_performed_by_platform`、`not_billed`。当前不申请麦克风、不监听音频、不注册系统唤醒、不运行后台调度、不投递消息、不调用模型或外部服务。

## BE-ADR-034｜导出采用版本化 Schema、两步安全准备与零载荷记录

- 日期：2026-07-28
- 状态：已采用，仅限数据导出与未来迁移基础
- 决策：平台以 `vio-live-export-v1` 登记 `full`、`selected`、`migration` 三类 Export Schema，以及用户数据、SubjectState、Event、MessageVersion、ConversationSummary、AI 私域、助手全局设定、Permission、Security Policy、Tool、Device、生活数据十二类范围。导出创建只生成用户/主体范围记录，并检查复合归属、必需字段与数据库外键；不读取或复制正文。由于精确 Permission 需要先取得 `exportId`，安全流程分为“无数据预检记录”与“`data_export:export` Permission → Security Policy → 高风险逐次 Confirmation”两步。通过后结果只到 `ready`，数据库固定载荷未生成、文件未创建、外部存储未连接、迁移未执行。
- 原因：导出既是用户数据权利，也是高敏感、跨模块读取操作。若在生成资源 ID 前直接读取数据，权限无法精确绑定；若把 `ready` 当成文件或迁移已完成，会把安全资格误表示为外部副作用。版本化 Schema 和只含计数/关系检查的记录能先稳定兼容边界，同时避免把消息、摘要、状态、私域或生活正文复制到审计与导出历史。
- 影响：新增迁移 `017_create_data_export_and_migration_foundation.sql`、Export Schema/记录仓储与 API，Permission/Security 增加 `data_export`。机器人与其他载体仅提供未配置契约，接口不接受地址、凭据、设备 ID、控制参数或业务数据；迁移准备不持久化授权、不连接、不传输、不执行，未来真实生成/下载/外部存储/恢复/载体迁移必须新增独立执行适配器、重新安全检查并形成 ADR。前端 `src` 不变。

## BE-ADR-035｜continuity-engine 是 SubjectState 唯一权威源，Vio 只保存受控投影

- 日期：2026-07-29
- 状态：已采用；v1.1 已正式接受，Engine E1—E4 与 Vio V1—V3 已完成，S2/S3 正式本机 HTTP/JSON 共享验收已通过
- 决策：continuity-engine 是 AI `SubjectState` 的唯一权威来源。状态只能由引擎在 Wake、Perception、Thinking、Action、Learning 和 Evolution 约束下，以引擎 Event、`expected_revision` 和可审计差异推进。Vio 现有 SubjectState 数据层在接入后只保存带引擎 `subjectId`、schema、revision、update ID、请求/来源和内容哈希的受控投影、快照、缓存或审计历史；Vio 不自行推演状态，也不把 Vio Event 直接转换为状态修改。状态不一致时以引擎为准，Vio 的历史 `state_update` 不能回灌覆盖引擎。现有开发调用方状态写入口属于接入前遗留能力，后续必须改为内部受信投影入口或停用，历史记录需单独迁移标记。
- 前端边界：Vio 前端只能连接 Vio 平台后端。Vio 负责用户身份、复合归属、Permission、Security Policy、Confirmation、Token、会话落库和安全能力通道；若前端直连引擎，将绕过这些平台控制，也会把引擎地址、错误和内部状态暴露成不稳定的产品接口。
- Context 边界：Vio Context Service 只提供经过权限筛选、带来源和分类的平台事实包，不组织最终认知 Context。continuity-engine 结合权威状态、引擎 Memory、Wake/Perception 和学习历史组织唯一的最终认知 Context。两边各自组装最终 Context 会造成事实选择、安全规则、Token 计算和状态因果分叉，因此禁止双重装配；AI Private Space 只能以本次目的获批的最小投影进入事实包，不能整库注入。
- 引擎不可用：Vio 可以保存用户消息、平台 Event、待投递 Observation、请求状态和最后确认的状态快照，也可以把快照标为陈旧后只读展示；不能自行生成并冒充 AI 回复、推进 SubjectState revision、把 Vio Event 当作状态变化、用旧快照另组最终 Context 调用模型，或自动写入引擎派生的 AI 私域内容。
- 原因：引擎源码已把状态变化收口到 Event → StateMutation → Evolution，并用 revision 和重复 Event 检查保护因果链；Vio 当前 SubjectState 只保存调用方提交的版本，没有引擎 revision、update ID 或演化约束。若两个系统同时拥有写权威，会产生两套人格/情绪/意图真相，且无法可靠处理乱序、重试、回滚和学习。平台事实与认知解释也属于不同信任边界：Vio最了解用户授权和数据归属，引擎最了解状态演化和认知选择。
- 接受结果：历史审核曾因第一轮机器契约歧义暂不接受；Vio 随后以纯文档修订固定三份严格 Schema、正式 conformance vector、SubjectBinding fixture、哈希、幂等/revision/错误/投影和独立 ContractTestAdapter 入口。Continuity Engine 在《Engine Contract Final Read-Only Short Confirmation v1》中确认现行差异闭合、未发现新的架构问题，并正式接受 v1.1；该确认没有改变长期权威边界。
- 影响：Vio V1 已实现 PlatformObservation/fact/request 严格本地 Schema、固定 SubjectBinding/hash、RFC 8785 与输入持久化；Vio V2 已实现 operation/response/stateProjection 幂等接收、revision 隔离和投影账本；Vio V3 已实现正式本机 HTTP delivery/outbox。Engine E1—E4 与 crash-recovery 已实现，S2/S3 已证明正式本机链路在正常、机器错误、响应丢失、进程崩溃和双方重启后保持唯一 operation、Event、StateUpdateRecord、revision、result、projection 与 receipt。该实现没有改变 legacy `state_update`，也没有让 Vio 创建状态更新。真实模型/Capability、公共对话 API、前端接线、生产认证、多租户和部署仍需后续阶段。
- 契约：当前权威设计见 `docs/后端/14-continuity-engine连接契约v1.1.md`，最终接受证据见 `docs/后端/14c-Engine-Contract-Final-Read-Only-Short-Confirmation-v1.md`。契约、正式本机连接与共享验收均不表示真实模型、公共对话 API、前端试用或生产部署已经完成。

## BE-ADR-036｜Capability 模型执行采用独立可靠账本与 Engine 回传闭环

- 日期：2026-08-10
- 状态：已采用，仅限 Vio V4；S4 双仓共享验收已完成
- 决策：Vio 只在 Engine E5-A 返回通过严格校验的 `capability_required` 后执行模型能力。CapabilityRequest、CapabilityResult、`capability_required` 与 `capability_failed` 的外层合同固定为 `continuity-capability/v1`；`completed` 仍属于 `continuity-integration/v1.1`。用户、助手、主体和消息归属必须从不可变 V1 原请求反查，Engine 的 `permissionRef` 仅作关联；现实层固定经过 `chat` Model Router、`api:<providerId>:execute` Permission、`privacy_access_request + private_record` Security/Confirmation 和以 `originatingSessionId` 为会话标识的 Token Budget。模型候选不能直接写入 Message 或状态，只能成为严格、无包装层的 CapabilityResult 回传 Engine，再由 Engine 恢复 Thinking/Action Gate 并生成最终结果。
- 持久化：新增迁移 `021_create_continuity_capability_execution_ledger.sql`，将 CapabilityRequest inbox、门控决策、0..N 个模型 execution、每次独立 usage/费用、完整 canonical Result、回传 outbox/attempt 和 incident/quarantine 与 V1/V2/V3 账本分开。一个 request 可在一个或多个 `FAILED_RETRYABLE` 后产生一个 `SUCCEEDED`，但每次真实调用必须使用新的 execution/result ID，历史失败不可覆盖，且数据库只允许一个成功结果。旧 `explicit_api_input/not_performed_by_platform/not_billed` 使用记录保持原义，V4 只把唯一 execution 的 `provider_reported` usage 纳入后续预算累计。
- Provider 与密钥：本阶段仅实现 `openai_compatible` 非流式 HTTP adapter；其他接口格式 fail closed，不自动 fallback，也不在失败后调用第二个模型。非测试带密钥调用必须使用 HTTPS，loopback HTTP 只供明确测试装配。SQLite 只保存受限 `env:VIO_MODEL_API_KEY_*` secretRef，密钥在调用瞬间解析；Provider 公共投影只显示配置状态，日志、响应、测试 fixture 和 Git 均不得出现密钥、Authorization、完整请求正文或原始响应正文。
- 失败边界：HTTP 回传重传和 Provider 真实重试是两套状态。POST 响应未知先查询，若需要重发，只能重发同一已持久化 Result。Engine 明确接受 `FAILED_RETRYABLE` 后请求进入 `waiting_retry`，默认不自动调用；内部明确 `retryApproved=true` 后仍须重新通过路由、权限、安全、预算和 deadline，才生成新 attempt。`UNKNOWN` 被接受后进入 `provider_outcome_unknown`，当前无 Provider reconciliation 能力，因此保持 fail closed，不重发已接受 Result、不再次调用。`FAILED_TERMINAL/CANCELLED/EXPIRED/SUCCEEDED` 后禁止新执行。费用仅保存 Provider 报告或可证明配置计算结果，否则明确为 `not_reported/NULL`。
- 权威影响：Vio V4 不创建 Engine Event、StateMutation、SubjectState 或 revision，也不改写 legacy `state_update`。Engine 仍是主体状态和最终表达的唯一权威；V1、V2、V3 的事实与幂等语义保持不变。S4 shared test 已完成；当前未新增公共对话 API、前端接线、MCP/Tool/设备或真实供应商验收。

## BE-ADR-037｜公共对话轮次只编排既有账本，最终回复必须来自 Engine 稳定结果

- 日期：2026-08-12
- 状态：已采用，仅限 Vio V5 固定本地试聊 Profile
- 决策：公共轮次以独立 `continuity_conversation_turns` 协调账本关联 Conversation、唯一用户 Message/MessageVersion/Event、预分配 requestId、V1 原请求、V3/V4/V2 状态和唯一主体 Message。它不复制 V1 canonical 请求、V2 result/projection、V3 outbox 或 V4 execution/result。`Idempotency-Key` 在当前入口全局唯一，同一 key 只有在用户、助手、会话和正文 hash 全部一致时精确重放。一个 Engine subject 同时只允许一个非终态轮次；轮次计划、V1 持久化、V2 完成、主体 Message 发布和轮次完成之间的每个崩溃窗口都从已落盘 checkpoint 恢复。
- 回复权威：Provider 候选只能作为 CapabilityResult 返回 Engine。V5 只能从 V2 已严格验证并持久化的 `FirstRoundSuccessResult.response.content` 创建 `senderType=subject` 的 Message，并同时固定 operationId、responseId 和消息版本关联；Provider 原始候选、Vio 本地拼接文本或 legacy SubjectState 均不能成为最终回复。Engine 仍是 SubjectState、revision、Event/StateMutation/Evolution 和主体表达的权威。
- 版本投影：Turn 是不可变执行事实，其公共 user/subject Message 投影必须按账本保存的 `message_id + message_version_id` 读取精确 MessageVersion，正文、发送者和版本 ID 不跟随 Message 的 `current_version_id`。Message 只提供稳定排序与原始创建时间；锁定版本缺失或复合归属/发送者不一致时 fail closed。通用编辑或重生成可以继续追加历史版本，但不能替代既有 Turn 的用户输入或 Engine/V2 最终回复。
- 公共与身份边界：V5 只提供固定本地 Profile 的 create/get/resume 三个轮次路由，使用开发期 `x-vio-user-id` 与路径 userId 精确匹配，不把它描述为认证。固定 Profile 由显式本地脚本幂等准备，冲突时 fail closed；不提供通用 Binding CRUD。GET 是纯查询；确认和 Provider retry 必须经 resumption 显式触发。Engine 未启用时在任何轮次事实落库前失败。
- 影响：新增迁移 `022_create_continuity_conversation_turn_ledger.sql`、轮次仓储/服务、固定 Profile 准备服务/CLI 和 V5 专项/shared tests。F1 前端接线、真实供应商 live smoke、通用 Binding、生产认证、多租户、流式输出和部署仍需后续独立阶段；V5 完成不等于产品可公开使用。

## 待形成的 ADR

以下事项是进入下一阶段前的阻塞性决策：

1. Google 登录、邮箱验证码和会话机制
2. 正式数据库产品、备份、并发和生产迁移方案
3. 完整 API 契约、分页、兼容和版本治理
4. 生产级外部密钥管理、轮换审计和非环境变量 credential store（V4 已固定最小环境变量引用）
5. 部署平台、环境划分和配置管理
6. 生产数据库行级安全、租户分区和最低隔离覆盖要求
7. 生产日志、监控、审计保留周期、法定可见范围和完整脱敏方案
