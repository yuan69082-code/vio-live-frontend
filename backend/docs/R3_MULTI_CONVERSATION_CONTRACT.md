# R3 Personal Multi-Conversation Contract

Status: frozen backend/frontend integration contract for R3; formally accepted on 2026-09-06. This contract extends the R1 standalone personal-chat path; it does not connect an external subject runtime and does not implement R4 memory/context.

## Authority, scope, and common rules

- Every endpoint authenticates the R2 `vio_personal_session` cookie. Owner and current assistant always come from the verified server session and persisted current-assistant selection. Paths and bodies never accept `userId`, `assistantId`, or `subjectId`.
- All writes require the R2 same-origin/CSRF checks and exactly one non-empty `Idempotency-Key`. Identical owner/operation/key/content is an exact replay; changed content or scope is `409 IDEMPOTENCY_CONFLICT`.
- A conversation, branch, message, version, attachment, export, operation, and standalone turn is scoped to one immutable owner and assistant. A later assistant switch cannot redirect an in-flight or completed fact.
- Reads are side-effect free. They never select a conversation, publish a message, resume a turn, call a Provider, unlock a vault, or contact an external subject runtime.
- Success uses the existing Vio envelope `{success,data,error,timestamp}`. Errors use the existing envelope with stable `error.code`; no response exposes credentials, Authorization, raw Provider bodies, internal storage paths, or hidden message bodies.
- All UTC timestamps use RFC 3339 `Z`. IDs are opaque server identifiers. Lists use stable cursor pagination; a cursor is valid only for the exact owner, assistant, filter, search, and sort tuple.
- R1 turn/execution/result/usage facts and their pinned MessageVersions remain immutable. R3 appends catalog, branch, visibility, version-selection, attachment, export, and operation facts around them; it never rewrites an R1 fact.

## Public shapes

### Conversation summary

```json
{
  "conversationId": "...",
  "title": "Conversation title",
  "status": "active",
  "version": 1,
  "isCurrent": true,
  "currentBranchId": "...",
  "messageCount": 4,
  "createdAt": "...",
  "updatedAt": "...",
  "archivedAt": null
}
```

`status` is `active` or `archived`. A deleted conversation is not returned through ordinary conversation reads; its deletion operation remains queryable by idempotency key. `title` is 1–120 Unicode characters after the existing text normalization. Sort is one of `updated_desc`, `updated_asc`, `created_desc`, `created_asc`, or `title_asc`.

### Message projection

```json
{
  "messageId": "...",
  "messageVersionId": "...",
  "senderType": "user",
  "content": "...",
  "sequenceNumber": 1,
  "createdAt": "...",
  "versionCreatedAt": "...",
  "versionKind": "original",
  "attachmentIds": [],
  "hidden": false
}
```

`senderType` is `user` or `subject`; `versionKind` is `original`, `edited`, or `regenerated`. Ordinary conversation reads omit tombstoned entries. `hidden` is therefore always `false` in the ordinary projection and exists to make the exact projection explicit. Selecting an older version changes only the branch projection; it does not delete later versions.

### Branch summary

```json
{
  "branchId": "...",
  "parentBranchId": null,
  "forkMessageId": null,
  "title": "Main",
  "version": 1,
  "conversationVersion": 1,
  "isCurrent": true,
  "createdAt": "...",
  "updatedAt": "..."
}
```

Every conversation has one root branch. Restart-here creates a child branch whose visible prefix is locked to the selected versions preceding the restart point. Branch selection never changes another conversation or assistant.

### Operation projection

```json
{
  "operationId": "...",
  "operationType": "conversation.create",
  "idempotencyKey": "...",
  "status": "completed",
  "resourceType": "conversation",
  "resourceId": "...",
  "error": null,
  "createdAt": "...",
  "updatedAt": "...",
  "completedAt": "...",
  "externalCall": "not_performed"
}
```

Operation `status` is `processing`, `completed`, `failed`, `cancelled`, or `outcome_unknown`. The operation query is a pure read. A completed or failed operation remains stable across response loss, refresh, logout/login, assistant switching, and service restart.

## Conversation endpoints

### List and search

`GET /api/v1/personal/chat/conversations?status=active&query=&sort=updated_desc&cursor=&limit=50`

Returns:

```json
{
  "assistant": {"assistantId": "...", "name": "..."},
  "conversations": [],
  "selectionVersion": 0,
  "nextCursor": null,
  "externalCall": "not_performed"
}
```

`status` is `active`, `archived`, or `all`; `limit` is 1–100. Search is a normalized, bounded title search inside the current owner and current assistant only.

