# R4 Context Assembly Contract

Status: frozen backend/frontend integration contract for R4 on 2026-09-06. It extends the accepted R1 standalone execution and R3 multi-conversation contracts; it does not implement R5 memory or connect a real external subject runtime.

## Authority and fixed boundary

- Identity comes only from the verified R2 personal session. Assistant comes from the server-side current-assistant selection. Conversation and branch are exact R3 resources owned by that `(owner, assistant)` scope. Bodies never accept `userId`, `assistantId`, or `subjectId`.
- Vio owns independent context assembly. A Provider receives only one immutable persisted R4 snapshot. Startup, reads, previews, refresh, and recovery queries never call a Provider or external runtime.
- The optional runtime slot accepts only a projection already verified through the generic Subject Runtime Port boundary. `mode=none`, disconnected runtime, or absent projection produces an explicit empty slot. R4 never invents SubjectState, revision, Event, mutation, or runtime capability.
- R5 memory is explicitly `{status:"not_implemented"}`. No private-space or future-memory row is silently used.
- R1/R3 turn, Provider execution, attempt, result, usage, publication, idempotency, one-active-turn lock, and recovery rules remain authoritative. R4 binds one context assembly to a turn; it does not create a second execution path.

Versions are `vio-context-assembly/v1`, `vio-context-assembly-snapshot/v1`, and `vio-context-summary/v1`.

## Fixed assembly order

Every locked snapshot records these slots in order, including empty slots:

1. `system_rules`
2. `assistant_settings`
3. `runtime_projection` (verified or explicitly unavailable)
4. `unresolved_events`
5. `recent_original_text`
6. `long_term_memory` (`not_implemented` in R4)
7. `current_user_message`

The current user message is mandatory and is never trimmed, summarized, or silently dropped.

## Modes and exclusions

`mode` is `concise`, `balanced`, `complete`, or `custom`. Concise uses the smallest recent window; balanced is the default and admits same-assistant cross-window evidence; complete uses the full safe input budget; custom uses the balanced budget plus exact exclusions.

`excludedSourceRefs` is allowed only for custom mode, contains at most 128 unique opaque references, and cannot exclude system rules, assistant settings, or the current user message. PATCH and an explicit turn control accept only a source currently eligible for that owner, assistant and branch. If a previously saved reference later becomes hidden, cleared, deleted, non-selected, or permission-revoked, reads retain it under `conversation.excludedSourceRefs` for audit, remove it from `effective.excludedSourceRefs`, and report it under `unavailableExcludedSourceRefs`. Such a stale saved reference is safely ignored and never reaches a Provider; it does not poison preview or a later turn.

## Token budget and trimming

- `estimationMethod=utf8-byte-upper-bound/v1`: UTF-8 content bytes plus fixed per-message and request framing allowances. It is deterministic and conservative, not a Provider tokenizer or exact billing claim.
- A `modelContextLimitPort` supplies the selected model limit. If a Provider has no declared limit, the production port uses a documented conservative Vio policy limit, never a fabricated Provider claim.
- The full output allowance is reserved before input selection. The plan/snapshot records the raw estimate, deterministic post-fold/post-trim estimate, context limit, output reserve, input budget, folding/trimming decisions, and reasons. `withinLimit` is based on the post-plan estimate. A long raw history that fits after deterministic folding or trimming remains sendable; only mandatory content that still cannot fit is blocked.
- Trimming deterministically drops the least preferred eligible source first while preserving mandatory slots and current instruction. If mandatory slots cannot fit, `CONTEXT_BUDGET_EXCEEDED` is returned before any Provider call.

## Source and summary facts

Each source exposes a bounded reference DTO:

```json
{
  "sourceRef": "message-version:opaque-id",
  "sourceType": "message_version",
  "slot": "recent_original_text",
  "origin": "current_conversation",
  "status": "included",
  "reason": null,
  "conversationId": "opaque-id",
  "branchId": "opaque-id",
  "messageId": "opaque-id",
  "messageVersionId": "opaque-id",
  "eventId": null,
  "summaryId": null,
  "contentHash": "sha256:...",
  "estimatedTokens": 123,
  "createdAt": "2026-09-06T00:00:00.000Z",
  "evidence": {"senderType":"user","preview":"bounded user-visible excerpt"}
}
```

`status` is `included`, `excluded`, `trimmed`, or `summarized`. `origin` is `system`, `assistant`, `runtime`, `current_conversation`, `cross_window`, `event`, `memory`, or `current_turn`.

