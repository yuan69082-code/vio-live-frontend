# R2 个人访问与配置接口交接

本文件由后端窗口唯一维护；前端交接见 [前端交接](../../docs/R2_FRONTEND_HANDOFF.md)。2026-09-04 开始实现；**总体协调窗口于 2026-09-05 正式验收 R2 通过**。个人身份、首次设置、多助手、资料、会话、访问审计/诊断、Provider/Model、加密凭据、认证连接检查及受控删除均已完成真实本机闭环。R2 十文件专项 53/53；默认全量 330 项（329 通过、0 失败、1 原有隔离跳过）；最终页面证据见[开发日志](开发日志.md)。邮箱、Google、公开注册继续暂缓；R1 独立聊天和 R3 多会话尚未开始。

## 边界与统一约定

- 个人自用；邮箱、Google、公开注册暂缓。R0 → R2 → R1 → R3–R13；不提前接独立聊天。六个导航保留。
- 所有身份来自服务端验证的会话，不接受客户端 userId 或开发身份头。旧数据不自动认领；旧无归属聊天恢复缓存保留但隔离，不重发、不导入、不静默删除。
- 个人会话可按归属读取旧接口，但助手设置/当前选择、Provider/Model/路由等 R2 所有的写操作必须走 `/personal`。旧写形状返回 `403 PERSONAL_WRITE_ROUTE_REQUIRED`，不能绕过安全确认、加密输入或 expectedVersion。V1–V5 旧聊天和服务层历史不重写；历史测试仅通过显式 test-support 依赖替身使用旧访问合同。
- 使用现有 `{success,data,error,timestamp}` JSON envelope。错误 `error.code/message/details` 脱敏；凭据、密码和正文不得写入错误详情。
- 同源 `/api/v1/personal`；Cookie `vio_personal_session`，HttpOnly、SameSite=Strict、Path=/。正式非 loopback 使用 HTTPS/Secure；本轮仅本机开发，不开放公网。
- 写操作除初始化/登录外须 `X-Vio-CSRF`，值从会话响应取得；服务器检查 Origin 与跨站标记，按配置的精确 origin（或本机开发来源）限制浏览器请求。401 立即清除当前 UI 身份和未完成请求；403 不替换为测试身份。
- `Idempotency-Key` 用于初始化、首次设置、助手创建和配置/连接测试/删除操作。相同用户/操作/键及内容精确复用；不同内容 409。取消 HTTP 只取消等待，不能把已提交事务当作撤销；恢复时用原键核对，不创建新业务键。已经受控撤销的删除申请原键返回 cancelled，不签新删除凭证或破坏后续合法会话。
- 头像只接受限制大小的 PNG/JPEG/WebP data URL（不接受 SVG/远程 URL）；保存为用户或助手各自资料，不混用姓名。
- 会话绝对期限 30 天、闲置期限 7 天；当前助手是服务端用户级选择，手机与电脑共享，列表响应带 selectionVersion，切换使用 expectedSelectionVersion，过期 409 后重读。
- 存储偏好 local/cloud/hybrid 仅是偏好，实际位置固定声明 `server_database`、cloudSync=false；不代表已部署或已完成备份。

## 个人访问与初始化

初始化资格必须由本机管理员 CLI 创建限时一次性邀请；HTTP 第一个访客没有任何所有权。随机服务端用户 ID，不使用固定 Profile、首个数据库用户或伪助手。旧开发用户完全保留并隔离。

