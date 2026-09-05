# R1 Standalone Personal Chat Contract

Status: implementation contract, R1 backend. This contract does not enable an external subject runtime and does not define R3 multi-conversation management.

## Authority and identity

- Every endpoint below authenticates the R2 `vio_personal_session` cookie. Request bodies and paths never accept a user, assistant, or conversation identity.
- Writes require the R2 same-origin check, `X-Vio-CSRF`, and exactly one `Idempotency-Key`.
- The current assistant is read from the authenticated owner's persisted user space at the start of an operation. A turn keeps that owner, assistant, and default conversation for its entire lifetime even if the current selection later changes.
- Each `(owner, assistant)` has exactly one R1 default conversation. R3 conversation creation, listing, renaming, and deletion are outside this contract.
- The Vio database is authoritative for the standalone turn, model execution, locked provider result, token/cost fact, and final Vio MessageVersion. No Continuity Engine contract or repository participates.

## HTTP endpoints

All success responses use the normal Vio envelope (`success`, `data`, `error`, `timestamp`). The `data` shapes below are exact: unknown fields are not part of this contract.

### `GET /api/v1/personal/chat/default`

Returns the current assistant's default standalone chat without creating it and without calling a model:

```json
{
  "assistant": { "assistantId": "...", "name": "..." },
  "conversation": null,
  "messages": [],
  "activeTurn": null,
  "externalCall": "not_performed"
}
```

When the mapping exists, `conversation` contains `conversationId`, `status`, `createdAt`, and `updatedAt`. `messages` contains only message versions pinned by R1 turns, in sequence order:

```json
{
  "messageId": "...",
  "messageVersionId": "...",
  "senderType": "user",
  "content": "...",
  "sequenceNumber": 1,
  "createdAt": "..."
}
```

Generic Message current-version changes do not rewrite an R1 turn's pinned version.

### `POST /api/v1/personal/chat/turns`

Required headers: `X-Vio-CSRF`, `Idempotency-Key`. Exact JSON body:

```json
{ "content": "user text" }
```

`content` is the only request-body field. Confirmation and retry inputs belong exclusively to the recovery endpoint. The first accepted key locks the canonical content hash in owner scope. Reusing the key with identical content under the same current assistant returns the already-persisted turn as a pure read; changed content or reuse after switching to another assistant returns `409 conflict`. Idempotent replay never calls the Provider again.

The operation creates the default conversation if absent, creates one user Message/MessageVersion, and creates one turn before model execution. It then performs the authorized execution synchronously when preflight succeeds. HTTP response loss is recovered through the query endpoints, not by submitting the message again under a new key.

### `GET /api/v1/personal/chat/turns/{turnId}`

Returns the owner/current-assistant-scoped turn. It is a pure query: no model call, retry, publication, or recovery side effect.

The persisted public turn shape is:

```json
{
  "turnId": "...",
  "conversationId": "...",
  "status": "completed",
  "createdAt": "...",
  "updatedAt": "...",
  "completedAt": "...",
  "userMessage": {
    "messageId": "...",
    "messageVersionId": "...",
    "senderType": "user",
    "content": "...",
    "sequenceNumber": 1,
    "createdAt": "..."
  },
  "assistantMessage": {
    "messageId": "...",
    "messageVersionId": "...",
    "senderType": "subject",
    "content": "...",
    "sequenceNumber": 2,
    "createdAt": "..."
  },
  "confirmation": null,
  "error": null,
  "execution": {
    "executionId": "...",
    "providerId": "...",
    "modelId": "...",
    "status": "succeeded",
    "attemptCount": 1,
    "lastAttemptStatus": "response_received"
  },
  "externalCall": "performed"
}
```

Nullable fields remain present as `null`; waiting turns expose only `{ "confirmationId", "kind" }`, and failures expose only `{ "code", "retryable" }`. No credential, request body, raw Provider response, internal path, or Engine field is returned.

### `GET /api/v1/personal/chat/turns/by-idempotency-key/{key}`

Returns the first turn created with the key for the current owner and current assistant. It is a pure query and allows the browser to retain only the random key, never the message body. Missing keys return `404 not_found`.

### `POST /api/v1/personal/chat/turns/{turnId}/recovery`

Required headers: `X-Vio-CSRF`, a new `Idempotency-Key`. Exact JSON body:

```json
{ "action": "resume" }
```

For a waiting confirmation:

```json
{ "action": "resume", "confirmationId": "..." }
```

For an explicitly retryable turn:

```json
{ "action": "retry" }
```

Cancellation uses:

```json
{ "action": "cancel" }
```