Cross-window sources must belong to the same owner and current assistant, come from a different active conversation, and pass current-branch, visibility and source-access checks. Selection is deterministic `lexical-overlap-recency/v1`: lexical relevance wins, then conversation recency and opaque ID break ties. A locked turn uses the current user MessageVersion as the relevance query. Preview cannot know an unsent message, so it is explicitly `provisional` and uses bounded current-conversation history only. It never claims to be the final selection. For each selected cross-window conversation, the latest `ready` R4 summary whose exact sources remain eligible is preferred; otherwise R4 falls back to eligible original MessageVersions. The current conversation is never duplicated through cross-window selection. R4 never expands across assistants.

Folding creates or reuses an immutable structured summary with the exact fields `schemaVersion`, `summaryId`, `scope`, `decisions`, `tasks`, `unresolvedItems`, `importantRelationships`, `supportingExcerpts`, `sourceRefs`, and `createdAt`. The summary builder receives an immutable clone of the selected source set; attempts to mutate it cannot change the assembly. Unknown fields, wrong scope, missing/extra/reordered sources, invalid strings or forged IDs are rejected as `CONTEXT_SUMMARY_INVALID`. Summary states are `building`, `ready`, and `failed`. `contentHash` is not embedded in the structured summary: it is exactly the RFC 8785/SHA-256 hash of that strict object. The same hash appears on the snapshot summary source and exact evidence response, while every referenced source hash is recomputed before a ready summary can be selected. A failed build persists every original candidate source in a separate immutable `failed_candidate` source phase. If originals still fit, the assembly uses them and records `failed_fallback_original`; otherwise the public failed context reports the source-set hash/count and `recoveryAction=retry_fold` before any Provider call. Recovery appends a separate immutable `locked` source phase and synchronizes every relational plan/model/limit/budget/hash field with the final snapshot. Summary completion, replacement of the failed assembly, and locked-source insertion are one transaction; an injected persistence failure leaves the failed summary/assembly/candidate facts intact.

New assemblies exclude a source that was later hidden, deleted, permission-revoked, or no longer selected on its branch. Existing locked snapshot refs and hashes remain immutable and auditable, but the exact-evidence read rechecks current ownership, branch visibility and source access; a now-ineligible source fails closed instead of disclosing its former body.

## HTTP routes

All routes are under `/api/v1/personal`, use the existing envelope, R2 session, same-origin and CSRF rules. Reads are side-effect free. Writes/recovery require `Idempotency-Key`.

### Conversation context settings

```http
GET /api/v1/personal/chat/conversations/{conversationId}/context-settings
PATCH /api/v1/personal/chat/conversations/{conversationId}/context-settings
Idempotency-Key: <opaque>

{
  "mode": "custom",
  "excludedSourceRefs": ["message-version:opaque-id"],
  "expectedVersion": 2
}
```

The read returns:

```json
{
  "contractVersion": "vio-context-assembly/v1",
  "conversationId": "opaque-id",
  "personalDefault": {"mode":"balanced","source":"assistant_settings"},
  "conversation": {"mode":"custom","excludedSourceRefs":[],"unavailableExcludedSourceRefs":[],"version":3,"updatedAt":"..."},
  "effective": {"mode":"custom","excludedSourceRefs":[],"unavailableExcludedSourceRefs":[],"source":"conversation"},
  "externalCall": "not_performed"
}
```

The personal default is the current assistant's already-persisted `settings.contextMode`; R4 does not create a second personal preference. A missing conversation override reports `conversation=null`, and effective settings come from the personal default. PATCH stores an explicit conversation override using `expectedVersion` (`0` means no override exists). It is owner/current-assistant scoped, idempotent, and optimistic: exact replay returns the same version, changed input/key is `IDEMPOTENCY_CONFLICT`, stale version is `CONTEXT_SETTINGS_VERSION_CONFLICT`. Refresh/restart reads the persisted value. A turn may supply its own `context` controls; the locked turn DTO records `controlsSource=turn`, while omission uses the conversation effective value and records `controlsSource=conversation` or `personal_default`. A turn never mutates either preference.

### Preview

```http
GET /api/v1/personal/chat/conversations/{conversationId}/context-plan?branchId={branchId}&mode=balanced&excludeSourceRef={opaque}
```

`excludeSourceRef` may repeat only for custom mode. Preview persists nothing and returns a deterministic eligibility/configuration `planHash`. It performs the same deterministic folding and trimming calculation as build without creating a summary or calling a Provider. `selection.status=provisional` makes clear that final relevance ordering uses the subsequently persisted user message; `expectedPlanHash` protects the source inventory and configuration, not an unsent-message ranking.

