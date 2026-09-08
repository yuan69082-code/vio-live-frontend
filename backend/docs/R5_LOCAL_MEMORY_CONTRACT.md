# R5 Local Long-Term Memory Contract

Status: frozen backend/frontend integration contract for R5 on 2026-09-08. The contract extends the accepted R2 personal identity, R1 standalone execution, R3 multi-conversation and R4 context-assembly contracts. It does not enable an external subject runtime, semantic embeddings, automatic model-written memory, or R6 capabilities.

Contract versions are `vio-local-memory/v1`, `vio-local-memory-import/v1`, and `vio-local-memory-export/v1`.

## Authority and boundaries

- Identity comes only from the verified R2 personal session. The active assistant comes only from the server-side current-assistant selection. Request paths, query strings and bodies never accept `userId`, `assistantId` or `subjectId`.
- Every memory, version, reference, operation, import, export and deletion is scoped to the exact `(owner, current assistant)`. Changing assistants changes the visible memory scope; it never moves, merges or reassigns memory.
- R5 memory contains only explicit user entries and controlled imports. Models, Providers, startup, reads, searches, context preview and recovery never create or edit memory automatically.
- Search and R4 selection are deterministic local `lexical-overlap-recency/v1`. R5 does not add embeddings, vector storage, a model call, a Provider call, business internet access, or an external-runtime call.
- R5 is not the legacy life-management `local_memories` table, AI Private Space, `ConversationSummary`, legacy `SubjectState`, or external Continuity Engine memory. Those stores keep their existing ownership and security rules and are never copied or silently merged into R5.
- Vio is authoritative for R5 memory facts. R5 does not create SubjectState, revision, external runtime Event, StateMutation, Evolution, or an external-runtime expression.

## Strict memory model

The public memory DTO has exactly these fields:

```json
{
  "contractVersion": "vio-local-memory/v1",
  "memoryId": "opaque-id",
  "assistantId": "opaque-current-assistant-id",
  "kind": "preference",
  "currentVersionId": "opaque-id",
  "version": 1,
  "body": "Exact user-approved memory body.",
  "summary": "Optional bounded user-visible summary.",
  "source": {
    "sourceType": "manual",
    "sourceRef": "manual:opaque-operation-id",
    "sourceContentHash": "sha256:..."
  },
  "occurredAt": null,
  "recordedAt": "2026-09-08T00:00:00.000Z",
  "includeInContext": true,
  "visibilityScope": "current_assistant",
  "sensitivity": "normal",
  "status": "active",
  "retention": {
    "deletionState": "not_requested",
    "deletionId": null,
    "requestedAt": null,
    "finalizedAt": null
  },
  "updatedAt": "2026-09-08T00:00:00.000Z",
  "externalCall": "not_performed"
}
```

`kind` is exactly `preference`, `profile_fact`, `relationship`, `decision`, `project`, `routine`, or `other`. `body` is 1–8192 Unicode characters and at most 32768 UTF-8 bytes. `summary` is null or 1–512 characters. `occurredAt` is null or a real RFC 3339 UTC `Z` instant. `visibilityScope` is fixed to `current_assistant`. `sensitivity` is `normal` or `sensitive`. `status` is `active`, `archived`, or `deletion_pending`; a finalized memory is absent from normal reads and represented only by its minimal deletion receipt.

Every create or edit appends one immutable memory version. It never overwrites an older body. The current pointer may advance only to the next version in the same owner/assistant/memory scope. A version records its own kind, body, summary, source, occurrence time, context flag, sensitivity, content hash and timestamps. A read verifies the current pointer and content hash before returning data. Finalization is the sole scoped exception: it physically removes the memory versions and references and supersedes all earlier body-bearing replay semantics, while leaving only the minimal deletion receipt and hash-only operation facts.

Source types are `manual`, `import`, `message_version`, or `event`. The source embedded in each version is the primary source. `manual` and `import` refer to an internal immutable operation/import hash fact. A `message_version` or `event` primary source, and every currently active attached reference, must be re-authorized against the same owner and assistant whenever the memory body is read, exported or admitted into a new context snapshot. If any required primary/active attached source changed, became hidden/deleted, left the selected branch, or became unauthorized, the whole memory body fails closed and the whole memory is ineligible for new R4 snapshots; the implementation does not merely drop the bad reference and continue using the body. A user-explicitly deleted attached reference is no longer active. No other assistant's source is accepted.