| 方法与路径 | 输入 | data / 行为 |
| --- | --- | --- |
| GET `/access` | 无 | `{status: 'initialization_required'\|'authentication_required'\|'deletion_authentication_required', registration:'disabled'}`；不返回用户标识或秘密 |
| POST `/initialize` | `{invitation, passphrase, agreementVersion:'personal-use/v1'}`，Idempotency-Key | 建立唯一安装所有者，返回会话并设置 Cookie；邀请不是公开注册，过期/消费后拒绝 |
| POST `/sessions` | `{passphrase, deviceName}` | 验证后建立会话并解锁本进程凭据库；错误统一 ACCESS_DENIED，不泄露身份；有速率限制 |
| GET `/session` | Cookie | `{user:{userId,displayName,avatar}, session:{sessionId,expiresAt}, csrfToken,onboardingCompleted,currentAssistantId,selectionVersion,preferences,storage:{actualLocation:'server_database',cloudSync:false},vaultStatus}` |
| DELETE `/session` | Cookie、CSRF | 当前会话撤销、Cookie 清除；重复退出不创建新事实 |
| GET `/sessions` | Cookie | `{items:[{sessionId,deviceName,createdAt,lastSeenAt,expiresAt,current,status}]}`；不是设备控制 |
| DELETE `/sessions/:sessionId` | CSRF | 本人会话撤销；他人 404；撤销自己立即失效 |
| GET `/access-audit` | Cookie | 脱敏访问事件与异常提示，不含地址明文、凭据、请求或响应正文 |
| GET `/diagnostics` | Cookie | 身份/数据库/凭据库状态与版本，绝不返回路径、URL、环境或堆栈 |

## 首次设置、资料、多助手

| 方法与路径 | 输入 | data / 行为 |
| --- | --- | --- |
| POST `/onboarding` | `{displayName,avatar:null\|dataURL,assistant:{name,avatar,settings:{}},preferences:{storagePreference:'local'\|'cloud'\|'hybrid',contextMode:'balanced'}}`，Idempotency-Key | 原子保存资料、首个助手、偏好和完成标记，返回 session 视图；丢响应原键恢复，不新建助手 |
| GET `/profile` | 无 | `{userId,displayName,avatar,preferences,storage,version}` |
| PATCH `/profile` | `{displayName,avatar,preferences,expectedVersion}` | 乐观并发，版本不符 409，不覆盖他端结果 |
| GET `/assistants` | 无 | `{items:[{assistantId,name,avatar,settings,status,version}],currentAssistantId,selectionVersion}` |
| POST `/assistants` | `{name,avatar:null\|dataURL,settings:{}}`，Idempotency-Key | 返回准确创建记录；原键精确重放 |
| GET `/assistants/:id` | 无 | 归属校验后的助手记录 |
| PATCH `/assistants/:id` | `{name,avatar,settings,expectedVersion}` | 只改该助手设置，不迁移历史 |
| PUT `/current-assistant` | `{assistantId,expectedSelectionVersion}` | 仅切换选择，返回 assistants 视图；失配 409 |

`settings` 只接受 `{positioning,personality,persona,requirements,contextMode}`，前四项为最多 4000 字符的字符串，缺省为空；contextMode 可为 concise/balanced/complete/custom，缺省 balanced，偏好中的 contextMode 使用相同枚举。不把此设置冒称 R4 上下文实现。跳过高级设置使用默认值而非跳过持久化。name/displayName 最多 80 字符，口令 12–256 字符。头像 data URL 总长最多 180000 字符，服务端验证 PNG/JPEG/WebP 文件签名，不接受 SVG。

## 供应商、模型与凭据

