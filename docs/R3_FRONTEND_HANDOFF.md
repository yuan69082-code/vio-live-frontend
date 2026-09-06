# R3 前端交接

状态：总体协调窗口已于 2026-09-06 正式验收 R3 通过。前端代码、专项、全量回归、类型检查、生产构建、受控本机页面联调和后端串行总复验均已完成；本文记录实际交接与复验证据，不表示 R4 或后续阶段已开始。

## 唯一接口来源与边界

- 唯一合同：`backend/docs/R3_MULTI_CONVERSATION_CONTRACT.md`。
- 身份只来自 R2 `vio_personal_session` 与服务端当前助手。R3 路径、请求体和产品组件不发送 `userId`、`assistantId`、`subjectId` 或开发身份头。
- 个人主入口的六导航仍保留；“对话”切换到 R3 多会话页面。旧固定 Profile 页面及其历史测试保留，但个人入口不再加载它。
- 浏览器只在 `sessionStorage` 保存随机幂等键和恢复所需的不透明索引；不保存消息正文、附件内容、完整响应、口令或供应商密钥。
- 本阶段不读取或连接 Continuity Engine，不调用真实供应商，不读取真实凭据，不实现 R4 上下文/记忆、R11 全量导出备份或部署。

## 页面与接线矩阵

| 页面位置 | 动作 | 真实接口 | 服务端令牌/权限 | 成功结果 | 失败与恢复 | 前端证据 |
| --- | --- | --- | --- | --- | --- | --- |
| 对话页头 | 打开会话目录 | `GET /chat/conversations` | 当前会话、当前助手；`selectionVersion` | 显示服务端列表、当前项和游标 | 读取失败可重试；筛选变化不重置当前会话 | `PersonalMultiConversationPage.test.tsx` |
| 会话目录 | 搜索、筛选、排序、翻页 | `GET /chat/conversations` | 游标绑定当前筛选与作用域 | 追加去重后的下一页 | 条件变化从第一页重读；旧请求由作用域代际隔离 | 同上 |
| 会话目录 | 新建 | `POST /chat/conversations` | `Idempotency-Key` | 新会话进入列表但不擅自选中 | 未知结果先按原键查询；确认未接收后才同键重试 | 同上；`personal-multi-chat-recovery.test.ts` |
| 会话目录 | 选择 | `POST .../selection` | `expectedSelectionVersion` | 服务端当前会话与历史同步 | 选择冲突重读；旧响应不污染新助手 | 同上 |
| 会话目录 | 重命名、归档、恢复、删除 | `PATCH .../{id}`、`POST .../archive|restore|deletion` | `conversation.version`、幂等键；删除固定确认值 | 以后端返回和重读结果为准 | 冲突重读；未知结果按原键查询；删除不伪装为物理抹除审计事实 | 同上 |
| 消息区 | 编辑用户消息 | `PATCH .../messages/{id}` | `baseVersionId`、分支作用域、幂等键 | 追加并选择 `edited` 版本 | 版本冲突重读；不改写原版本 | 同上 |
| 消息区 | 重新生成 | `POST .../regenerations` 与 R2 confirmation | 当前分支/版本、全套模型/权限/安全/预算规则；批准后使用新操作键 | 只显示后端发布的 `regenerated` 版本与真实 execution 结果 | 安全/预算确认先显示；拒绝不调用；未知 Provider 边界保留原键且禁止盲重试 | 同上；API 解析测试 |
| 消息区 | 版本查看/选择 | `GET .../versions`、`POST .../version-selection` | `expectedBranchVersion` | 切换当前分支投影，不删除其他版本 | 空态、读取失败、版本冲突均显式显示 | 同上 |
| 消息区 | 隐藏消息 | `POST .../messages/{id}/deletion` | `expectedBranchVersion` | 当前分支追加 tombstone | 不物理删除 Message/MessageVersion；失败不显示完成 | 同上 |
| 消息区 | 从这里重来 | `POST .../branches` | 源分支与可见消息 | 新子分支成为该会话当前分支 | 原分支不变；迟到响应受代际隔离 | 同上 |
| 分支面板 | 列表、切换、清空可见窗口 | `GET .../branches`、`POST .../selection|clear` | conversation/branch 版本 | 切换真实分支；清空只追加可见边界 | 归档会话只读；冲突重读 | 同上 |
| 输入区 | 发送 | `POST .../turns` | 当前会话/分支、单次幂等键、R1 安全墙 | 显示后端用户消息、轮次与助手回复 | 重复点击锁定；响应丢失先按 key/turnId 查询；404 后才同键重试 | 同上 |
| 轮次状态 | 查询、批准、预算确认、安全重试、终止 | `GET .../turns`、R2 confirmation、`POST .../recovery` | 原 turnId、原恢复键 | 以后端轮次状态为准 | 终止失败、结果未知、可安全重试分别显示；恢复响应未知先查询原轮次 | 同上 |
| 输入区 | 图片、文件、音频 | `POST .../attachments` | 前端 SHA-256/字节数；后端 MIME、大小、路径和归属校验 | 上传完成后仅把 attachmentId 交给发送接口 | 单个 10 MiB、本轮 20 MiB；失败不加入待发送；未关联附件可真实移除 | 同上；API 测试 |
| 会话工具 | JSON/Markdown 导出 | `POST .../exports` | 当前会话/分支、幂等键 | 下载服务端生成并校验过的单会话内容 | 丢响应后从 operation `result` 恢复下载；不声称完成 R11 | 同上 |
| 错误状态 | 配置跳转 | 六导航中的“能力”或“我的” | 服务端稳定错误码 | 进入真实已有页面 | 模型、Provider、Vault、凭据、权限和预算错误不显示假成功 | 同上 |