## Authentication, safety and idempotency

All routes are below `/api/v1/personal`, use the existing `{data: ...}` response envelope and require an active R2 personal session. Writes additionally require the existing same-origin/CSRF checks and exactly one `Idempotency-Key` matching the established personal-operation syntax. Bodies reject unknown fields and client-supplied ownership fields.

Read/search/list never call a Provider or external runtime and never mutate memory. Create, edit, inclusion, archive/restore, reference changes, import, export and deletion record immutable operation/audit facts. Exact replay of the same operation key and canonical input returns its first result. Reuse with a different operation, scope or content is `IDEMPOTENCY_CONFLICT`. Optimistic writes require `expectedVersion`; stale versions are `MEMORY_VERSION_CONFLICT`.

All list/search/detail/version/reference/export reads and all writes use the existing `memory` Permission boundary. Sensitive-body reads, exports, imports and destructive writes also use the existing Security/Confirmation pipeline; a sensitive memory is never returned merely because a list route was used. A confirmation-required response is an explicit non-executed result; retrying a write after the existing confirmation decision uses the same operation input and includes `confirmationId`. No second permission or security channel is introduced. R4 admission performs a non-bypassing current permission/security preflight; a result other than `allow` makes the entire memory candidate unavailable for that snapshot and never leaks the body.

GET routes transmit existing security context only in `X-Vio-Confirmation-Id` and `X-Vio-Security-Session-Id` request headers. Both are optional opaque IDs validated by the existing Security service; neither is accepted in a URL/query, returned as a credential, or logged. If the selected list/search page contains any sensitive memory, the whole read is challenged—sensitive entries are neither silently filtered nor returned as body-null summaries. The exact HTTP 200 challenge record is `{"contractVersion":"vio-local-memory/v1","operationStatus":"confirmation_required","confirmation":{"confirmationId":"opaque-id","status":"pending"},"externalCall":"not_performed"}`. The user decides it through the existing `POST /api/v1/personal/confirmations/{confirmationId}/decision`, then repeats the same GET with the approved confirmation ID and, when applicable, the current session-bound security-session ID. Confirmation scope includes owner, current assistant, resource/action and request fingerprint; logout, owner change, assistant change or scope mismatch invalidates it. Normal successful reads keep their exact list/detail/version/reference DTOs and never include confirmation fields.

## HTTP routes

### List and deterministic search

```http
GET /api/v1/personal/memories?query={text}&kind={kind}&status={active|archived|deletion_pending}&includeInContext={true|false}&cursor={opaque}&limit={1..100}
```

The response is:

```json
{
  "contractVersion": "vio-local-memory/v1",
  "items": [],
  "nextCursor": null,
  "query": null,
  "selection": {
    "strategy": "lexical-overlap-recency/v1",
    "scope": "current_owner_current_assistant"
  },
  "externalCall": "not_performed"
}
```

Omitted `status` means active and archived entries, never pending deletion. Search normalizes text deterministically, ranks lexical overlap first and then `occurredAt`, `recordedAt`, memory ID. It does not claim semantic similarity. A cursor is opaque base64url data bound by a canonical SHA-256 filter fingerprint to the verified owner, current assistant, query, kind, status, `includeInContext`, limit and ordering version. It also locks a snapshot high-water `(updatedAt,memoryId)` boundary: records created/updated after that boundary do not enter later pages, while deletion/source invalidation may safely remove an item and shorten a page. Reuse after any scope/filter/limit change, cross-assistant selection, or malformed/tampered cursor returns `MEMORY_CURSOR_INVALID`; it never falls back to page one. Ordinary data changes do not convert the cursor into another query.

### Create, detail and immutable versions

```http
POST /api/v1/personal/memories
Idempotency-Key: <opaque>

{
  "kind": "preference",
  "body": "Exact body",
  "summary": null,
  "occurredAt": null,
  "includeInContext": true,
  "sensitivity": "normal",
  "source": {"sourceType":"manual","sourceRef":null},
  "confirmationId": null,
  "securitySessionId": null
}

GET /api/v1/personal/memories/{memoryId}
GET /api/v1/personal/memories/{memoryId}/versions

PATCH /api/v1/personal/memories/{memoryId}
Idempotency-Key: <opaque>

{
  "kind": "preference",
  "body": "Replacement body recorded as a new version",
  "summary": null,
  "occurredAt": null,
  "includeInContext": true,
  "sensitivity": "normal",
  "source": {"sourceType":"manual","sourceRef":null},
  "expectedVersion": 1,
  "confirmationId": null,
  "securitySessionId": null
}
```