| 方法与路径 | 输入 / 输出 |
| --- | --- |
| GET/POST `/providers` | 列表或创建 `{displayName,providerType,baseUrl,interfaceFormat,status}`；正式支持 openai_compatible，其他接口明确未实现，不伪装成功 |
| PATCH `/providers/:id` | 修改非秘密配置，expectedVersion 防止覆盖；权限、安全确认沿用服务层 |
| GET/POST `/models` | 现有 Model 字段；归属由会话确定，不接受 ownerUserId |
| PATCH `/models/:id` | 启用/名称/能力/默认 chat 路由配置；严格校验 provider 归属 |
| GET `/vault` | 解锁后 `{status:'ready',transport:{keyId,algorithm:'RSA-OAEP-256+A256GCM',publicKeySpki}}`；锁库返回 423 VAULT_LOCKED，公钥不是秘密读取接口 |
| POST `/vault/unlock` | `{passphrase}`，CSRF；正常登录已解锁，重启保留会话但进程无解密材料时须本人解锁 |
| PUT `/providers/:id/credential` | `{keyId,sealedCredential,confirmationId?}`；sealedCredential 见下混合加密，不能发送 apiKey/token/secret 明文字段；高风险确认响应见下 |
| DELETE `/providers/:id/credential` | `{confirmationId?}`；受控撤销，禁止 fallback，后续使用明确失败 |
| POST `/confirmations/:id/decision` | `{decision:'approve'\|'reject'}`；严格复用现有确认时效/消费/作用域规则，不由 permissionRef 代替授权 |
| POST `/providers/:id/connection-tests` | `{scope:'authentication',confirmationId?}`，Idempotency-Key；执行受限 `/models` 网络/认证检查，不调用生成接口、不声明生成能力通过 |
| GET `/providers/:id/connection-tests/:testId` | 稳定脱敏结果；成功、认证失败、超时、非法响应、危险目标分别明确 |
| GET `/operations?operation=…&key=…` | 按本人及原操作键查询 completed/confirmation_required/cancelled/not_found；已完成连接检查返回稳定 test，不产生网络重试 |
| POST `/operation-cancellations` | `{operation,key}`；仅未提交操作可成为 cancelled；已提交返回 completed，不把 HTTP abort 当作撤销已落盘事实 |

凭据保护：AES-256-GCM 密文落盘；随机库密钥由个人口令派生密钥包装，口令仅验证/解锁时在内存使用。重启不会从普通配置或开发环境偷偷找替代密钥。当前实现目标是跨平台加密文件/数据库格式，不声明已配好云端 KMS、自动无人值守解锁或备份。前端敏感输入在提交、取消、退出、换身份时清空，不写 localStorage/恢复缓存。

安全确认通用返回：`{operationStatus:'confirmation_required',security:{confirmation:{confirmationId,status,...}}}`；前端显示现有高风险说明，用户明确决定后带 confirmationId 重试原操作。不创建虚假助手；账户级权限/确认采用同一服务框架的账户作用域扩展。

### 配置精确字段（前后端统一）

- 本节所有配置写操作（含 PATCH/PUT/DELETE）须 Idempotency-Key，同一确认往返保留原键与内容，只增加 confirmationId。重复等待不创建第二条确认；确认绑定操作和完整非秘密内容 hash。完成返回 `{operationStatus:'completed',provider|model|test,security}`，connection test 完成的 security 可省略。
- Provider 列表 `{items:[...]}`；单项 `{providerId,ownerUserId,displayName,providerType,baseUrl,interfaceFormat,status,testStatus,createdAt,updatedAt,credentials:{apiKey:{status,storage,writeSupported}},version}`。字段使用现有 **interfaceFormat**，不是 interfaceType。公开字段无 secretRef/Key。凭据状态 not_configured/configured/locked/revoked/unavailable；UI 用固定“已配置”掩码，不显示秘密的前后缀或长度。
- Provider POST `{displayName,providerType,baseUrl,interfaceFormat:'openai_compatible',status:'enabled'|'disabled',confirmationId?}`；PATCH `{displayName,baseUrl,interfaceFormat,status,expectedVersion,confirmationId?}`。providerType 为现有 openai/claude/glm/custom，仅 openai_compatible 执行接口在本轮支持。
- Model 列表 `{items:[{modelId,providerId,modelName,modelType,capabilities,costDescription,testStatus,status,version,defaultForChat,createdAt}]}`；POST `{providerId,modelName,modelType,capabilities,costDescription?,defaultForChat:boolean,confirmationId?}`；PATCH `{modelName,modelType,capabilities,costDescription?,status,defaultForChat,expectedVersion,confirmationId?}`。modelName≤160、modelType≤80、costDescription≤2000；capabilities 使用现有 chat/long_text/vision/image/video/audio/search/embedding。声明模型能力不等于真实能力已验收。
- 凭据封装：临时随机 AES-256 key，AES-GCM 的 iv 为 12 字节、additionalData 为 UTF-8(keyId)；ciphertext 是 Web Crypto 输出（含 16 字节 tag）。RSA-OAEP/SHA-256 只加密 AES key。`sealedCredential={encryptedKey,iv,ciphertext}` 三项均标准 base64。密文仅允许在页面内存跨确认保留，完成/取消/换身份清除；keyId 因后端重启改变时重新输入，不持久化任何敏感草稿。
- Connection result `{testId,providerId,scope:'authentication',status:'running'|'succeeded'|'failed'|'outcome_unknown',reason,startedAt,completedAt,generation:'not_performed',providerCharge:'not_incurred'}`。GET 直接返回该对象；POST 返回 `{operationStatus:'completed',test}`。请求取消不等于取消已发出的检查，使用原 testId/幂等键恢复；不盲目重复网络请求。
- Audit `{items:[{eventId,type,occurredAt,anomaly}]}`。Diagnostics `{identity:'verified_personal_owner',database:'available',vault:'ready'|'locked',authentication:'session_cookie',externalCall:'not_performed',providerCharge:'not_incurred'}`。不显示内部路径、请求正文或服务器异常文本。