### Create

`POST /api/v1/personal/chat/conversations`

Body: `{ "title": "Conversation title" }`.

Creates the conversation, its root branch, and an operation. It does not select the conversation and does not call a Provider. The exact replay returns the original result.

Exact success `data` is `{conversation,selectionVersion,externalCall}`. `conversation.version` is the concurrency token; `selectionVersion` is `0` before the first selection.

### Current conversation

`GET /api/v1/personal/chat/conversations/current`

Returns `{assistant,conversation,selectionVersion,messages,activeTurn,externalCall}`. `conversation` is `null` when none is selected. When present, the response also contains its exact `branch`. It does not create or select a conversation.

### Read one

`GET /api/v1/personal/chat/conversations/{conversationId}`

Returns `{assistant,conversation,selectionVersion,branch,messages,activeTurn,externalCall}` for the conversation's current branch. Archived conversations remain readable by their owner; deleted conversations return `404`.

### Select current

`POST /api/v1/personal/chat/conversations/{conversationId}/selection`

Body: `{ "expectedSelectionVersion": 3 }`; the initial token is `0`. Exact success `data` is `{conversation,selectionVersion,externalCall}`. Selection is owner/current-assistant scoped and does not call a Provider.

### Rename

`PATCH /api/v1/personal/chat/conversations/{conversationId}`

Body: `{ "title": "New title", "expectedVersion": 2 }`.

Exact success `data` is `{conversation,selectionVersion,externalCall}` and increments `conversation.version` once.

### Archive and restore

- `POST /api/v1/personal/chat/conversations/{conversationId}/archive`
- `POST /api/v1/personal/chat/conversations/{conversationId}/restore`

Body: `{ "expectedVersion": 2 }`. Archiving the current conversation clears the current selection. Restore does not automatically select it.

Archive and restore return `{conversation,conversationId,status,selectionVersion,externalCall}`. Delete returns the same fields with `conversation:null`, the deleted `conversationId`, and `status:"deleted"`.

### Delete

`POST /api/v1/personal/chat/conversations/{conversationId}/deletion`

Body: `{ "expectedVersion": 2, "confirmation": "delete" }`.

Deletion removes the conversation from ordinary reads while retaining the minimum immutable deletion/operation facts required for idempotency and audit. It never changes another owner or assistant and never contacts a Provider. Attachment cleanup is scoped only to managed blobs no longer referenced by any retained version. Generic history protection is not globally disabled.

## Message versions and visibility

### List versions

`GET /api/v1/personal/chat/conversations/{conversationId}/messages/{messageId}/versions`

Returns `{messageId,versions,externalCall}`. Every item is the strict public version projection `{messageId,messageVersionId,senderType,content,versionNumber,versionKind,parentVersionId,createdAt,versionCreatedAt}`: `createdAt` is the stable logical Message time and `versionCreatedAt` is the exact immutable version time. User versions expose their normalized text. Subject versions expose only Vio-published results; raw Provider responses are never returned.

### Edit a user message

`PATCH /api/v1/personal/chat/conversations/{conversationId}/messages/{messageId}`

Body:

```json
{
  "branchId": "...",
  "baseVersionId": "...",
  "content": "replacement text"
}
```

The target must be a visible user message on that branch. `baseVersionId` must be the selected branch version. The service appends one `edited` MessageVersion and selects it for that branch. It never rewrites or deletes the original and never calls a Provider.

Exact success `data` is `{message,branch,externalCall}` and increments `branch.version` once.

### Regenerate a subject message

`POST /api/v1/personal/chat/conversations/{conversationId}/messages/{messageId}/regenerations`

Initial body: `{ "branchId": "...", "baseVersionId": "..." }`. If the response requires an existing R2 security or budget confirmation, the caller approves it through the R2 confirmation endpoint and submits a new regeneration operation/key with `{ "branchId": "...", "baseVersionId": "...", "confirmationId": "...", "confirmationKind": "security" }` (or `"budget"`). The first operation remains an immutable no-call confirmation-required fact.

The target must be a visible subject message. This is a real standalone model operation and must pass the complete current R1 model, Provider, vault, credential, permission, security, budget, and owner/session checks. The operation locks model/provider IDs, bounded context hash, execution/attempt/result/usage/cost/finish facts, appends one `regenerated` MessageVersion, and selects it for that branch. Every real call has a new execution/attempt and is made only by this explicit write. An `outcome_unknown` regeneration cannot be blindly retried.