### Turn extension

```http
POST /api/v1/personal/chat/conversations/{conversationId}/turns
Idempotency-Key: <opaque>

{
  "branchId": "opaque-id",
  "content": "current user message",
  "attachmentIds": [],
  "context": {
    "mode": "balanced",
    "excludedSourceRefs": [],
    "expectedPlanHash": null
  }
}
```

`context` is optional for R3 compatibility and defaults to balanced with no exclusions/hash. The turn key binds branch, content, attachments, and context controls. Exact replay returns the same turn and snapshot; changed controls are `IDEMPOTENCY_CONFLICT`.

### Locked snapshot

```http
GET /api/v1/personal/chat/turns/{turnId}/context
```

Returns the immutable snapshot. Before a snapshot exists it returns `404 CONTEXT_SNAPSHOT_NOT_FOUND`; the read never creates one.

### Exact source evidence

```http
GET /api/v1/personal/chat/context-sources/{encodedSourceRef}
```

The source must already be referenced by an R4 assembly owned by the verified personal session and current assistant. The caller never supplies owner or assistant IDs. The response is exactly one of:

```json
{"sourceRef":"message-version:...","sourceType":"message_version","conversationId":"...","branchId":"...","messageId":"...","messageVersionId":"...","senderType":"user","content":"exact locked version","createdAt":"...","contentHash":"sha256:...","externalCall":"not_performed"}
```

```json
{"sourceRef":"event:...","sourceType":"event","conversationId":null,"branchId":null,"eventId":"...","eventType":"...","summary":"...","data":{},"occurredAt":"...","contentHash":"sha256:...","externalCall":"not_performed"}
```

```json
{"sourceRef":"summary:...","sourceType":"summary","conversationId":"...","branchId":"...","summaryId":"...","structuredSummary":{},"sourceRefs":[],"sourceHashes":[{"sourceRef":"message-version:...","contentHash":"sha256:..."}],"createdAt":"...","contentHash":"sha256:...","externalCall":"not_performed"}
```

Unknown fields are forbidden in persisted evidence. Hidden/deleted/revoked sources are neither eligible for new snapshots nor returned by the exact-evidence route; the locked historical snapshot retains only its immutable ref/hash audit fact. Foreign owner/assistant/source references and sources that are no longer readable return `404 CONTEXT_SOURCE_NOT_FOUND` without existence disclosure. Summary evidence is returned only after its strict object hash and every ordered source ref/hash are recomputed and still eligible. Reads do not call Provider/runtime or mutate visibility.

### Fold recovery

```http
POST /api/v1/personal/chat/turns/{turnId}/context-recovery
Idempotency-Key: <new opaque key>

{"action":"retry_fold"}
```

Allowed only before any Provider request starts and while the assembly is `fold_failed`. Exact replay returns the same recovery fact. The summary, locked assembly and locked-source phase are committed atomically before the existing R1 recovery resumes; a partial write cannot leave a ready summary attached to a failed assembly. Successful folding resumes the existing turn without replacing the original user MessageVersion.

The successful response is the exact object below; `context` is the newly locked snapshot and
`turn` is the existing R1/R3 turn after the same recovery attempt (it may still require an existing
permission/security/budget confirmation):

```json
{
  "context": {"contractVersion":"vio-context-assembly/v1","state":"locked"},
  "turn": {"turnId":"opaque-id","status":"completed"},
  "externalCall": "performed"
}
```

The abbreviated nested objects above identify the existing snapshot and turn contracts; production
responses contain their complete strict DTOs and no additional wrapper fields.

## Plan and snapshot DTO