Create returns HTTP 201 after execution. PATCH is a complete replacement of editable fields so an omitted value cannot silently inherit a stale security-relevant value. `sourceRef=null` for manual input is replaced by a stable server operation reference; callers cannot forge import references. The exact write envelope is defined below; a confirmation-required create remains HTTP 200 because no resource was created.

### Context inclusion, archive and restore

```http
POST /api/v1/personal/memories/{memoryId}/context-inclusion
{"includeInContext":false,"expectedVersion":1,"confirmationId":null,"securitySessionId":null}

POST /api/v1/personal/memories/{memoryId}/archive
{"expectedVersion":2,"confirmationId":null,"securitySessionId":null}

POST /api/v1/personal/memories/{memoryId}/restore
{"expectedVersion":2,"confirmationId":null,"securitySessionId":null}
```

Each write requires an `Idempotency-Key`. Inclusion appends a new immutable version. Archive/restore append an immutable lifecycle fact without rewriting versions. Archived memory is excluded from R4.

### Explicit source references

```http
GET /api/v1/personal/memories/{memoryId}/references

POST /api/v1/personal/memories/{memoryId}/references
Idempotency-Key: <opaque>

{
  "sourceType":"message_version",
  "conversationId":"opaque-id",
  "messageId":"opaque-id",
  "messageVersionId":"opaque-id",
  "eventId":null,
  "expectedVersion":1,
  "confirmationId":null,
  "securitySessionId":null
}

POST /api/v1/personal/memories/{memoryId}/references/{referenceId}/deletion
Idempotency-Key: <opaque>

{"expectedVersion":1,"confirmationId":null,"securitySessionId":null}
```

For `event`, `eventId` is required and all message fields are null. For `message_version`, all three message fields are required and `eventId` is null. The service computes and locks the source hash; client hashes are not trusted. Reference creation/deletion is current-version-scoped and does not modify source records.

### Controlled deletion

```http
POST /api/v1/personal/memories/{memoryId}/deletion
Idempotency-Key: <opaque>
{"expectedVersion":1,"confirmationId":null,"securitySessionId":null}

POST /api/v1/personal/memories/{memoryId}/deletion-cancellation
Idempotency-Key: <opaque>
{"deletionId":"opaque-id"}

POST /api/v1/personal/memories/{memoryId}/deletion-finalization
Idempotency-Key: <opaque>
{"deletionId":"opaque-id","confirmationId":null,"securitySessionId":null}
```

The high-risk request uses existing confirmation and moves the memory to `deletion_pending`. R5 has no inherited seven-day wait: before finalization the user may cancel through the same current owner/assistant scope and an idempotent operation. Cancellation is a restoring, non-destructive operation and takes only `deletionId`; it does not require a second high-risk confirmation, but still requires session, current-assistant ownership, CSRF and idempotency. Finalization is a second explicit, idempotent `memory:delete` security operation and must independently consume an existing, scope-matched confirmation through `confirmationId`/`securitySessionId`; knowledge of `deletionId` is never deletion authority. Finalization uses a narrowly scoped memory-deletion authority to remove the body, versions and references for exactly that owner/assistant/memory and retains only a minimal receipt containing IDs, timestamps, result and no body. It does not disable global immutable-history protections. Completed R4 snapshot metadata and hash-only memory links remain historical execution facts; the former body is ineligible for any new snapshot and exact-evidence body reads return 404.

```http
GET /api/v1/personal/memories/deletions/{deletionId}
```

This current-session/current-assistant read returns only the minimal deletion record defined below. It grants no body or operation access.

### Import

```http
POST /api/v1/personal/memories/imports
Idempotency-Key: <opaque>

{
  "contractVersion":"vio-local-memory-import/v1",
  "mode":"atomic",
  "items":[{
    "clientItemId":"opaque-id",
    "kind":"other",
    "body":"Exact imported body",
    "summary":null,
    "occurredAt":null,
    "includeInContext":false,
    "sensitivity":"normal"
  }],
  "confirmationId":null,
  "securitySessionId":null
}
```

