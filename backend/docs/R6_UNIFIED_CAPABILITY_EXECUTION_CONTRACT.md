# R6 Unified Capability Execution Contract

Status: frozen for R6 implementation on 2026-09-08.

This is the only public backend contract for the R6 capability center. It does
not replace the historical Continuity capability contract, Subject Runtime
Port v1, or the standalone-chat contract. All routes below derive the owner and
current assistant from the verified R2 personal session. Callers cannot submit
`userId`, `assistantId`, credentials, authorization headers, executable code,
filesystem paths, or arbitrary network headers.

## Scope and authority

R6 makes five execution categories real and auditable:

| category | authority and execution boundary |
| --- | --- |
| `model_api` | Existing R1 standalone chat remains the only model execution path. R6 projects its persisted execution/attempt/result/usage facts into the unified ledger; it never performs a second model call. |
| `local_tool` | Vio executes only a versioned built-in deterministic implementation. R6 v1 supports `builtin.text.inspect/v1`; it cannot access the shell, filesystem, process environment, network, or code evaluator. |
| `mcp_tool` | Vio uses the MCP 2026-07-28 Streamable HTTP client defined below. Only an explicitly trusted, validated endpoint may run. |
| `skill` | A frozen skill version orchestrates one to eight registered `local_tool` or `mcp_tool` steps. It cannot contain scripts, URLs, dynamic imports, or arbitrary code. |
| `plugin_action` | A local, frozen plugin manifest maps an action to a registered skill. Installing a plugin never executes code. Enable, disable, and uninstall are lifecycle state changes; an action executes only its referenced skill. |

Vio owns capability configuration, permission/security decisions, execution
facts, usage/cost facts, and public results. An MCP server owns only its MCP
tool behavior. No capability may write Subject Runtime state or impersonate an
external runtime adapter.

The old `tool_registry`, `mcp_registry`, `skill_registry`, `plugin_registry`,
and `tool_usage_records` rows remain historical registry/preflight facts. In
particular `tool_usage_records.execution_status=not_executed` is never reported
as an R6 execution.

## MCP transport

R6 implements the official MCP revision `2026-07-28` only. It deliberately
does not perform the removed `initialize`/`initialized` handshake and does not
use `Mcp-Session-Id`.

Each `tools/list` and `tools/call` request:

- is one JSON-RPC 2.0 POST to the registered Streamable HTTP endpoint;
- uses UTF-8 JSON and `Connection: close`;
- sets `Mcp-Protocol-Version: 2026-07-28` and `Mcp-Method`, plus
  `Mcp-Name` for `tools/call`;
- includes `_meta.io.modelcontextprotocol/protocolVersion`, `clientInfo`, and
  `clientCapabilities` in `params`;
- advertises `application/json` and `text/event-stream`, accepts one JSON
  response or a request-scoped SSE stream ending in the matching final response,
  and refuses redirects, oversized requests/responses, malformed JSON-RPC
  identities, unknown fields, and unsupported result types;
- validates tool names and `inputSchema`/`outputSchema` as the supported strict
  JSON Schema 2020-12 subset before persisting a discovery snapshot;
- validates and emits safe `x-mcp-header` values exactly from the accepted input
  schema, including required Base64 sentinel encoding; it never accepts caller
  supplied header names or arbitrary headers;
- accepts only `resultType=complete`. Interactive `input_required`, elicitation,
  sampling, roots, resources, prompts, and server-supplied header templates are
  outside R6 and fail closed.

Production endpoints must be credential-free public HTTPS URLs with no query
or fragment. DNS is resolved before the request, every answer must be a safe
public address, the selected address is pinned for the connection, and
redirects are rejected. This prevents loopback/private/link-local access, DNS
rebinding, and authorization leakage. `http://127.0.0.1:<random-port>` exists
only through an explicit injected test-support allowlist and is unavailable in
the production application.