- `resume` supplies the exact pending confirmation or publishes/completes an already locked successful Provider result; it does not turn a retryable attempt into a new Provider call.
- `retry` may create one new Provider attempt inside the same logical execution only after an explicit request and only for a retryable, conclusively finished attempt. It repeats current owner, assistant, default-model, Provider, credential, permission, security, budget, and account-state checks. A fresh audit reference and request hash are persisted for every attempt.
- `cancel` is accepted only before an unsafe Provider boundary has been crossed and records a terminal cancellation; it does not call the Provider.
- `outcome_unknown` never permits a Provider retry because the current OpenAI-compatible interface has no execution reconciliation API.
- The browser never supplies a security-session identity. Vio binds all confirmation checks to the authenticated R2 personal session.
- A completed or already-progressed recovery key with the same complete action is a pure read of the locked turn. If a process stopped after persisting the recovery action but before applying it, exact replay resumes that persisted action once; persisted turn state and attempt count prevent a second attempt. Reusing the key with different content conflicts.

## Turn and execution states

Turn `status` is one of:

| State | Meaning | Model call allowed by a later explicit recovery |
| --- | --- | --- |
| `processing` | user MessageVersion and turn are durable; preflight has not completed | initial processing, or a safe explicit recovery |
| `waiting_confirmation` | the exact security confirmation is persisted | `resume` with the matching confirmation only |
| `waiting_budget` | the exact budget confirmation is persisted | `resume` with the matching confirmation only |
| `ready` | all current preflight facts passed and execution preparation may proceed | only the already-authorized operation |
| `executing` | the logical execution and current Provider attempt are durable | no blind retry; startup classifies the durable send boundary |
| `retryable` | the prior execution ended without a usable result and is safe for an explicit new attempt | `retry` only |
| `outcome_unknown` | a request may have reached the Provider but no recoverable response fact exists | never |
| `result_ready` | a validated response and usage fact are durable; assistant Message is not yet published | `resume` publishes locally, no Provider call |
| `publishing` | the exact assistant MessageVersion is attached and local completion is pending | `resume` completes locally, no Provider call |
| `completed` | the pinned assistant MessageVersion is published | never |
| `failed` | configuration, authorization, budget, Provider, or response failure is terminal | never |
| `cancelled` | the operation was explicitly cancelled before execution | never |
| `quarantined` | persisted facts are inconsistent and require controlled investigation | never |

Each turn has at most one logical execution, whose status is one of `prepared`, `in_flight`, `retryable`, `succeeded`, `failed_terminal`, `outcome_unknown`, or `cancelled`. Every actual Provider call gets a new immutable attempt within that execution, with status `prepared`, `in_flight`, `not_sent`, `retryable`, `response_received`, `outcome_unknown`, `failed_terminal`, or `cancelled`. A later attempt is allowed only when every earlier attempt is conclusively `not_sent` or explicitly `retryable`; `outcome_unknown` prevents another attempt. There is at most one successful Provider result and one final assistant Message per turn. Default-conversation mappings, turns, logical executions, over-budget approvals, Provider attempts, usage/cost facts, normalized successful results, and recovery actions are eight separate durable fact types. Every record must be inserted in its prescribed initial state; terminal facts and historical identity links are immutable.

## Stable failure codes

The HTTP envelope continues to use the platform error code for validation/authentication/conflict. A persisted turn's `error.code` distinguishes:

- `ASSISTANT_NOT_SELECTED`
- `DEFAULT_CHAT_MODEL_NOT_CONFIGURED`
- `MODEL_DISABLED`
- `PROVIDER_DISABLED`
- `PROVIDER_INTERFACE_UNSUPPORTED`
- `CREDENTIAL_UNAVAILABLE`
- `VAULT_LOCKED`
- `PERMISSION_DENIED`
- `SECURITY_CONFIRMATION_REQUIRED`
- `SECURITY_DENIED`
- `TOKEN_BUDGET_NOT_CONFIGURED`
- `TOKEN_BUDGET_DISABLED`
- `TOKEN_BUDGET_BLOCKED`
- `TOKEN_BUDGET_DEFERRED`
- `TOKEN_BUDGET_CONFIRMATION_REQUIRED`
- `PROVIDER_REQUEST_NOT_SENT`
- `PROVIDER_RETRYABLE_FAILURE`
- `PROVIDER_OUTCOME_UNKNOWN`
- `PROVIDER_TERMINAL_FAILURE`
- `TURN_CANCELLED`
- `TURN_ALREADY_ACTIVE`
- `TURN_RETRY_NOT_ALLOWED`
- `ASSISTANT_CONFIGURATION_TOO_LARGE`
- `STANDALONE_LEDGER_INCONSISTENT`
- `STANDALONE_MODE_REQUIRED`

Error details never contain credentials, Authorization, full Provider request/response bodies, or internal paths.

## Model input and output boundary

The Provider request contains only:

1. a bounded system message derived from the current assistant's explicitly saved name and settings;
2. bounded user/assistant MessageVersions pinned by completed turns in this default conversation;
3. the newly pinned user MessageVersion.

It does not read another assistant, fixed local-chat profiles, Continuity Engine state, private-space data, future memory, or browser recovery text. The selected R2 chat default must itself be enabled and support `chat`; R1 does not use catalog or fallback selection. Provider credentials are resolved only for the duration of the request from the encrypted R2 vault.

A successful Provider response must contain one text candidate, a finish reason, and internally consistent Provider-reported usage. Vio locks that fact before publishing an ordinary Vio `subject` Message. Raw response bodies are never stored. Cost is `provider_reported` only when explicitly trustworthy; otherwise it is `not_reported` with no fabricated amount.

The request sets `max_tokens=4096`, and the same full output-token ceiling is included in the conservative preflight budget estimate. Before persistence, successful text is normalized with the same Message rules used for publication; malformed Unicode, excessive output, excessive finish reason, or untrustworthy usage becomes `outcome_unknown` rather than a fabricated result.

This is the Vio-owned standalone path: after strict response validation and durable result locking, Vio publishes that locked candidate as the final `subject` MessageVersion. It is not the Continuity Engine adapter rule in which a Provider candidate must return to Engine before final expression. The two contracts are intentionally separate.

## Provider transport safety

- Production Provider URLs must be HTTPS and must not contain credentials, query strings, or fragments; loopback HTTP is test-only.
- Hostnames are resolved before the request under a bounded DNS timeout. Private, loopback, link-local, multicast, unspecified, and otherwise disallowed addresses are rejected outside the explicit loopback test mode.
- The selected safe address is pinned into the actual HTTP(S) connection lookup, so a second DNS answer cannot redirect the credential-bearing request to a different address.
- The adapter does not follow redirects, uses a non-streaming request, closes the connection, and enforces request, connect, response, and response-body limits.
- DNS resolution or connection failure before the persisted send boundary is `not_sent`/retryable. Once the boundary may have been crossed, loss or timeout is `outcome_unknown` and remains fail closed.
- At the final pre-send boundary Vio revalidates the authenticated personal session; the exact enabled default model and Provider; the active credential binding and same decrypted secret; the current Permission scope (including the absence of any replacement rule after an `allow_once` fact was consumed); the security policy snapshot; and the Token Budget projection or matching immutable budget approval. Any drift remains durably not-sent and requires a new explicit recovery decision.

## Recovery and startup

- Startup never calls a model. If the latest durable `in_flight` attempt proves that the request boundary was not crossed, startup records `not_sent` and makes the same logical execution explicitly retryable. If the boundary may have been crossed, startup records `outcome_unknown`; it never guesses or starts another attempt.
- Reads never call a model or publish a message.
- A locked `result_ready` turn is published only by its original request completing or an explicit `resume` action. Publication is idempotent and uses the same candidate.
- Logout, session revocation, or deletion-pending owner state prevents new authenticated calls and credential use. A response that returns after an assistant switch remains scoped to its original owner and assistant; it cannot be redirected to the new selection.
- Budget and security checks run again before every actual attempt. Resuming one confirmation never skips the other gate, and the security-session scope always comes from the authenticated server session.

Canonical request, permission/security, and budget hashes are produced by this service from the exact validated inputs and stored as immutable linked snapshots. SQLite independently enforces their shape, scope links, retry order, and immutability; it does not claim to reconstruct policy inputs that are not duplicated in the ledger. Provider-result canonical JSON and both result/content hashes are additionally recomputed by the repository before insertion.

## Legacy and external-runtime boundary

Production personal access rejects legacy conversation/message/continuity-turn/state-update writes that could bypass this contract. Historical tests may use the explicit test-support access adapter. Historical V1-V5 and S4 evidence remains unchanged. External mode may only enter through the separately frozen Subject Runtime Port; these R1 endpoints neither connect to nor inspect an Engine, and Engine availability is not part of their execution or startup conditions.

## Backend verification status

On 2026-09-05 the three R1 suites passed 61/61, the affected V1-V5 eight-file combination passed 128/128, and the model-routing/permission/security/budget combination passed 11/11. The default isolated backend run contained 399 tests: 398 passed, none failed, and the existing cross-repository RFC comparison was conditionally skipped because its explicitly isolated Engine path did not exist. That comparison was not executed and is not counted as passed. Frontend verification then passed 26/26 R1 tests and 224/224 total tests plus typecheck/build, and the personal Conversation page completed controlled local two-assistant, restart, configuration-failure, and lost-response recovery evidence against the real Vio HTTP boundary. Formal R1 stage acceptance remains separate work; no real Provider, credential, or external runtime was used by this verification.