初始化 CLI：`pnpm run initialize:personal -- --database "<仓库外私有目录>/personal.sqlite" --invitation-file "<仓库外私有目录>/owner-invitation" --acknowledge-owner-initialization`。不启动服务、不调用网络；邀请仅写入指定新文件，不回显。先由本人限制目录访问权限，再运行；不是公网首访注册。邀请 15 分钟有效，用户自行在访问页输入邀请与个人口令，不发到聊天窗口。Windows 目录 ACL、后续服务器文件权限与 HTTPS 必须由运行方正确配置；本轮不声明已部署。

## 删除接口（2026-09-04 已确认政策，本次实施）

本节由后端唯一维护。7 天可撤销、实际删除后 14 天受管副本期限、30 天最小凭据期限已经确认，不再是政策阻塞。下列精确接口已实现；旧版未实现/待决定的历史记录保留在日志。

- `POST /deletions`：普通会话、CSRF、Idempotency-Key，正文 `{confirmationId?}`；复用账户级 `data_deletion / identity / delete` 高风险确认。未批准返回既有 `operationStatus:confirmation_required`，拒绝不申请删除；批准返回 `{operationStatus:'completed',deletion:DeletionStatus,csrfToken}`，同时撤销所有旧普通会话、清除普通 Cookie，设置独立 HttpOnly `vio_deletion_access` Cookie。操作名为 `delete-personal-space`，确认前可走既有 `/operation-cancellations` 取消；取消的旧键不执行，新申请须新键。
- `GET /access` 另有 `status:'deletion_authentication_required'`（等待/执行期）。`POST /deletion-access` 输入 `{passphrase}`，仅验证本人、设置删除专用 Cookie，返回 `{deletion:DeletionStatus,csrfToken}`；不解锁凭据，不授予业务权限。请求申请响应丢失或换浏览器，使用此入口恢复，不能借旧会话重试业务。失败 `401 DELETION_ACCESS_DENIED`，限速 `429 ACCESS_RATE_LIMITED`。
- `GET /deletions/current`：仅删除 Cookie，返回 `{deletion:DeletionStatus,csrfToken}`。`GET /deletions/:deletionId` 同样限于 Cookie 绑定任务；不显示正文、凭据、其他账户或路径。实际账户已删除仍可使用原删除 Cookie 查看 30 天内结果；凭据期满 `410 DELETION_RECEIPT_EXPIRED`，无效访问 `401 DELETION_ACCESS_DENIED`。
- `POST /deletions/current/cancellation`：删除 Cookie、其 CSRF，输入 `{passphrase,deviceName}`。仅 `serverTime < cancellableUntil` 且尚未开始删除时可撤销；返回 `{status:'cancelled',reauthenticationRequired:true}`，清除删除 Cookie，不设置普通 Cookie。本人随后通过正常登录建立全新合法会话。旧会话永不复活，原已撤销凭据/权限不恢复。超期/执行已开始 `409 DELETION_NOT_CANCELLABLE`。错误口令 `403 DELETION_VERIFICATION_FAILED`，不扩张权限。
- `POST /deletions/current/retry`：删除 Cookie、其 CSRF，正文 `{}`，仅到期任务触发一次受控执行/清理重试，返回 `{deletion:DeletionStatus,csrfToken}`；未到期 `409 DELETION_NOT_DUE`。查询绝不驱动删除。服务器启动及受控后台周期处理到期任务；停服不会伪报已删除。