```json
{
  "contractVersion": "vio-context-assembly/v1",
  "schemaVersion": "vio-context-assembly-snapshot/v1",
  "assemblyId": null,
  "turnId": null,
  "conversationId": "opaque-id",
  "branchId": "opaque-id",
  "mode": "balanced",
  "controlsSource": "conversation",
  "state": "planned",
  "scope": {"currentOwner":true,"currentAssistant":true,"currentConversationExcludedFromCrossWindow":true},
  "controls": {"excludedSourceRefs":[],"unavailableExcludedSourceRefs":[]},
  "slots": [
    {"slot":"system_rules","status":"included"},
    {"slot":"assistant_settings","status":"included"},
    {"slot":"runtime_projection","status":"not_available"},
    {"slot":"unresolved_events","status":"empty"},
    {"slot":"recent_original_text","status":"included"},
    {"slot":"long_term_memory","status":"not_implemented"},
    {"slot":"current_user_message","status":"pending"}
  ],
  "sources": [],
  "budget": {
    "estimationMethod":"utf8-byte-upper-bound/v1",
    "contextLimitTokens":16384,
    "reservedOutputTokens":4096,
    "inputBudgetTokens":12288,
    "rawEstimatedInputTokens":0,
    "estimatedInputTokens":0,
    "withinLimit":true,
    "foldPlanned":false,
    "trimmingApplied":false,
    "trimmingReason":null
  },
  "folding":{"status":"not_required","summaryId":null,"reason":null,"sourceSetHash":null,"sourceCount":0,"recoveryAction":null},
  "selection":{"strategy":"lexical-overlap-recency/v1","status":"provisional","querySource":"conversation_history","crossWindowCandidateCount":0,"crossWindowSelectedCount":0},
  "runtimeProjection":{"status":"not_available","sourceRef":null},
  "memory":{"status":"not_implemented"},
  "planHash":"sha256:...",
  "providerMessagesHash":null,
  "snapshotHash":null,
  "createdAt":"...",
  "lockedAt":null,
  "externalCall":"not_performed"
}
```

For a locked turn, IDs/hash/timestamps and `providerMessagesHash` are non-null and `selection.status=final`. `snapshotHash` commits to exact source refs/hashes, budget, selection metadata and `providerMessagesHash`; persisted Provider messages must re-hash to that value and equal the ordered included source payloads. For `fold_failed` and `budget_blocked`, snapshot/provider hashes and `lockedAt` remain null, while the public projection comes from the persisted failed candidate source set. Public scope uses booleans, not raw owner ID. Full Provider messages and internal source bodies are persisted but never returned by this DTO.

## Stable errors

| HTTP | code | Meaning |
| --- | --- | --- |
| 400 | `CONTEXT_MODE_INVALID` | Unsupported mode or invalid mode/control combination |
| 400 | `CONTEXT_EXCLUSIONS_INVALID` | Duplicate, malformed, excessive, or mandatory-slot exclusion |
| 400 | `CONTEXT_RESPONSE_INVALID` | Projection or contract data is not strict serializable data |
| 400 | `CONTEXT_SUMMARY_INVALID` | Summary builder output violates the frozen schema, scope, or exact source set |
| 403 | `CONTEXT_SOURCE_FORBIDDEN` | Requested source is outside owner/assistant/permission scope |
| 404 | `CONTEXT_SNAPSHOT_NOT_FOUND` | No locked snapshot for the scoped turn |
| 409 | `CONTEXT_PLAN_STALE` | Expected plan no longer matches eligible facts |
| 409 | `CONTEXT_FOLDING_FAILED` | Fold failed and originals cannot fit safely |
| 409 | `CONTEXT_BUDGET_EXCEEDED` | Mandatory slots exceed the selected model limit |
| 409 | `CONTEXT_RECOVERY_NOT_ALLOWED` | Fold retry is unsafe or no longer applicable |
| 409 | `CONTEXT_SETTINGS_VERSION_CONFLICT` | Conversation settings optimistic version is stale |
| 409 | `IDEMPOTENCY_CONFLICT` | Existing key is bound to different input or scope |
| 404 | `CONTEXT_SOURCE_NOT_FOUND` | Scoped source evidence does not exist or is inaccessible |
| 500 | `CONTEXT_LEDGER_INCONSISTENT` | Persisted scope/source/summary/hash is inconsistent |

Existing R1/R3 model, credential, permission, budget, Provider, execution and publication errors remain unchanged.

## Browser recovery indexes and controlled fixture

The browser may retain only `{ownerSessionMarker,assistantId,conversationId,branchId,turnId,turnIdempotencyKey,contextRecoveryKey}`. It never caches message text, Provider bodies, full snapshots, or credentials. Refresh reads the turn and then its context; it never reconstructs context client-side. Logout, owner change, or assistant change removes corresponding indexes.

Automated acceptance uses two isolated owners, two assistants per owner, multiple conversations/branches, temporary SQLite, a deterministic model-limit port, an isolated injected runtime-projection port, and a random loopback OpenAI-compatible Provider only for final R1 execution. No test reads or starts a real Engine, uses real credentials, reaches business internet, or incurs charges. The isolated projection double proves the generic slot only, not a real runtime connection.

R4 completes context planning, immutable locked snapshots, structured folding, cross-window selection, exclusions, budget trimming and R1/R3 integration. It does not implement R5 memory, a real external runtime connection, real Provider acceptance, deployment, or later stages.