The implementation follows the official [MCP 2026-07-28 tools contract](https://modelcontextprotocol.io/specification/2026-07-28/server/tools), [transport contract](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports), and [schema](https://modelcontextprotocol.io/specification/2026-07-28/schema).

## Persistence

Migration `029_create_unified_capability_execution.sql` adds append-protected
R6 facts without modifying migrations 001-028. Capability definitions,
definition versions, MCP discovery snapshots, lifecycle/configuration
operations, executions, attempts, steps, results, and usage/cost facts are all
scoped by the verified `ownerUserId` and the server-selected current
`assistantId`:

- installed capability definitions and immutable definition versions;
- MCP discovery snapshots and the exact accepted tool schema hashes;
- unified executions, attempts, step facts, immutable results, and usage/cost
  facts;
- lifecycle operations and their idempotency facts;
- projections from an existing R1 standalone model execution.

Every execution binds `ownerUserId`, `assistantId`, category, capability/version,
operation, idempotency key, canonical input JSON, SHA-256 input hash, current
status, and timestamps. Attempts record whether the external boundary may have
been crossed. Results contain canonical JSON and a content hash. Input identity,
attempt facts, results, and usage facts cannot be replaced or deleted through
normal operation. Owner deletion remains possible only through the existing
scoped owner-deletion authority.

One owner/current-assistant/idempotency-key tuple identifies one immutable
request. Exact replay in that scope returns the same execution; changed content
conflicts. The same key may be used independently by another assistant without
sharing facts. A completed or terminal execution cannot be overwritten. R1
projection is keyed by its existing standalone `executionId`; it records the
existing call and never invokes the Provider.

The R2 Provider/Model configuration catalog remains an owner-level account
configuration and may therefore be visible while either of that owner's
assistants is selected. Installed R6 local Tool, MCP, Skill, and Plugin
definitions and versions are not account-wide: catalog visibility, discovery,
dependency resolution, lifecycle changes, execution/history, by-key recovery,
restart recovery, and owner deletion all preserve the owner/current-assistant
scope. No client-supplied assistant identifier can change this scope.

Statuses are:

- `waiting_confirmation`
- `prepared`
- `in_flight`
- `retryable`
- `outcome_unknown`
- `succeeded`
- `failed_terminal`
- `cancelled`

An interrupted `in_flight` attempt becomes `outcome_unknown` after restart if
the boundary may have been crossed, otherwise `retryable`. `outcome_unknown`
is query-only and never auto-retries. `retryable` means the remote endpoint
returned a conclusive retryable response (for example 429 or 5xx), or the
request was proved not sent; it requires an explicit recovery request and
repeats permission/security checks before a new attempt. A result
already persisted is replayed locally without re-execution. Cancellation is
allowed only before an external boundary is crossed.

## Public personal API

All successful responses use the existing `{ "data": ... }` envelope. Errors
use the existing stable error envelope. Every write requires the R2 session
cookie, same-origin/CSRF verification, and an `Idempotency-Key` of 8-128 safe
identifier characters.

### Catalog

`GET /api/v1/personal/capabilities`

Returns:

```json
{
  "schemaVersion": "vio-capability-catalog/v1",
  "items": [
    {
      "capabilityId": "opaque-id",
      "category": "local_tool",
      "name": "Text inspect",
      "version": "1",
      "status": "enabled",
      "lifecycleStatus": "installed",
      "operations": ["execute"],
      "externalCall": "not_performed"
    }
  ]
}
```

The catalog never returns endpoint URLs, credentials, registry raw JSON, skill
templates, plugin bundles, or execution inputs/results.

### Install/configure

- `POST /api/v1/personal/capabilities/local-tools`
  - body: `{ "definitionId": "builtin.text.inspect/v1", "confirmationId"?: "..." }`
- `POST /api/v1/personal/capabilities/mcp-servers`
  - body: `{ "name", "serviceUrl", "description", "trustMode": "explicit_https", "acknowledgeTrustedEndpoint": true, "confirmationId"?: "..." }`
- `POST /api/v1/personal/capabilities/mcp-servers/{capabilityId}/discovery`
  - body: `{ "confirmationId"?: "..." }`
- `GET /api/v1/personal/capabilities/mcp-servers/{capabilityId}/discovery/by-idempotency-key/{key}`
  - pure query returning `{ "status": "not_found", "operation": null }` or
    `{ "status": "found", "operation": <exact discovery operation view> }`
- `POST /api/v1/personal/capabilities/skills`
  - body: `{ "schemaVersion": "vio-skill/v1", "name", "version", "description", "steps": [{ "stepId", "category": "local_tool|mcp_tool", "capabilityId", "operationName" }], "confirmationId"?: "..." }`
- `POST /api/v1/personal/capabilities/plugins`
  - body: `{ "schemaVersion": "vio-plugin/v1", "name", "version", "description", "actions": [{ "actionId", "skillId" }], "confirmationId"?: "..." }`
- `POST /api/v1/personal/capabilities/plugins/{capabilityId}/lifecycle`
  - body: `{ "action": "enable|disable|uninstall", "confirmationId"?: "..." }`

These operations use the existing high-risk security confirmation/audit path.
Exact idempotent replay reuses one definition/version/lifecycle fact. Conflicting
content fails. A plugin cannot be enabled unless every referenced skill remains
installed and enabled. Uninstall is a terminal local lifecycle fact and never
deletes prior versions or executions.

Every install/configure/discovery/lifecycle response has this exact operation
shape (in addition to the outer `{ "data": ... }` envelope):

```json
{
  "operationStatus": "completed|confirmation_required|denied|failed|outcome_unknown",
  "capability": null,
  "discovery": null,
  "security": {
    "decision": "allow|confirm|deny",
    "confirmationId": null,
    "confirmationStatus": "not_required|pending|approved|rejected|consumed|expired"
  },
  "error": null,
  "externalCall": "not_performed|performed|possibly_performed"
}
```

`capability` is the catalog item on completed install/lifecycle operations;
`discovery` is `{ "snapshotId", "status": "ready", "toolCount", "tools":
[{ "name", "description", "inputSchemaHash", "outputSchemaHash" }],
"externalCall": "performed" }` on completed discovery. Other unused fields are
explicitly `null`. A confirmation-required response includes only the opaque
`confirmationId` and `pending`; it does not expose the internal policy or
audit object. A denied response uses `confirmationId=null` and
`confirmationStatus=not_required`.

Discovery persists its exact terminal operation response under the original
idempotency key. An explicit failure is `operationStatus=failed`; an ambiguous
response boundary is `operationStatus=outcome_unknown` with
`externalCall=possibly_performed`. Replaying that key returns the frozen fact
and never issues another `tools/list`. `error`, when present, is exactly
`{ "code": string }`. A new external discovery requires a distinct explicit
operation and key; the old fact is never overwritten.

The MCP discovery response includes only snapshot identity, tool names,
descriptions, schema hashes, cache facts, and status. It never exposes the
service URL or raw headers.

Because official MCP tool `outputSchema` is optional, `outputSchemaHash` is a
`sha256:` hash when that schema is present and exactly `null` when it is absent.
After successful discovery, that MCP catalog item's `operations` array contains
the validated tool names in the persisted deterministic discovery order.

### Execute and recover

`POST /api/v1/personal/capability-executions`

```json
{
  "category": "local_tool|mcp_tool|skill|plugin_action",
  "capabilityId": "opaque-id",
  "operationName": "execute-or-tool-or-action-name",
  "input": {}
}
```

`GET /api/v1/personal/capability-executions/{executionId}` returns the exact
owner/current-assistant execution view.

`GET /api/v1/personal/capability-executions?category=&status=&cursor=&limit=`
returns `{ "schemaVersion": "vio-capability-execution-list/v1", "items":
[], "nextCursor": null }`. Items are the same execution view shown below,
ordered newest first. `limit` is 1-100 and defaults to 50.

`GET /api/v1/personal/capability-executions/by-idempotency-key/{key}` is the
query-first recovery entry and returns `{ "status": "not_found",
"execution": null }` or `{ "status": "found", "execution": <view> }`.

`POST /api/v1/personal/capability-executions/{executionId}/recovery`

```json
{ "action": "resume|retry|cancel", "confirmationId": "optional" }
```

Recovery has its own idempotency key. `resume` consumes an approved confirmation
or resumes a locally persisted result. `retry` is accepted only for a
`retryable` attempt: either the previous request was proved not sent, or the
endpoint returned a conclusive retryable response. A possibly-sent attempt
without a conclusive response is `outcome_unknown`, never `retryable`.
`cancel` is accepted only before a possibly-sent boundary.

The execution view is:

```json
{
  "schemaVersion": "vio-capability-execution/v1",
  "executionId": "opaque-id",
  "category": "local_tool",
  "capabilityId": "opaque-id",
  "capabilityVersion": "1",
  "operationName": "execute",
  "status": "succeeded",
  "attemptCount": 1,
  "inputHash": "sha256:...",
  "confirmation": null,
  "result": {
    "status": "succeeded",
    "contentHash": "sha256:...",
    "output": {},
    "usage": { "status": "not_incurred", "inputTokens": 0, "outputTokens": 0, "totalTokens": 0 },
    "cost": { "status": "not_incurred", "amountMicros": null, "currency": null }
  },
  "error": null,
  "createdAt": "RFC-3339 UTC",
  "updatedAt": "RFC-3339 UTC",
  "completedAt": "RFC-3339 UTC",
  "externalCall": "not_performed"
}
```

For `waiting_confirmation`, `confirmation` is exactly
`{ "confirmationId", "status": "pending" }`; other statuses return `null`.
Execution create and recovery always return the execution view directly.

When non-null, `error` is exactly `{ "code": string }`; retry safety is
expressed by the exact execution `status`, not a second boolean.
`externalCall` is exactly `not_performed`, `performed`, or
`possibly_performed`; the last value is reserved for an ambiguous external
boundary represented by `status=outcome_unknown`.

`input` is never returned. MCP raw responses are never returned. Local outputs
and accepted MCP structured/text result content are bounded, strict JSON only.

## Permission, security, and error semantics

Installation/configuration uses the existing high-risk configuration security
path. Execution uses existing permissions and security checks:

- local tool: `resourceType=tool`, `action=execute`;
- MCP discovery: `resourceType=mcp`, `action=connect`;
- MCP call: `resourceType=mcp`, `action=execute`;
- skill: `resourceType=skill`, `action=execute`, plus active permissions for
  every underlying step;
- plugin action: the referenced skill permission plus all underlying step
  permissions; plugin lifecycle itself is high-risk configuration.

The current verified assistant is the subject scope. Missing permission denies;
`ask`/policy confirmation persists `waiting_confirmation`; deny is terminal.
No tool execution consumes model tokens. Existing R1 model usage remains the
only source of model token/cost facts and is projected exactly once.

Stable public error codes include:

- `CAPABILITY_NOT_FOUND`, `CAPABILITY_DISABLED`, `CAPABILITY_UNINSTALLED`
- `CAPABILITY_INPUT_INVALID`, `CAPABILITY_OPERATION_UNSUPPORTED`
- `CAPABILITY_PERMISSION_DENIED`, `CAPABILITY_CONFIRMATION_REQUIRED`
- `CAPABILITY_IDEMPOTENCY_CONFLICT`, `CAPABILITY_RETRY_NOT_ALLOWED`
- `MCP_PROTOCOL_UNSUPPORTED`, `MCP_TARGET_UNSAFE`, `MCP_SCHEMA_UNSUPPORTED`
- `MCP_NETWORK_UNAVAILABLE`, `MCP_RESPONSE_INVALID`, `MCP_RESULT_TOO_LARGE`
- `CAPABILITY_OUTCOME_UNKNOWN`, `CAPABILITY_EXECUTION_INTERRUPTED`
- `SKILL_DEPENDENCY_UNAVAILABLE`, `PLUGIN_DEPENDENCY_UNAVAILABLE`

400/401/403/404/409/413/503 map through the existing application error
envelope. Errors never include a secret, endpoint, request/response body, stack,
or internal path.

## Deletion and retention

R6 rows participate in the existing owner deletion inventory and scoped delete
authority. No global trigger is disabled. Normal APIs never delete immutable
execution facts. Plugin uninstall changes lifecycle only. Existing R2 deletion
deadlines, minimal receipt retention, managed-copy rules, and restoration
blocking continue unchanged.

## R6 acceptance matrix

- migration 029 fresh, 001-028 upgrade, rollback, foreign keys, and immutable
  guards;
- personal session/CSRF/current-assistant scope; two assistants under one owner
  can independently install the same definitions and reuse operation keys while
  catalog, discovery, dependencies, lifecycle, execution/history, by-key
  recovery, restart recovery, and deletion remain isolated; cross-owner access
  is denied by the same contract;
- local tool deterministic execution and no shell/file/network effects;
- real loopback Streamable HTTP `tools/list` and `tools/call` with exact
  2026-07-28 headers/meta/schema/result validation;
- public HTTPS target validation, DNS pinning, private/loopback/redirect/header
  leakage refusal;
- skill multi-step orchestration and plugin install/enable/disable/uninstall;
- permission deny/ask/allow and security confirmation/audit behavior;
- idempotent replay, conflict, concurrency, retryable not-sent, possibly-sent
  unknown, query-first recovery, cancellation, process restart, immutable result;
- R1 model execution projected once with unchanged token/cost facts and no
  second Provider call;
- no real Engine access, no real credentials, no business internet, no paid
  calls; automated MCP/Provider tests use explicit random loopback servers only;
- historical R1-R5 and default backend regressions remain green.

R6 does not start R7 proactive execution, does not create a general plugin
marketplace, does not execute plugin scripts, and does not claim a controlled
loopback MCP server is a real third-party service acceptance.