`DeletionStatus` 固定字段：`deletionId, status, requestedAt, cancellableUntil, serverTime, onlineDeletedAt, receiptExpiresAt, backupDeadlineAt, reason, scope, onlineData, managedFiles, managedBackups, storage, externalCall, providerCharge`。

实际 SQLite 写锁阻塞时返回 `503 DELETION_DATABASE_BUSY`；无法落盘的尝试不会伪造成功记录，已持久化任务保持待处理。启动维护遇占用会延后并留下脱敏诊断，不因维护失败阻止只读查询。已成功删除在线行后 checkpoint 未完成，状态继续 cleanup_pending / sqlite_checkpoint_pending。没有已登记受管副本时为 0；`personalManagedRoot` 仅是内部受管创建者的显式装配依赖，默认没有备份创建或扫描。恢复端口只认可仍有效的已登记副本，检查所有者状态和删除标记；不提供通用整库恢复或用户自存副本擦除。

- status：`waiting | processing | cleanup_pending | failed | completed | cancelled`；reason 为稳定脱敏码或 null。
- scope：`{tableCount,rowCount,managedFileCount,managedBackupCount}`，源自实际所属行及依赖清单，不返回行内容或表内秘密。
- onlineData：`pending | deleted`；managedFiles/managedBackups：`{status:'pending'|'completed',remaining:number}`。整体仅在所有受管清理成功时 completed。
- storage：`{sqlite:'pending'|'logical_rows_deleted',wal:'pending'|'checkpoint_completed'|'checkpoint_pending',physicalErasure:'not_claimed',userCopies:'not_managed'}`。不承诺 SSD、外部副本物理擦除。
- externalCall=`not_performed`、providerCharge=`not_incurred`。所有时间为 UTC Z，未发生时间 null。执行在线删除后开始 14/30 天计时；超期未清理成功仍显示失败/等待原因，不伪报完成。

`POST /vault/unlock`：有效普通会话下口令错误为 **403 VAULT_UNLOCK_FAILED**，不退出该会话；真正会话无效仍是 **401 ACCESS_DENIED**。前端必须按这两个错误区分，不忽略全部 401。

取消语义：服务端已确认 cancelled 的操作永远保持取消；新操作必须新键。超时、断网、结果未知不等于 cancelled，仍用旧键查询。

## 尚未执行的外部验证与历史边界

删除申请立即停止所有者业务及凭据使用，撤销旧普通会话、锁定进程库密钥；等待期保留用于本人撤销的数据，不销毁仍合法的凭据密文。撤销只恢复账户可登录性，既有 revoked 凭据、deleted/inactive 权限不会被改回；随后合法登录才能重新解锁尚有效的凭据。后台 V3/V4/V5 恢复和异步返回均检查所有者可用性，不能在等待/删除后继续重试、写最终消息或用量。实际删除使用 024 的精确任务/所有者/行范围授权，所有普通不可变 UPDATE 和 24 个普通 DELETE 拒绝语义保持；只删除 Vio 管理范围，不触碰真实 Engine。