## 并发与恢复规则

- 每次写操作使用独有内存锁令牌。助手/身份变化会中止旧请求并递增作用域代际；旧请求的成功、失败和 `finally` 均不能解锁或覆盖新作用域。
- 同一时刻只保留一个未确认写操作。新动作不能覆盖旧恢复索引。
- 普通写和 turn 创建在响应未知时保留原随机键；先查询服务端事实。只有明确 404 才允许用原键和原动作重试。
- turn 恢复在响应未知后先读取原 `turnId`。状态未变化时才允许复用原恢复键；状态已变化则接受服务端事实，不再重发。
- 助手或会话变化会清理输入、待发送附件、确认面板和旧页面内存；切回助手会重新读取其服务端当前会话与历史。
- 退出、会话失效或登录身份变化会按 owner 清理 R1/R3 恢复索引，不清理无关浏览器数据。

## 已记录的首轮失败与修复

第一次 R3 前端专项运行得到 3 个文件中 11 通过、3 失败：会话抽屉测试存在读取竞态；重复测试版本 ID 触发 React key 警告；失败轮次显示原错误码而非用户状态。修复测试夹具和真实状态映射后，第二次为 12 通过、2 失败，第三次为 13 通过、1 失败。最后一个失败确认是筛选条件错误触发整个助手作用域重置；分离筛选读取与作用域重置后，专项达到 14/14，且无未处理 Promise 或 React warning。随后 `pnpm run typecheck` 通过。

继续静态审查又修正了以下普通缺陷，均已纳入最终专项与全量回归：

- 旧助手写请求的迟到 `finally` 可能清掉新助手写锁，已改为每次写操作独有令牌。
- turn 响应丢失恢复后未清理已被服务端接受的输入与附件，已改为接受事实后清理。
- turn 恢复操作不应查询普通 R3 operation 后盲重发，已改为先查询原 turnId，再决定是否允许同键重试。
- 重新生成的安全/预算确认、确认响应丢失恢复和 Provider `outcome_unknown` 原先未完整展示，已补齐。
- 会话切换后待发送附件可能沿用到另一会话，已在服务端会话 ID 变化时清理。
- 相同文件名可能造成 React key 警告，已使用位置与名称组合键。
- 同一助手内较慢的旧会话详情或目录请求可能覆盖新会话/新筛选，已增加彼此独立的列表与详情请求序号；旧成功、失败和附件名称读取均不能污染新视图。
- 轮询读取到 `waiting_confirmation`、`retryable` 等状态后页面仍保留旧的“处理中”对象，已改为先采用服务端最新 turn，并仅对仍处于处理中的状态继续轮询。
- 附件删除丢失响应后虽能确认服务端完成，托盘仍可能保留旧附件；恢复索引现仅增加不透明 `attachmentId`，确认完成后移除托盘项，不保存附件正文。
- 会话目录读取与聊天详情共用错误状态，较晚成功的目录读取可能清除详情/发送错误；现已拆为目录专用错误和真实重试入口。
- 后端已确认列表的 `selectionVersion` 属于正式返回，R3 operation 从创建时即有非空 `resourceType`、仅完成前 `resourceId` 可空；前端严格解析与冻结合同一致。