Success returns `{message,execution,externalCall}`. `execution` contains only `executionId,modelId,providerId,status,inputTokens,outputTokens,totalTokens,finishReason`. A conclusive failure or unknown boundary returns the stable operation projection and never raw Provider facts.

### Select a version

`POST /api/v1/personal/chat/conversations/{conversationId}/messages/{messageId}/version-selection`

Body: `{ "branchId": "...", "messageVersionId": "...", "expectedBranchVersion": 4 }`. The version must belong to the same owner, assistant, conversation, message, and sender. Selection performs no external call.

Exact success `data` is `{message,branch,externalCall}`.

### Hide a message

`POST /api/v1/personal/chat/conversations/{conversationId}/messages/{messageId}/deletion`

Body: `{ "branchId": "...", "expectedBranchVersion": 4 }`. This appends a branch-scoped tombstone. It does not physically delete the Message or any MessageVersion and does not alter another branch.

Exact success `data` is `{messageId,hidden:true,branch,externalCall}`.

## Branches and clear

### List branches

`GET /api/v1/personal/chat/conversations/{conversationId}/branches`

### Restart here

`POST /api/v1/personal/chat/conversations/{conversationId}/branches`

Body:

```json
{
  "sourceBranchId": "...",
  "restartAfterMessageId": "...",
  "title": "Alternative"
}
```

The source prefix and its exact selected MessageVersion IDs are copied into a new branch. Later source messages are not copied. The new branch becomes current only for this conversation. No Provider call occurs.

Exact success `data` is `{conversation,branch,externalCall}`. `conversation.version` increments once; the new branch begins at `version=1`.

### Select branch

`POST /api/v1/personal/chat/conversations/{conversationId}/branches/{branchId}/selection`

Body: `{ "expectedConversationVersion": 3 }`.

Exact success `data` is `{conversation,branch,externalCall}`.

### Clear visible branch

`POST /api/v1/personal/chat/conversations/{conversationId}/clear`

Body: `{ "branchId": "...", "expectedBranchVersion": 4 }`. Appends a branch clear boundary. It changes only the visible window of this branch; no Message, MessageVersion, R1 turn, execution, result, or usage fact is deleted.

Exact success `data` is `{branch,messages:[],externalCall}`.

## Turns

`POST /api/v1/personal/chat/conversations/{conversationId}/turns`

Body:

```json
{
  "branchId": "...",
  "content": "user text",
  "attachmentIds": []
}
```

This is the R3-scoped form of the R1 standalone turn. The authenticated current assistant must own the conversation and branch. Exactly one active turn is allowed per conversation. The bounded Provider context uses only the selected, visible versions on the specified branch plus the current assistant settings and new input. It does not read another branch, conversation, assistant, fixed profile, external runtime, future memory, or hidden content.

R1 turn and recovery states, Provider safety, confirmation, budget, retry, `outcome_unknown`, locked-result publication, and no-blind-retry rules remain authoritative. Query routes remain:

- `GET /api/v1/personal/chat/turns/{turnId}`
- `GET /api/v1/personal/chat/turns/by-idempotency-key/{key}`
- `POST /api/v1/personal/chat/turns/{turnId}/recovery`

The R3 conversation and branch are locked on first acceptance. Recovery and late responses cannot be redirected by a later selection change.

## Attachments

R3 supports controlled image, file, and audio blobs. It stores managed bytes under an injected managed root outside the repository and records only scoped metadata in SQLite. Automatic parsing, OCR, transcription, semantic extraction, cloud sync, and external upload are not part of R3.

### Create attachment

`POST /api/v1/personal/chat/conversations/{conversationId}/attachments`

Exact JSON body:

```json
{
  "fileName": "notes.txt",
  "mediaType": "text/plain",
  "kind": "file",
  "sizeBytes": 5,
  "sha256": "sha256:...",
  "contentBase64": "aGVsbG8="
}
```

`kind` is `image`, `file`, or `audio`. `sizeBytes` must equal decoded bytes, `sha256` must match, Base64 must be canonical, and the media type must be allow-listed for the kind. The safe public filename is stripped to a bounded basename; traversal, separators, controls, absolute paths, drive/UNC prefixes, links/reparse points, and unknown fields are rejected. Maximum one blob is 10 MiB and maximum attachments selected for one turn is 20 MiB. The managed storage path is server-generated and never returned.

### Read metadata and content

- `GET /api/v1/personal/chat/conversations/{conversationId}/attachments/{attachmentId}`
- `GET /api/v1/personal/chat/conversations/{conversationId}/attachments/{attachmentId}/content`