真实供应商、真实凭据、付费调用和部署没有本轮授权；受控本机连接测试不算真实供应商验收。上述接口均已实现并有自动化验证；删除及本轮修复的最终页面证据另见开发日志。首轮浏览器服务器在启动前已初始化，当时没有初始化页动作证据；前轮收尾补证使用全新隔离数据库，在真实页面输入限时测试邀请、测试口令及三项协议后创建身份并完成首次设置。随后实际停止该轮后端，刷新出现“个人访问暂不可用”，同库重启后点击“重试访问恢复”恢复原个人资料/助手；库仍为 locked。不把一次停服/重启恢复扩写成所有网络故障均已浏览器验证。

连接检查对 DNS 返回的全部地址保留危险目标校验，再从安全 IPv4 中选择并固定实际连接地址；合法双栈名称不会仅因含 IPv6 被误报危险。当前 IPv6-only 返回明确的 `address_family_not_supported`，不静默降级、关闭 SSRF 检查或跟随重定向。

## 当前功能与验收出口

| R2 出口 | 实现/页面 | 证据与当前边界 |
| --- | --- | --- |
| 本人访问保护 | 初始化 CLI、个人访问页、服务端会话/CSRF、统一旧业务授权 | 真实 HTTP 与浏览器初始化、登录/退出/同库重启；无公开注册、无固定身份认领；邮箱/Google 按决定暂缓 |
| 首次设置、多个助手与资料 | `personal-identity-service.js`；首次设置与“我的” | 资料/首助手原子保存，创建幂等、选择/修改版本检查；两助手切换/刷新、错误与迟到结果隔离；不实现 R3 多会话 |
| 供应商/模型/密钥 | `personal-configuration-service.js`、`personal-credential-vault.js`；能力页 | 高风险确认、密文存储、掩码、轮换/撤销/锁库；旧重叠写入口不可绕过；真实供应商未验收 |
| 连接测试 | `provider-connection-check.js`、认证检查/结果查询 | 受控随机 loopback HTTP，危险地址/重定向/超时/异常正文拒绝；只做认证/网络，不做生成，不计费用事实 |
| 会话设备、审计、诊断 | 会话列表/撤销、访问审计、最小诊断 | 会话归属/失效及异常提示；不是 R9 设备控制，不输出路径、凭据或正文 |
| 账户/空间删除 | 删除申请/确认、独立限权状态页、本人验证撤销、到期重试 | 已确认 7/14/30 天政策；实际 owner 行范围、普通历史保护、同库重启、失败恢复、他人隔离、真实锁占用及恢复拦截有专项，不把 R11 备份或真实数据删除计为本轮验收 |
| 数据过渡与隔离 | 正式个人会话、旧数据保留、旧缓存隔离 | 不自动认领开发数据；新主入口不挂载旧固定身份聊天，不重发无归属缓存；真实迁移/清除仍须单独授权 |
| 迁移与既有回归 | `023`、`024`，十份 R2 测试，默认隔离启动器 | fresh/001–022及001–023升级/失败回滚/外键与普通历史保护有真实专项；本轮结果见开发日志，真实 Engine 共享验收不作为前提 |

最终真实页面已验证申请拒绝/新键重提、限权刷新、本人撤销及重新登录、注入时钟到期、真实执行失败/停服/同库恢复、在线已删但副本未清以及最终完成后刷新查询。首轮缺证、失败及修复完整保留在日志。正式验收结论为：`PLANNING_CONFLICT = NONE`，`EVIDENCE_CONFLICT = NONE`。手机实机、HTTPS、云部署、跨设备云端同步、R11 完整备份及本轮真实供应商验证不计为 R2 已执行项；不自动进入下一阶段。