本轮专项首次复跑为 26/27：唯一失败是测试在分支列表仍处于加载状态、按钮依法禁用时立即点击“清空当前可见窗口”，因此真实产品没有发出 `clearBranch`。修复仅让测试等待按钮启用后再明确确认；保留原生高风险确认与 `clearBranch` 调用断言，未降低要求。复跑达到 27/27。

补充真实浏览器验收又发现并修复两项普通缺陷：

- 受控 Provider 返回 429 后，页面仍保留已经批准、不可再次使用的重新生成确认。现对所有终态 Provider 结果立即清除该确认，用户可以发起使用新随机操作键的新一次重新生成。修复后的页面专项曾达到 19/19；真实页面复验显示 `PROVIDER_RATE_LIMITED`、确认框关闭，随后新操作成功。
- 批准重新生成后的 HTTP 响应丢失时，页面仍暴露已经消费的批准按钮，可能在查询服务端事实前再次调用确认。现于批准前关闭确认，将 `confirmationId` 只作为不透明恢复索引保存，并只允许“按原键查询”。新增回归第一次运行 19/20；唯一失败是断言期待网络错误文案，而注入的是 `request_timeout`，页面正确显示“请求超时，当前结果未知”。断言改为精确超时映射后页面专项 20/20、R3 三文件专项 29/29。真实页面复验确认批准响应丢失后确认框为 0、只显示按原键查询，恢复后只有一个新版本且 Provider 调用只增加 1 次。

## 实际浏览器动作证据

| 动作 | 请求/服务端事实 | 页面结果 |
| --- | --- | --- |
| owner-a 登录并进入六导航“对话” | 真实 R2 session cookie；未发送固定 user/assistant header | 进入 `对话 | Vio Live`，显示服务端当前助手 |
| 搜索、排序、游标翻页 | A1 预置 51 条；搜索 `Search Needle` 仅返回目标；第一页 50 条 | 排序切换生效，点击“加载更多会话”后 50→51 且无重复 |
| 新建、选择、重命名、归档、恢复 | 对应 R3 写接口与版本令牌；每步均以后端重读为准 | 名称更新；归档进入“已归档”；恢复后回到“进行中”；删除确认取消后对象仍存在 |
| 发送与安全确认 | 用户消息先由后端创建；批准后受控 loopback 执行 | 显示真实用户消息和 `受控 owner-a R3 回答 1。`；提交期间按钮禁用 |
| 编辑、版本选择、重新生成 | 编辑追加版本；版本 GET 返回原始/编辑；重新生成使用服务端 confirmation | 可切回原始版本；生成版本带“重新生成版本”标记 |
| Provider 429 后重试 | 控制账本从 1 次调用变为 3 次：首次发送、一次 429、一次新操作成功 | 429 后无残留确认；新操作显示 `受控 owner-a R3 回答 3。` |
| 重新生成响应丢失 | 批准后丢弃一次 HTTP 响应；控制账本 `droppedResponses=1`，Provider 调用 3→4 | 页面显示结果未知、确认框 0；按原键查询后显示 `受控 owner-a R3 回答 4。`，无重复调用 |
| 同库重启 | `restart-active` 后 conversations/turns/messages/providerCalls 保持 54/1/2/4 | 浏览器会话恢复；返回对话后会话、用户消息和生成版本均存在 |
| 两用户 × 两助手隔离 | owner-a A1/A2、owner-b B1/B2 分别创建专属会话；切换 owner 会使旧 cookie 失效 | 每个作用域只显示自己的预置和专属会话；四个作用域互不泄漏 |
| 三类附件 | 真实上传 PNG/TXT/WAV 后随 turn 关联；后端导出给出三个 attachmentId 与 SHA-256 | 图片、文件、音频名称显示在真实用户消息；TXT 走图片入口被拒，11 MiB 文件被拒，附件数不增加 |
| JSON/Markdown 导出 | 服务端导出当前 Main 分支和当前版本 | JSON 含会话、分支、版本和三个附件元数据；Markdown 内容一致；均无密钥和绝对路径 |
| 发送响应丢失 | 丢弃一次 turn POST 响应；先按原 key 查询，再批准 | 结果未知时禁止盲重发；恢复后用户消息只出现 1 次，随后得到真实回复 |
| 终止待确认轮次 | owner-b/B2 新建 turn 后保持 `waiting_confirmation`，未调用 Provider；随后提交原 turnId 的 cancel 恢复动作 | 页面从“等待安全确认”进入“本轮已终止”，不显示助手假回复 |
| 隐藏指定消息 | 经用户动作时确认，对 owner-b/B2 专用用户消息提交 deletion；服务端保留 Message/MessageVersion 与 tombstone | 指定消息立即消失；刷新重读仍不可见，同分支其他消息在清空前保持可见 |
| 清空 Main 可见窗口 | 经用户动作时确认，原生确认框接受后提交 branch clear；服务端控制账本仍保留 3 条消息历史事实 | 页面进入“开始一段新对话”空态；刷新重读仍为空，未显示物理删除或清除费用的假提示 |
| 移除未关联附件 | 经用户动作时确认，真实上传 `r3-browser-file.txt` 后提交 attachment deletion；审计记录保留 | 上传时托盘显示 `ready`，移除后名称和按钮均消失；刷新重读仍不存在 |
| 删除专用测试会话 | 经用户动作时确认，删除 `R3 待删除专用会话`；最小操作和审计事实保留 | 删除后在进行中、已归档及刷新后的普通读取中均为 0；原当前会话未受影响 |
| 390×844 与控制台 | 校准后的实际 `innerWidth/innerHeight=390/844`；document/body clientWidth 与 scrollWidth 均为 390 | `horizontalOverflow=false`；页面 console warning/error 数量为 0 |