Metadata is `{attachmentId,fileName,mediaType,kind,sizeBytes,sha256,status,createdAt,messageVersionId}`. Content streams only a verified ready blob after rechecking owner, assistant, conversation, size, hash, storage root, and non-link path. Cross-scope or orphaned blobs fail closed.

Create success and metadata read return `{attachment,externalCall}`. Content read returns `{attachmentId,fileName,mediaType,sizeBytes,contentBase64,externalCall}`; it never returns the internal storage reference.

### Remove unattached blob

`POST /api/v1/personal/chat/conversations/{conversationId}/attachments/{attachmentId}/deletion`

Body: `{}`. Only an unattached blob may be removed. Attachment linkage to a MessageVersion is immutable.

Exact success `data` is `{attachmentId,status:"deleted",externalCall}`.

## Export

`POST /api/v1/personal/chat/conversations/{conversationId}/exports`

Body: `{ "format": "json" }` or `{ "format": "markdown" }`.

The export is generated from the requested conversation's current branch and selected visible MessageVersions. JSON has a fixed schema/version; Markdown is human-readable. Both include sanitized conversation/message metadata and attachment metadata, but no credentials, internal paths, audit internals, hidden/tombstoned text, raw Provider bodies, or data from another owner/assistant. This is a conversation-level download, not R11 backup/export orchestration.

Exact success `data` is `{export,externalCall}` where `export` is `{exportId,fileName,mediaType,content,sha256,createdAt}`.

## Idempotency recovery

`GET /api/v1/personal/chat/operations/by-idempotency-key/{key}`

Returns the first R3 write operation for the authenticated owner and current assistant. It never executes or resumes the operation. A browser may persist a random key but not a request body. If an HTTP response is lost, the client queries this route before deciding anything else. It may replay the same body with the same key only where the operation projection says exact replay is valid; it must never invent a new key for an unknown Provider boundary.

For a completed local operation, `result` contains the exact original success `data`; for a failed or unknown operation it is `null`. Turn creation is projected with the complete public turn in `result`.

## Stable R3 errors

- `CONVERSATION_NOT_FOUND`
- `CONVERSATION_ARCHIVED`
- `CONVERSATION_ALREADY_ACTIVE`
- `CONVERSATION_VERSION_CONFLICT`
- `CONVERSATION_SELECTION_CONFLICT`
- `CONVERSATION_DELETE_CONFIRMATION_REQUIRED`
- `CONVERSATION_CURSOR_INVALID`
- `BRANCH_NOT_FOUND`
- `BRANCH_VERSION_CONFLICT`
- `MESSAGE_NOT_VISIBLE`
- `MESSAGE_SENDER_MISMATCH`
- `MESSAGE_VERSION_CONFLICT`
- `MESSAGE_VERSION_SCOPE_MISMATCH`
- `ATTACHMENT_NOT_FOUND`
- `ATTACHMENT_SCOPE_MISMATCH`
- `ATTACHMENT_ALREADY_LINKED`
- `ATTACHMENT_CONTENT_INVALID`
- `ATTACHMENT_MEDIA_TYPE_UNSUPPORTED`
- `ATTACHMENT_TOO_LARGE`
- `ATTACHMENT_STORAGE_UNAVAILABLE`
- `ATTACHMENT_STORAGE_INCONSISTENT`
- `IDEMPOTENCY_CONFLICT`
- `OPERATION_OUTCOME_UNKNOWN`

R1 stable model/configuration/permission/security/budget/Provider errors remain unchanged for turns and regenerations.

## Migration and compatibility

Migration `026` is additive and must not rewrite migrations `001`–`025`. For every existing R1 default-conversation mapping it registers that exact conversation as the first R3 conversation, creates its root branch, projects the R1 pinned MessageVersions in order, and makes it current for that owner/assistant. Existing conversation, message, MessageVersion, turn, idempotency, execution, attempt, result, usage, recovery, and audit identifiers remain unchanged.

Fresh databases and `001`–`025` upgrades must both pass foreign-key validation and transactional rollback-on-failure checks. R3 tables protect immutable identity/scope links and historical operations from update/delete. A partial migration never leaves half-registered conversations or branches.

## Explicit non-goals

- No external runtime or Continuity Engine access, startup, repository inspection, or adapter implementation.
- No R4 memory/context folding, semantic attachment processing, R6 general Provider work, R9 device controls, R11 full backup/export, or deployment.
- No R3 conversation list/new/rename/delete behavior is retroactively claimed by R1.
- No fixed development identity or fixed local-chat profile is a production authority.