Formats are strict JSON only. Request size remains subject to the platform body cap; the R5 import additionally permits 1–100 items, unique client IDs, body/summary limits and strict fields. `atomic` rejects the whole import on an invalid or duplicate item. `best_effort` records per-item `created`, `reused`, `invalid`, or `conflict` without altering successful siblings. Exact operation replay returns the stored report and never creates additional versions. No file path or external URL is accepted.

### Export

```http
POST /api/v1/personal/memories/exports
Idempotency-Key: <opaque>

{
  "contractVersion":"vio-local-memory-export/v1",
  "memoryIds":[],
  "includeArchived":false,
  "confirmationId":null,
  "securitySessionId":null
}
```

The response contains a strict `vio-local-memory-export/v1` document with the current authorized versions only, an export ID, count, content hash, created time and `externalCall=not_performed`. Empty `memoryIds` means all memories in the current assistant scope. Export is bounded to 100 items, audited through the existing memory/export security boundary, never includes owner IDs, credentials, deleted bodies, operation internals or another assistant's records, and does not create a filesystem artifact.

### Operation recovery

```http
GET /api/v1/personal/memories/operations/by-idempotency-key/{idempotencyKey}
```

The read returns the first persisted operation result or failure for the current owner/assistant. It never repeats a write, import, export, deletion, Provider call, or external call. Interrupted operations are recovered only from their persisted checkpoint; a caller never substitutes a new scope or body.

## R4 long-term-memory slot

R4 admits only memories that are currently owned by the verified owner and selected assistant, `status=active`, `includeInContext=true`, not pending deletion, and readable under the current permission/security facts. It rechecks the primary source and every active attached `message_version` or `event` reference before use. If any required source is ineligible, the entire memory candidate is omitted/body unavailable and recorded by stable reason; R4 never drops only the bad reference while continuing to use the memory body, and never replaces it with another assistant's record.

Selection is deterministic `lexical-overlap-recency/v1`: overlap with the locked current user MessageVersion, then occurrence/recording recency, then opaque memory/version IDs. Concise/balanced/complete/custom take at most 2/6/12/6 memory versions before the normal R4 budget trimmer. A selected item is persisted as a R4 `memory_slot` source with exact `memoryId`, `memoryVersionId`, memory content hash, source type/ref/hash and a bounded preview. The Provider message contains the locked exact memory body. A later edit creates another memory version but cannot change an existing R4 snapshot. A later archive, delete, reference invalidation or authorization loss prevents new selection and makes body evidence fail closed while existing locked refs/hashes remain immutable.

The R4 public `memory` field becomes:

```json
{
  "status":"included",
  "selectionStrategy":"lexical-overlap-recency/v1",
  "eligibleCount":3,
  "selectedCount":2
}
```

Status is `included`, `empty`, `unavailable`, or `trimmed`. Reads/previews do not call a Provider. The final turn lock and memory version links commit with the existing R4 snapshot transaction.

## Exact response records

All objects in this section are exact records: missing or unknown fields are invalid. Nullable fields are present with `null`.

An operation is:

```json
{
  "operationId":"opaque-id",
  "operationType":"memory.create",
  "status":"completed",
  "resourceType":"memory",
  "resourceId":"opaque-id",
  "errorCode":null,
  "createdAt":"2026-09-08T00:00:00.000Z",
  "completedAt":"2026-09-08T00:00:00.000Z"
}
```

`operationType` is `memory.create`, `memory.edit`, `memory.context_inclusion`, `memory.archive`, `memory.restore`, `memory.reference.create`, `memory.reference.delete`, `memory.deletion.request`, `memory.deletion.cancel`, `memory.deletion.finalize`, `memory.import`, or `memory.export`. `resourceType` is respectively `memory` for create/edit/context inclusion/archive/restore, `reference` for reference create/delete, `deletion` for all deletion actions, `import` for import, and `export` for export. `resourceId` is null while processing/confirmation-required and is the completed memory/reference/deletion/import/export ID afterwards. `status` is `processing`, `confirmation_required`, `completed`, or `failed`. Processing/confirmation operations have `completedAt=null`; completed/failed operations have a completion time. `errorCode` is non-null only for failed operations. The operation ledger stores only the canonical request hash, resource IDs, minimal status/error/checkpoint and timestamps—never body, summary, Provider/credential data, full request JSON or full response JSON.

Every ordinary write returns this exact shape:

```json
{
  "contractVersion":"vio-local-memory/v1",
  "operationStatus":"completed",
  "operation":{},
  "memory":{},
  "reference":null,
  "deletion":null,
  "confirmation":null,
  "externalCall":"not_performed"
}
```

`operationStatus` is `completed`, `confirmation_required`, `denied`, or `failed`. Every field shown above is required. `securitySessionId` in request records is omitted when absent or is an existing valid opaque security-session string; response records never return it. Confirmation-required is an HTTP 200 state response, not a thrown 409 error. A confirmation is exactly `{"confirmationId":"opaque-id","status":"pending"}`; all resource fields are null until execution. A denied operation is an HTTP 403 `MEMORY_PERMISSION_DENIED`; a persisted failed operation is returned by recovery with `operationStatus=failed`.

Exact ordinary-write nullability is:

| Operation | completed non-null field | confirmation_required | failed recovery |
| --- | --- | --- | --- |
| create/edit/context inclusion/archive/restore | `memory` | only `operation`, `confirmation` | only `operation` |
| reference create/delete | `reference` | only `operation`, `confirmation` | only `operation` |
| deletion request/cancel | `deletion` and current `memory` | request: only `operation`, `confirmation`; cancel never confirms | only `operation` |
| deletion finalize | `deletion`; `memory=null` | only `operation`, `confirmation` | only `operation` |

All unlisted `memory`, `reference`, `deletion`, and `confirmation` fields are present with null. The operation is always present. Import/export use their dedicated exact envelopes: their resource field is null while confirmation is pending, and `operation` is always present.

A memory version is:

```json
{
  "memoryVersionId":"opaque-id",
  "memoryId":"opaque-id",
  "version":1,
  "kind":"preference",
  "body":"Exact body",
  "summary":null,
  "source":{"sourceType":"manual","sourceRef":"manual:opaque-id","sourceContentHash":"sha256:..."},
  "occurredAt":null,
  "recordedAt":"2026-09-08T00:00:00.000Z",
  "includeInContext":true,
  "visibilityScope":"current_assistant",
  "sensitivity":"normal",
  "contentHash":"sha256:...",
  "previousVersionId":null,
  "externalCall":"not_performed"
}
```

`GET .../{memoryId}/versions` returns exactly `{"contractVersion":"vio-local-memory/v1","memoryId":"opaque-id","items":[MemoryVersion],"externalCall":"not_performed"}` in ascending version order.

For a returned Memory, `retention.deletionState` is exactly `not_requested` when `status` is active/archived and all three deletion fields are null, or `requested` when `status=deletion_pending` with non-null `deletionId`/`requestedAt` and null `finalizedAt`. Finalized memory has no Memory DTO; only its deletion receipt has `status=completed`/`result=deleted` and non-null `finalizedAt`.

A reference is:

```json
{
  "referenceId":"opaque-id",
  "memoryId":"opaque-id",
  "memoryVersionId":"opaque-id",
  "sourceType":"message_version",
  "conversationId":"opaque-id",
  "messageId":"opaque-id",
  "messageVersionId":"opaque-id",
  "eventId":null,
  "sourceContentHash":"sha256:...",
  "status":"active",
  "createdAt":"2026-09-08T00:00:00.000Z",
  "deletedAt":null,
  "externalCall":"not_performed"
}
```

`sourceType=event` requires `eventId` and null message fields. `status` is `active` or `deleted`. `GET .../references` returns exactly `{"contractVersion":"vio-local-memory/v1","memoryId":"opaque-id","items":[MemoryReference],"externalCall":"not_performed"}`. Reference writes use the ordinary write envelope with only `reference` non-null.

A deletion record/receipt is:

```json
{
  "deletionId":"opaque-id",
  "memoryId":"opaque-id",
  "status":"pending",
  "requestedAt":"2026-09-08T00:00:00.000Z",
  "cancelledAt":null,
  "finalizedAt":null,
  "result":"pending",
  "bodyRetained":true
}
```

Status/result pairs are `pending/pending`, `cancelled/cancelled`, `completed/deleted`, or `failed/failed`; a completed receipt has `bodyRetained=false`. All eight displayed fields are required. Deletion writes use the ordinary write envelope with `deletion` non-null; after finalization `memory=null`.

An import response is exactly:

```json
{
  "contractVersion":"vio-local-memory-import/v1",
  "operationStatus":"completed",
  "operation":{},
  "import":{
    "importId":"opaque-id",
    "mode":"atomic",
    "status":"completed",
    "totalCount":1,
    "createdCount":1,
    "reusedCount":0,
    "invalidCount":0,
    "conflictCount":0,
    "items":[{"clientItemId":"item-1","status":"created","memoryId":"opaque-id","errorCode":null}],
    "createdAt":"2026-09-08T00:00:00.000Z",
    "completedAt":"2026-09-08T00:00:00.000Z"
  },
  "confirmation":null,
  "externalCall":"not_performed"
}
```

Import `mode` is exactly `atomic` or `best_effort`. Every displayed response field is required. Import item status is `created`, `reused`, `invalid`, or `conflict`; only created/reused items have a memory ID and only invalid/conflict items have an error code. The import ledger persists only import/item IDs, canonical item hashes, created memory IDs, status and error codes. Invalid items never persist body/summary. The report is immutable but contains no input body.

An export response is exactly:

```json
{
  "contractVersion":"vio-local-memory-export/v1",
  "operationStatus":"completed",
  "operation":{},
  "export":{
    "exportId":"opaque-id",
    "format":"vio-local-memory-export/v1",
    "status":"completed",
    "items":[],
    "itemCount":0,
    "contentHash":"sha256:...",
    "createdAt":"2026-09-08T00:00:00.000Z"
  },
  "confirmation":null,
  "externalCall":"not_performed"
}
```

Each export item is exactly `{"memoryId","memoryVersionId","version","kind","body","summary","source","occurredAt","recordedAt","includeInContext","visibilityScope","sensitivity","contentHash"}` using the same field rules as MemoryVersion; all fields are required and nullable fields remain present. The HTTP response is the export document; the browser may generate a local download from it, but the server creates no file and accepts no output path. The export ledger persists only export ID, selected version IDs/hashes, manifest hash, item count, scope and timestamps. It never persists the generated document/body. An exact replay while all locked versions remain authorized rebuilds and re-hashes the same document; otherwise it fails closed.

Operation recovery reconstructs the exact ordinary/import/export response only from still-existing immutable versions plus the hash-only operation/import/export manifest. A processing record returns an ordinary write envelope with `operationStatus=failed`, `operation.status=failed`, `errorCode=MEMORY_OPERATION_INTERRUPTED`, and all resource fields null after startup recovery marks an orphaned processing operation failed. It never re-executes the original operation. A current memory whose required primary/active attached source is invalid is omitted from list/search; its detail, versions and references routes return 404 `MEMORY_SOURCE_NOT_FOUND` rather than a partial/body-null DTO. Finalized deletion supersedes body replay: normal memory/list/search/version/reference/R4 evidence reads return 404 `MEMORY_NOT_FOUND` (or `CONTEXT_SOURCE_NOT_FOUND` at the R4 evidence route); any old create/edit/import/export replay or operation lookup that would disclose removed content returns HTTP 410 `MEMORY_BODY_UNAVAILABLE`. Only the scoped deletion lookup/finalize replay may return the minimal deletion receipt. No operation, import, export, audit, Event, error, or log retains body/summary after version removal, so replay cannot resurrect it.

R4 adds `memory_slot` to the existing `ContextSourceType`. The existing public ContextSource record keeps its current field list; memory identity is contained in its strict evidence record:

```json
{
  "memoryId":"opaque-id",
  "memoryVersionId":"opaque-id",
  "kind":"preference",
  "sourceType":"manual",
  "sourceRef":"manual:opaque-id",
  "sourceContentHash":"sha256:...",
  "memoryContentHash":"sha256:...",
  "selection":{"strategy":"lexical-overlap-recency/v1","relevanceScore":1000,"matchedTermCount":1,"rank":1},
  "preview":"bounded excerpt"
}
```

For non-memory source types the existing R4 evidence shapes do not change. `memory_slot` has its own evidence variant above and does not use R4's message/summary cross-window `representation` field. The R4 `ContextSource.contentHash` remains the hash of the exact R4 source payload (`{content,role}`); `evidence.memoryContentHash` is the immutable MemoryVersion hash and `evidence.sourceContentHash` is the primary-source hash. The R4 exact-evidence route adds `memory_slot` with exactly `{"sourceRef","sourceType","memoryId","memoryVersionId","kind","body","source","occurredAt","recordedAt","memoryContentHash","contentHash","externalCall"}`; `source` is the exact primary-source record, nullable fields are present, `contentHash` equals the locked ContextSource hash, and `memoryContentHash` equals the linked version hash. It returns `CONTEXT_SOURCE_NOT_FOUND` after archive/delete/source invalidation/authorization loss. `ContextAssembly.memory` always has exactly `status`, `selectionStrategy`, `eligibleCount`, and `selectedCount`; `selectionStrategy` is `lexical-overlap-recency/v1`, counts are non-negative integers, and status is `included`, `empty`, `unavailable`, or `trimmed`. `empty` requires both counts zero; `included` requires selectedCount greater than zero; `trimmed` requires eligibleCount greater than zero and no memory source left included after budget trimming; `unavailable` means candidates existed but every candidate failed current source/permission/security authorization.