四项删除类浏览器动作只作用于用户明确批准的 `127.0.0.1` 全新隔离夹具。最终控制账本为 owner-a `conversations=55, turns=1, messages=2, attachments=0, providerCalls=4`；owner-b `conversations=7, turns=2, messages=3, attachments=1, providerCalls=1`。其中删除会话、隐藏消息、清空边界和删除附件均保留最小审计事实，因此账本总记录数不会冒充物理归零；普通读取和刷新投影已逐项验证不可见。全程 `engine=not_accessed`、`externalProvider=not_used`、`providerCharge=not_incurred`。

## 验证状态

- R3 专项：`pnpm test src/api/personal-multi-chat-api.test.ts src/api/personal-multi-chat-recovery.test.ts src/pages/PersonalMultiConversationPage.test.tsx`：3 个文件、29/29 通过。
- 前端全量：`pnpm test`：20 个文件、253/253 通过。
- 类型检查：`pnpm run typecheck`：通过。
- 生产构建：`pnpm run build`：通过；Vite 8.2.1 转换 138 个模块并生成生产资源。
- 前端最终变化完成后，后端窗口重新串行复验：R3 四文件专项 21/21；受影响 V1-V5 八文件组合 128/128；默认后端全量 420 项中 419 通过、0 失败、1 条既有 RFC 跨仓条件跳过。该跳过项未执行、不计为通过。
- 本轮真实浏览器使用暂停后重新创建的严格隔离 SQLite、真实 R2 个人会话和受控 loopback Provider；不复用旧 DB。服务端控制状态始终为 `engine=not_accessed`、`externalProvider=not_used`、`providerCharge=not_incurred`。
- 联调早期发现后端 versions GET 缺少 `messageId`、稳定 `createdAt` 和精确 `versionCreatedAt`；后端已按冻结合同补齐并回归，前端严格解析未放宽。
- 手机实机、真实供应商、真实凭据、公网部署：未执行，且不在本次授权内。

## 文件归属

前端新增：

- `src/api/personal-multi-chat-api.ts`
- `src/api/personal-multi-chat-api.test.ts`
- `src/api/personal-multi-chat-recovery.ts`
- `src/api/personal-multi-chat-recovery.test.ts`
- `src/pages/PersonalMultiConversationPage.tsx`
- `src/pages/PersonalMultiConversationPage.module.css`
- `src/pages/PersonalMultiConversationPage.test.tsx`
- `docs/R3_FRONTEND_HANDOFF.md`

前端局部修改：

- `src/App.test.tsx`
- `src/components/conversation/ConversationComposer.tsx`
- `src/components/conversation/ConversationHeader.tsx`
- `src/components/conversation/MessageBubble.tsx`
- `src/components/conversation/MessageList.tsx`
- `src/pages/MainNavigation.tsx`
- `src/pages/PersonalConversationPage.test.tsx`
- `src/state/PersonalContext.tsx`
- `src/styles.css`

不属于前端窗口的 `backend/**` 变更由后端窗口负责，前端未覆盖、暂存或清理。