## Body-retention invariant

Body/summary bytes exist only in `personal_local_memory_versions` and transient HTTP objects. Primary/attached source tables store IDs and SHA-256 hashes, not copied source bodies. Operations store hashes/checkpoints, imports store item hashes/results, exports store version-ID/hash manifests, security/audit/Event records store classification/IDs/results, and logs store only codes/IDs. Finalization deletes the exact memory's versions/references, verifies no R5 body-bearing row remains, and then completes the minimal receipt in one transaction. If that transaction fails, the memory remains `deletion_pending` and no completed receipt is reported. This rule is what makes controlled deletion compatible with immutable operations: history proves that an operation happened without retaining or replaying the deleted body.

## Stable errors

| HTTP | code | Meaning |
| --- | --- | --- |
| 400 | `MEMORY_REQUEST_INVALID` | Unknown/missing field, invalid enum, timestamp, body, cursor or strict JSON |
| 400 | `MEMORY_IMPORT_INVALID` | Import envelope/item/count/duplicate policy is invalid |
| 400 | `MEMORY_EXPORT_INVALID` | Export scope or format is invalid |
| 400 | `MEMORY_CURSOR_INVALID` | Cursor is malformed or bound to another scope/filter/order |
| 401 | existing personal-session code | Session absent, expired or revoked |
| 403 | `MEMORY_PERMISSION_DENIED` | Existing permission/security policy denies the operation |
| 404 | `MEMORY_NOT_FOUND` | Memory is absent or outside the current owner/assistant scope |
| 404 | `MEMORY_SOURCE_NOT_FOUND` | Source is absent, hidden, deleted or outside scope |
| 410 | `MEMORY_BODY_UNAVAILABLE` | A finalized deletion superseded a body-bearing replay/read |
| 200 state | `MEMORY_CONFIRMATION_REQUIRED` | `operationStatus=confirmation_required`; no mutation occurred |
| 409 | `MEMORY_VERSION_CONFLICT` | `expectedVersion` is stale |
| 409 | `MEMORY_STATE_CONFLICT` | Archive/restore/delete transition is not allowed |
| 409 | `MEMORY_SOURCE_CONFLICT` | Source/hash/identity changed or duplicate reference differs |
| 409 | `MEMORY_DELETION_NOT_ALLOWED` | Delete cancellation/finalization is unsafe or no longer applicable |
| 409 | `IDEMPOTENCY_CONFLICT` | Key is bound to another operation, scope or canonical input |
| 500 | `MEMORY_LEDGER_INCONSISTENT` | Persisted pointer, hash, version, operation or scope is inconsistent |

Existing R2 confirmation endpoints and status DTOs remain unchanged.

## Recovery, migration and acceptance fixture

Migration `028` is the only R5 migration. It creates independent memory, immutable-version, reference, operation, import, export, deletion receipt, R4 memory-link and supporting index/trigger facts. Migrations `001`–`027` are unchanged. Fresh creation, exact `027 → 028` upgrade, failed-migration rollback, foreign keys, partial unique indexes, immutable triggers and scoped deletion authority are mandatory tests.

The browser may cache only opaque memory/operation/import/export/deletion IDs and idempotency keys. It never caches memory bodies as recovery truth. Logout or owner/assistant change clears the relevant recovery index. Backend acceptance uses temporary SQLite with two isolated owners and two assistants each; context execution uses only a random loopback OpenAI-compatible test Provider. Tests do not read or start a real Engine, use real credentials, access business internet, or incur charges.

R5 completes Vio-owned local long-term memory management and R4 slot integration. It does not complete R6 capabilities, real external-runtime connection, semantic/vector memory, automatic model memory, cloud synchronization, deployment, backup, or real Provider acceptance.
