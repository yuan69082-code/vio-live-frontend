import { ApplicationError, ConflictError, NotFoundError, ValidationError } from '../../core/errors.js';
import { canonicalizeJson, sha256Hash } from '../../core/canonical-json.js';
import { createId } from '../../core/ids.js';
import { requireOpaqueResourceId } from '../../core/validation.js';
import { fields } from '../personal/personal-validation.js';

export const CONTEXT_CONTRACT_VERSION = 'vio-context-assembly/v1';
export const CONTEXT_SNAPSHOT_VERSION = 'vio-context-assembly-snapshot/v1';
export const CONTEXT_SUMMARY_VERSION = 'vio-context-summary/v1';
export const CONTEXT_MODES = Object.freeze(['concise', 'balanced', 'complete', 'custom']);
const HASH = /^sha256:[0-9a-f]{64}$/;
const KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const REF = /^[A-Za-z0-9._:-]{3,256}$/;
const MAX_EXCLUSIONS = 128;
const PREVIEW_LENGTH = 160;
const SYSTEM_RULES = 'Answer as the selected Vio assistant. Use only the locked context below. Do not claim access to omitted data.';
const RELEVANCE_STRATEGY = 'lexical-overlap-recency/v1';
const MODE = Object.freeze({
  concise: { fraction: 0.35, recent: 4, crossConversations: 0, crossMessages: 0 },
  balanced: { fraction: 0.65, recent: 8, crossConversations: 3, crossMessages: 2 },
  complete: { fraction: 1, recent: 24, crossConversations: 8, crossMessages: 4 },
  custom: { fraction: 0.65, recent: 8, crossConversations: 3, crossMessages: 2 },
});

function coded(code, message, statusCode = 409, details) {
  return new ApplicationError(message, { code, statusCode, details });
}

function hash(value) { return sha256Hash(canonicalizeJson(value)); }

function strictJson(value, field) {
  try { canonicalizeJson(value); } catch {
    throw coded('CONTEXT_RESPONSE_INVALID', 'Context data is not strict JSON.', 400, { field });
  }
  return value;
}

function immutableJson(value) {
  const cloned = structuredClone(value);
  const freeze = (item) => {
    if (item && typeof item === 'object') {
      for (const child of Object.values(item)) freeze(child);
      Object.freeze(item);
    }
    return item;
  };
  return freeze(cloned);
}

function key(value) {
  if (typeof value !== 'string' || !KEY.test(value)) {
    throw new ValidationError('Invalid Idempotency-Key.', { field: 'Idempotency-Key' });
  }
  return value;
}

function uniqueRefs(value = []) {
  if (!Array.isArray(value) || value.length > MAX_EXCLUSIONS) {
    throw coded('CONTEXT_EXCLUSIONS_INVALID', 'Context exclusions must be a bounded array.', 400);
  }
  const refs = value.map((item, index) => {
    if (typeof item !== 'string' || !REF.test(item)) {
      throw coded('CONTEXT_EXCLUSIONS_INVALID', 'Context exclusion is invalid.', 400, {
        field: `excludedSourceRefs[${index}]`,
      });
    }
    return item;
  });
  if (new Set(refs).size !== refs.length) {
    throw coded('CONTEXT_EXCLUSIONS_INVALID', 'Context exclusions must be unique.', 400);
  }
  if (refs.some(ref => ref.startsWith('system-rules:')
      || ref.startsWith('assistant-settings:') || ref.startsWith('current-message:'))) {
    throw coded('CONTEXT_EXCLUSIONS_INVALID', 'Mandatory context sources cannot be excluded.', 400);
  }
  return Object.freeze([...refs]);
}

export function validateContextControls(value, defaultMode = 'balanced') {
  if (value === undefined || value === null) {
    if (!CONTEXT_MODES.includes(defaultMode)) defaultMode = 'balanced';
    return Object.freeze({ mode: defaultMode, excludedSourceRefs: Object.freeze([]), expectedPlanHash: null });
  }
  fields(value, ['mode', 'excludedSourceRefs', 'expectedPlanHash']);
  const mode = value.mode ?? defaultMode;
  if (!CONTEXT_MODES.includes(mode)) {
    throw coded('CONTEXT_MODE_INVALID', 'Context mode is not supported.', 400, { field: 'context.mode' });
  }
  const excludedSourceRefs = uniqueRefs(value.excludedSourceRefs ?? []);
  if (mode !== 'custom' && excludedSourceRefs.length) {
    throw coded('CONTEXT_EXCLUSIONS_INVALID', 'Only custom mode accepts exclusions.', 400);
  }
  const expectedPlanHash = value.expectedPlanHash ?? null;
  if (expectedPlanHash !== null && (typeof expectedPlanHash !== 'string' || !HASH.test(expectedPlanHash))) {
    throw coded('CONTEXT_RESPONSE_INVALID', 'expectedPlanHash is invalid.', 400, {
      field: 'context.expectedPlanHash',
    });
  }
  return Object.freeze({ mode, excludedSourceRefs, expectedPlanHash });
}

export function estimateContextTokens(messages) {
  strictJson(messages, 'messages');
  if (!Array.isArray(messages) || messages.some(item => !item || !['system', 'user', 'assistant'].includes(item.role)
      || typeof item.content !== 'string')) {
    throw coded('CONTEXT_RESPONSE_INVALID', 'Provider messages are invalid.', 400);
  }
  return 256 + messages.reduce((total, item) => total + 64 + Buffer.byteLength(item.content, 'utf8'), 0);
}

function excerpt(value, max = PREVIEW_LENGTH) {
  const normalized = String(value).replace(/\s+/gu, ' ').trim();
  return [...normalized].slice(0, max).join('');
}

export function createStructuredContextSummary(sources, { summaryId, scope, createdAt }) {
  const lines = sources.map(item => excerpt(item.source.content, 360)).filter(Boolean);
  const select = pattern => lines.filter(line => pattern.test(line)).slice(0, 8);
  const structured = {
    schemaVersion: CONTEXT_SUMMARY_VERSION,
    summaryId,
    scope: {
      conversationId: scope.conversationId,
      branchId: scope.branchId,
    },
    decisions: select(/决定|选择|采用|agreed|decid/iu),
    tasks: select(/待办|下一步|需要|应该|todo|task/iu),
    unresolvedItems: select(/\?|？|待确认|未解决|unknown|pending/iu),
    importantRelationships: select(/关系|属于|依赖|关联|relationship|depends/iu),
    supportingExcerpts: lines.slice(0, 8),
    sourceRefs: sources.map(item => item.sourceRef),
    createdAt,
  };
  return Object.freeze(structured);
}

function exactObject(value, allowed, field) {
  strictJson(value, field);
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(keyValue => !allowed.includes(keyValue))) {
    throw coded('CONTEXT_SUMMARY_INVALID', 'Structured context summary is invalid.', 400,
      { field });
  }
  return value;
}

function summaryStrings(value, field) {
  if (!Array.isArray(value) || value.length > 8
      || value.some(item => typeof item !== 'string' || item.length > 2_048)) {
    throw coded('CONTEXT_SUMMARY_INVALID', 'Structured context summary is invalid.', 400,
      { field });
  }
  return value;
}

function validUtcTimestamp(value) {
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/u.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second] = match;
  const values = [year, month, day, hour, minute, second].map(Number);
  if (values[1] < 1 || values[1] > 12 || values[2] < 1 || values[2] > 31
      || values[3] > 23 || values[4] > 59 || values[5] > 59) return false;
  const parsed = new Date(Date.UTC(values[0], values[1] - 1, values[2], values[3], values[4], values[5]));
  return parsed.getUTCFullYear() === values[0] && parsed.getUTCMonth() === values[1] - 1
    && parsed.getUTCDate() === values[2] && parsed.getUTCHours() === values[3]
    && parsed.getUTCMinutes() === values[4] && parsed.getUTCSeconds() === values[5];
}

function validateStructuredContextSummary(value, { summaryId, scope, sourceRefs, createdAt }) {
  const item = exactObject(value, ['schemaVersion', 'summaryId', 'scope', 'decisions', 'tasks',
    'unresolvedItems', 'importantRelationships', 'supportingExcerpts', 'sourceRefs', 'createdAt'],
  'structuredSummary');
  const summaryScope = exactObject(item.scope, ['conversationId', 'branchId'],
    'structuredSummary.scope');
  if (item.schemaVersion !== CONTEXT_SUMMARY_VERSION || item.summaryId !== summaryId
      || summaryScope.conversationId !== scope.conversationId
      || summaryScope.branchId !== scope.branchId || item.createdAt !== createdAt
      || !validUtcTimestamp(item.createdAt)) {
    throw coded('CONTEXT_SUMMARY_INVALID', 'Structured context summary scope is invalid.', 400,
      { field: 'structuredSummary.scope' });
  }
  for (const field of ['decisions', 'tasks', 'unresolvedItems', 'importantRelationships',
    'supportingExcerpts']) summaryStrings(item[field], `structuredSummary.${field}`);
  if (!Array.isArray(item.sourceRefs) || item.sourceRefs.length !== sourceRefs.length
      || item.sourceRefs.some((ref, index) => typeof ref !== 'string' || !REF.test(ref)
        || ref !== sourceRefs[index])) {
    throw coded('CONTEXT_SUMMARY_INVALID', 'Structured context summary sources are invalid.', 400,
      { field: 'structuredSummary.sourceRefs' });
  }
  return Object.freeze(structuredClone(item));
}

function lexicalTerms(value) {
  const normalized = String(value ?? '').normalize('NFKC').toLocaleLowerCase('en-US');
  const terms = new Set();
  for (const token of normalized.match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (/^[\p{Script=Han}]+$/u.test(token)) {
      const points = [...token];
      for (const point of points) terms.add(point);
      for (let index = 0; index + 1 < points.length; index += 1) {
        terms.add(points[index] + points[index + 1]);
      }
    } else if (token.length >= 2) terms.add(token);
    if (terms.size >= 256) break;
  }
  return terms;
}

function relevance(content, query) {
  const queryTerms = lexicalTerms(query);
  if (!queryTerms.size) return { score: 0, matchedTermCount: 0 };
  const contentTerms = lexicalTerms(content);
  let matchedTermCount = 0;
  for (const term of queryTerms) if (contentTerms.has(term)) matchedTermCount += 1;
  return { score: matchedTermCount * 1_000, matchedTermCount };
}

function defaultLimitPort() {
  return Object.freeze({
    resolve() {
      return Object.freeze({ contextLimitTokens: 16_384, reservedOutputTokens: 4_096,
        source: 'vio_conservative_policy' });
    },
  });
}

function defaultSourceAccessPort() {
  return Object.freeze({
    canRead() { return true; },
  });
}

function source({ sourceRef, sourceType, slot, origin, content, role = 'system',
  conversationId = null, branchId = null, messageId = null, messageVersionId = null,
  eventId = null, summaryId = null, createdAt, evidence = {}, sourceData,
  mandatory = false, contentHash = null }) {
  strictJson(evidence, 'source.evidence');
  if (sourceData !== undefined) strictJson(sourceData, 'source.data');
  const payload = { content, role, ...(sourceData === undefined ? {} : { data: sourceData }) };
  return {
    sourceRef, sourceType, slot, origin, status: 'included', reason: null,
    sourceConversationId: conversationId, sourceBranchId: branchId,
    messageId, messageVersionId, eventId, summaryId,
    contentHash: contentHash ?? hash(payload), estimatedTokens: estimateContextTokens([payload]),
    source: payload, evidence: { ...evidence, preview: evidence.preview ?? excerpt(content) },
    createdAt, mandatory,
  };
}

function publicSource(item) {
  return Object.freeze({
    sourceRef: item.sourceRef, sourceType: item.sourceType, slot: item.slot,
    origin: item.origin, status: item.status, reason: item.reason ?? null,
    conversationId: item.sourceConversationId ?? null,
    branchId: item.sourceBranchId ?? null, messageId: item.messageId ?? null,
    messageVersionId: item.messageVersionId ?? null, eventId: item.eventId ?? null,
    summaryId: item.summaryId ?? null, contentHash: item.contentHash,
    estimatedTokens: item.estimatedTokens, createdAt: item.createdAt,
    evidence: Object.freeze({ ...item.evidence }),
  });
}

function slotStatus(sources, slot, fallback) {
  const selected = sources.filter(item => item.slot === slot && item.status === 'included');
  return Object.freeze({ slot, status: selected.length ? 'included' : fallback });
}

export function createContextAssemblyService({
  repository,
  personalIdentityService,
  multiConversationRepository,
  standaloneChatRepository,
  eventRepository,
  modelRouterService,
  subjectRuntimeStatusService,
  runtimeProjectionPort = null,
  modelContextLimitPort = defaultLimitPort(),
  sourceAccessPort = defaultSourceAccessPort(),
  summaryBuilder = createStructuredContextSummary,
  runInTransaction,
  clock = () => new Date(),
  idFactory = createId,
  standaloneRecoveryPort = null,
}) {
  function scope(context) {
    personalIdentityService.assertSessionActive?.(context);
    const identity = personalIdentityService.identity(context.userId);
    if (!identity.current_assistant_id) throw coded('ASSISTANT_NOT_SELECTED', 'Select an assistant first.');
    const assistant = personalIdentityService.assistant(context.userId, identity.current_assistant_id);
    if (assistant.status !== 'active') throw coded('ASSISTANT_NOT_SELECTED', 'Selected assistant is inactive.');
    return { userId: context.userId, assistantId: assistant.assistantId, assistant };
  }

  function conversation(s, conversationId, branchId = null) {
    const id = requireOpaqueResourceId(conversationId, 'conversationId');
    const current = multiConversationRepository.findConversation(s.userId, s.assistantId, id);
    if (!current || current.status === 'deleted') throw new NotFoundError('Conversation was not found.');
    const selectedBranch = branchId ?? current.currentBranchId;
    const branch = multiConversationRepository.findBranch(s.userId, s.assistantId,
      current.conversationId, requireOpaqueResourceId(selectedBranch, 'branchId'));
    if (!branch) throw new NotFoundError('Branch was not found.');
    return { conversation: current, branch };
  }

  function defaults(s, conversationId) {
    const stored = repository.findSettings(s.userId, s.assistantId, conversationId);
    const personalMode = CONTEXT_MODES.includes(s.assistant.settings?.contextMode)
      ? s.assistant.settings.contextMode : 'balanced';
    return { stored, personalMode, controls: stored
      ? { mode: stored.mode, excludedSourceRefs: stored.excludedSourceRefs, expectedPlanHash: null }
      : { mode: personalMode, excludedSourceRefs: [], expectedPlanHash: null },
    controlsSource: stored ? 'conversation' : 'personal_default' };
  }

  function settingsView(s, current) {
    const conversationId = current.conversation.conversationId;
    const { stored, personalMode, controls, controlsSource } = defaults(s, conversationId);
    const gathered = gather({ s, current, controls });
    const evaluated = evaluateExclusions(gathered.sources, controls,
      gathered.availableSourceRefs, false);
    return Object.freeze({
      contractVersion: CONTEXT_CONTRACT_VERSION,
      conversationId,
      personalDefault: Object.freeze({ mode: personalMode, source: 'assistant_settings' }),
      conversation: stored ? Object.freeze({ mode: stored.mode,
        excludedSourceRefs: Object.freeze([...stored.excludedSourceRefs]), version: stored.version,
        unavailableExcludedSourceRefs: evaluated.unavailableExcludedSourceRefs,
        updatedAt: stored.updatedAt }) : null,
      effective: Object.freeze({ mode: controls.mode,
        excludedSourceRefs: evaluated.activeExcludedSourceRefs,
        unavailableExcludedSourceRefs: evaluated.unavailableExcludedSourceRefs,
        source: controlsSource }),
      externalCall: 'not_performed',
    });
  }

  function resolveTurnControls(scopeValue, conversationId, value) {
    const s = scope(scopeValue);
    const current = conversation(s, conversationId);
    const settingsValue = defaults(s, current.conversation.conversationId);
    const explicit = value !== undefined && value !== null;
    const controls = explicit ? validateContextControls(value, settingsValue.controls.mode)
      : validateContextControls(settingsValue.controls, settingsValue.controls.mode);
    const gathered = gather({ s, current, controls });
    const evaluated = evaluateExclusions(gathered.sources, controls,
      gathered.availableSourceRefs, explicit);
    return Object.freeze({ ...controls,
      excludedSourceRefs: evaluated.activeExcludedSourceRefs,
      unavailableExcludedSourceRefs: evaluated.unavailableExcludedSourceRefs,
      controlsSource: explicit ? 'turn' : settingsValue.controlsSource });
  }

  function assistantSettingsContent(assistant) {
    const settings = assistant.settings ?? {};
    return [
      `Assistant name: ${assistant.name}`,
      settings.positioning ? `Positioning: ${settings.positioning}` : null,
      settings.personality ? `Personality: ${settings.personality}` : null,
      settings.persona ? `Persona: ${settings.persona}` : null,
      settings.requirements ? `Requirements: ${settings.requirements}` : null,
    ].filter(Boolean).join('\n');
  }

  function runtimeSource(s, now) {
    const status = subjectRuntimeStatusService.getStatus();
    if (status.mode !== 'external' || status.state !== 'ready' || !runtimeProjectionPort) return null;
    const value = runtimeProjectionPort.readVerifiedProjection({
      userId: s.userId, assistantId: s.assistantId,
    });
    if (!value) return null;
    strictJson(value, 'runtimeProjection');
    if (value.verified !== true || typeof value.projectionId !== 'string'
        || typeof value.content !== 'string' || !value.verifiedAt) {
      throw coded('CONTEXT_RESPONSE_INVALID', 'Runtime projection is not verified.', 400);
    }
    return source({ sourceRef: `runtime-projection:${value.projectionId}`,
      sourceType: 'runtime_projection', slot: 'runtime_projection', origin: 'runtime',
      content: value.content, createdAt: value.verifiedAt ?? now,
      evidence: { runtimeName: status.runtimeName, verifiedAt: value.verifiedAt } });
  }

  function messageSource(item, origin) {
    return source({
      sourceRef: `message-version:${item.messageVersionId}`,
      sourceType: 'message_version', slot: 'recent_original_text', origin,
      content: item.content, role: item.senderType === 'user' ? 'user' : 'assistant',
      conversationId: item.conversationId, branchId: item.branchId,
      messageId: item.messageId, messageVersionId: item.messageVersionId,
      createdAt: item.versionCreatedAt,
      evidence: { senderType: item.senderType, versionKind: item.versionKind },
    });
  }

  function isInternallyEligible(s, item) {
    if (item.sourceType === 'runtime_projection') return true;
    if (item.sourceType === 'event') {
      const event = eventRepository.findById(s.userId, item.eventId);
      return Boolean(event && event.subjectId === s.assistantId && event.status === 'pending');
    }
    if (item.sourceType === 'message_version') {
      const parent = multiConversationRepository.findConversation(s.userId, s.assistantId,
        item.sourceConversationId);
      if (!parent || parent.status !== 'active') return false;
      const branch = multiConversationRepository.findBranch(s.userId, s.assistantId,
        parent.conversationId, item.sourceBranchId);
      if (!branch) return false;
      return multiConversationRepository.listBranchMessages(s.userId, s.assistantId,
        parent.conversationId, branch.branchId).some(value =>
        value.messageId === item.messageId && value.messageVersionId === item.messageVersionId);
    }
    if (item.sourceType === 'summary') return true;
    return item.mandatory === true;
  }

  function canReadSource(s, item) {
    if (!isInternallyEligible(s, item)) return false;
    const result = sourceAccessPort.canRead({
      userId: s.userId,
      assistantId: s.assistantId,
      sourceRef: item.sourceRef,
      sourceType: item.sourceType,
      origin: item.origin,
      conversationId: item.sourceConversationId,
      branchId: item.sourceBranchId,
      messageId: item.messageId,
      messageVersionId: item.messageVersionId,
      eventId: item.eventId,
    });
    if (result !== true && result !== false) {
      throw coded('CONTEXT_RESPONSE_INVALID', 'Context source access decision is invalid.', 400);
    }
    return result;
  }

  function checkedSummary(s, persisted) {
    if (!persisted || persisted.status !== 'ready' || !persisted.structuredSummary
        || !persisted.contentHash) return null;
    const summarySources = repository.listSummarySources(persisted.summaryId);
    const sourceRefs = summarySources.map(item => item.sourceRef);
    const structured = validateStructuredContextSummary(persisted.structuredSummary, {
      summaryId: persisted.summaryId,
      scope: { conversationId: persisted.conversationId, branchId: persisted.branchId },
      sourceRefs,
      createdAt: persisted.structuredSummary.createdAt,
    });
    if (hash(structured) !== persisted.contentHash) {
      throw coded('CONTEXT_LEDGER_INCONSISTENT', 'Context summary hash is inconsistent.', 500);
    }
    for (const item of summarySources) {
      if (hash(item.source) !== item.contentHash) {
        throw coded('CONTEXT_LEDGER_INCONSISTENT',
          'Context summary source hash is inconsistent.', 500);
      }
      const candidate = source({ sourceRef: item.sourceRef, sourceType: item.sourceType,
        slot: item.sourceType === 'event' ? 'unresolved_events' : 'recent_original_text',
        origin: item.sourceType === 'event' ? 'event' : 'current_conversation',
        content: item.source.content, role: item.source.role,
        conversationId: persisted.conversationId, branchId: persisted.branchId,
        messageId: item.messageId, messageVersionId: item.messageVersionId,
        eventId: item.eventId, createdAt: persisted.completedAt,
        contentHash: item.contentHash });
      if (!canReadSource(s, candidate)) return null;
    }
    return { persisted, structured, summarySources };
  }

  function summarySource(value, origin) {
    return source({ sourceRef: `summary:${value.persisted.summaryId}`,
      sourceType: 'summary', slot: 'recent_original_text', origin,
      content: JSON.stringify(value.structured),
      conversationId: value.persisted.conversationId,
      branchId: value.persisted.branchId, summaryId: value.persisted.summaryId,
      createdAt: value.persisted.completedAt, contentHash: value.persisted.contentHash,
      evidence: { kind: 'structured_summary', sourceCount: value.summarySources.length } });
  }

  function gather({ s, current, controls, currentMessageVersionId = null }) {
    const now = clock().toISOString();
    const sources = [
      source({ sourceRef: 'system-rules:vio-r4', sourceType: 'system_rule',
        slot: 'system_rules', origin: 'system', content: SYSTEM_RULES,
        createdAt: now, evidence: { kind: 'system_rules' }, mandatory: true }),
      source({ sourceRef: `assistant-settings:${s.assistantId}:${s.assistant.version}`,
        sourceType: 'assistant_settings', slot: 'assistant_settings', origin: 'assistant',
        content: assistantSettingsContent(s.assistant), createdAt: now,
        evidence: { version: s.assistant.version }, mandatory: true }),
    ];
    const runtime = runtimeSource(s, now);
    if (runtime && canReadSource(s, runtime)) sources.push(runtime);
    const pendingEvents = eventRepository.findMany({ userId: s.userId,
      subjectId: s.assistantId, status: 'pending',
      excludedEventTypes: ['message_created', 'message_updated'], limit: 20 });
    for (const event of pendingEvents) {
      const content = `Unresolved event: ${event.eventType}. ${event.summary}`;
      const candidate = source({ sourceRef: `event:${event.eventId}`, sourceType: 'event',
        slot: 'unresolved_events', origin: 'event', content,
        eventId: event.eventId, createdAt: event.occurredAt,
        evidence: { eventType: event.eventType, summary: event.summary },
        sourceData: event.data });
      if (canReadSource(s, candidate)) sources.push(candidate);
    }

    const visible = multiConversationRepository.listBranchMessages(s.userId, s.assistantId,
      current.conversation.conversationId, current.branch.branchId)
      .filter(item => item.messageVersionId !== currentMessageVersionId);
    for (const item of visible) {
      const candidate = messageSource(item, 'current_conversation');
      if (canReadSource(s, candidate)) sources.push(candidate);
    }

    const policy = MODE[controls.mode];
    let queryText = visible.slice(-4).map(item => item.content).join('\n');
    let currentItem = null;
    if (currentMessageVersionId) {
      currentItem = multiConversationRepository.listBranchMessages(s.userId, s.assistantId,
        current.conversation.conversationId, current.branch.branchId)
        .find(candidate => candidate.messageVersionId === currentMessageVersionId);
      if (!currentItem) throw coded('CONTEXT_LEDGER_INCONSISTENT',
        'Current turn message is not on its branch.', 500);
      queryText = currentItem.content;
    }
    const crossCandidates = [];
    if (policy.crossConversations) {
      const others = multiConversationRepository.listConversations(s.userId, s.assistantId)
        .filter(item => item.status === 'active'
          && item.conversationId !== current.conversation.conversationId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)
          || a.conversationId.localeCompare(b.conversationId));
      for (const other of others) {
        const branch = multiConversationRepository.findBranch(s.userId, s.assistantId,
          other.conversationId, other.currentBranchId);
        if (!branch) continue;
        let candidateSources = [];
        let representation = 'original_fallback';
        for (const persisted of repository.listReadySummaries(s.userId, s.assistantId,
          other.conversationId, branch.branchId)) {
          const checked = checkedSummary(s, persisted);
          if (!checked) continue;
          const candidate = summarySource(checked, 'cross_window');
          if (canReadSource(s, candidate)) {
            candidateSources = [candidate];
            representation = 'latest_ready_summary';
            break;
          }
        }
        if (!candidateSources.length) {
          const messages = multiConversationRepository.listBranchMessages(s.userId, s.assistantId,
            other.conversationId, branch.branchId).slice(-policy.crossMessages);
          candidateSources = messages.map(item => messageSource(item, 'cross_window'))
            .filter(item => canReadSource(s, item));
        }
        if (!candidateSources.length) continue;
        const score = candidateSources.reduce((total, item) =>
          total + relevance(item.source.content, queryText).score, 0);
        const matchedTermCount = candidateSources.reduce((total, item) =>
          total + relevance(item.source.content, queryText).matchedTermCount, 0);
        crossCandidates.push({ conversation: other, sources: candidateSources,
          representation, score, matchedTermCount });
      }
    }
    crossCandidates.sort((left, right) => right.score - left.score
      || right.conversation.updatedAt.localeCompare(left.conversation.updatedAt)
      || left.conversation.conversationId.localeCompare(right.conversation.conversationId));
    const selected = crossCandidates.slice(0, policy.crossConversations);
    selected.forEach((candidate, index) => {
      for (const item of candidate.sources) {
        item.evidence = { ...item.evidence, selection: {
          strategy: RELEVANCE_STRATEGY, relevanceScore: candidate.score,
          matchedTermCount: candidate.matchedTermCount, rank: index + 1,
          representation: candidate.representation,
        } };
        sources.push(item);
      }
    });
    if (currentItem) {
      const currentSource = messageSource(currentItem, 'current_turn');
      currentSource.slot = 'current_user_message';
      currentSource.sourceRef = `current-message:${currentItem.messageVersionId}`;
      currentSource.mandatory = true;
      sources.push(currentSource);
    }
    const availableSourceRefs = new Set(sources.filter(item => !item.mandatory)
      .map(item => item.sourceRef));
    for (const candidate of crossCandidates) {
      for (const item of candidate.sources) availableSourceRefs.add(item.sourceRef);
    }
    const planBasis = [...sources.filter(item => item.slot !== 'current_user_message'),
      ...crossCandidates.flatMap(candidate => candidate.sources)]
      .map(item => ({ sourceRef: item.sourceRef, contentHash: item.contentHash }))
      .filter((item, index, values) => values.findIndex(value => value.sourceRef === item.sourceRef) === index)
      .sort((left, right) => left.sourceRef.localeCompare(right.sourceRef));
    return { sources, availableSourceRefs, planBasis,
      selection: Object.freeze({ strategy: RELEVANCE_STRATEGY,
        status: currentMessageVersionId ? 'final' : 'provisional',
        querySource: currentMessageVersionId ? 'current_user_message' : 'conversation_history',
        crossWindowCandidateCount: crossCandidates.length,
        crossWindowSelectedCount: selected.length }) };
  }

  function evaluateExclusions(sources, controls, availableSourceRefs, strict) {
    const unavailable = controls.excludedSourceRefs.filter(ref => !availableSourceRefs.has(ref));
    if (strict && unavailable.length) {
      throw coded('CONTEXT_SOURCE_FORBIDDEN', 'Context source is unavailable.', 403,
        { sourceRefs: unavailable });
    }
    const active = controls.excludedSourceRefs.filter(ref => availableSourceRefs.has(ref));
    return { sources: sources.map(item => active.includes(item.sourceRef)
      ? { ...item, status: 'excluded', reason: 'user_excluded' } : item),
    activeExcludedSourceRefs: Object.freeze(active),
    unavailableExcludedSourceRefs: Object.freeze(unavailable) };
  }

  function planHashFor({ s, current, controls, sources, limit }) {
    return hash({ contractVersion: CONTEXT_CONTRACT_VERSION, userId: s.userId,
      assistantId: s.assistantId, conversationId: current.conversation.conversationId,
      branchId: current.branch.branchId, mode: controls.mode,
      excludedSourceRefs: controls.excludedSourceRefs,
      unavailableExcludedSourceRefs: controls.unavailableExcludedSourceRefs ?? [],
      sourceInventory: sources, limit });
  }

  function limitFor(model, mode) {
    const value = modelContextLimitPort.resolve({ model });
    if (!Number.isSafeInteger(value?.contextLimitTokens) || value.contextLimitTokens < 1024
        || !Number.isSafeInteger(value.reservedOutputTokens) || value.reservedOutputTokens < 1
        || value.reservedOutputTokens >= value.contextLimitTokens) {
      throw coded('CONTEXT_RESPONSE_INVALID', 'Model context limit is invalid.', 400);
    }
    const full = value.contextLimitTokens - value.reservedOutputTokens;
    return Object.freeze({ contextLimitTokens: value.contextLimitTokens,
      reservedOutputTokens: value.reservedOutputTokens,
      inputBudgetTokens: Math.floor(full * MODE[mode].fraction), source: value.source ?? 'adapter' });
  }

  function providerMessages(sources) {
    return sources.filter(item => item.status === 'included')
      .map(item => Object.freeze({ role: item.source.role, content: item.source.content }));
  }

  function maybeFold({ s, current, controls, sources, budget, forceRetry = false }) {
    const historical = sources.filter(item => item.sourceType === 'message_version'
      && item.origin === 'current_conversation' && item.status === 'included');
    const threshold = MODE[controls.mode].recent;
    if (historical.length <= threshold) return { sources, foldingStatus: 'not_required',
      summary: null, sourceSetHash: null, sourceCount: 0 };
    const folding = historical.slice(0, historical.length - threshold);
    const sourceSetHash = hash(folding.map(item => ({ ref: item.sourceRef, hash: item.contentHash })));
    let persisted = repository.findSummary(s.userId, s.assistantId,
      current.conversation.conversationId, current.branch.branchId, sourceSetHash);
    if (persisted?.status === 'ready') {
      const checked = checkedSummary(s, persisted);
      if (!checked) throw coded('CONTEXT_LEDGER_INCONSISTENT',
        'Ready context summary sources are no longer eligible for this build.', 500);
      const summaryItem = summarySource(checked, 'current_conversation');
      return { sources: sources.map(item => folding.includes(item)
        ? { ...item, status: 'summarized', reason: 'folded_into_summary' } : item)
        .concat(summaryItem), foldingStatus: 'ready', summary: persisted,
      sourceSetHash, sourceCount: folding.length };
    }
    if (!persisted) {
      persisted = repository.insertSummary({ summaryId: idFactory(), userId: s.userId,
        assistantId: s.assistantId, conversationId: current.conversation.conversationId,
        branchId: current.branch.branchId, sourceSetHash, createdAt: clock().toISOString() }, folding);
    } else if (persisted.status === 'failed' && forceRetry) {
      // The summary identity/source set is stable; a failed state may enter one new build attempt.
      persisted = repository.restartSummary(persisted.summaryId, clock().toISOString());
    } else if (persisted.status === 'failed') {
      const originalMessages = providerMessages(sources);
      if (estimateContextTokens(originalMessages) <= budget.inputBudgetTokens) {
        return { sources, foldingStatus: 'failed_fallback_original', summary: persisted,
          sourceSetHash, sourceCount: folding.length };
      }
      return { sources, foldingStatus: 'failed', summary: persisted,
        sourceSetHash, sourceCount: folding.length, failureCode: 'CONTEXT_FOLDING_FAILED' };
    }
    const startedAt = clock().toISOString();
    try {
      const structured = validateStructuredContextSummary(summaryBuilder(immutableJson(folding), {
        summaryId: persisted.summaryId,
        scope: { conversationId: persisted.conversationId, branchId: persisted.branchId },
        createdAt: startedAt }), { summaryId: persisted.summaryId,
        scope: { conversationId: persisted.conversationId, branchId: persisted.branchId },
        sourceRefs: folding.map(item => item.sourceRef), createdAt: startedAt });
      const contentHash = hash(structured);
      const ready = repository.completeSummary({ summaryId: persisted.summaryId,
        expectedStatus: 'building', status: 'ready', structuredSummary: structured,
        contentHash, failureCode: null,
        attemptCount: persisted.attemptCount + 1, completedAt: clock().toISOString() });
      repository.insertSummaryAttempt({ attemptId: idFactory(), summaryId: ready.summaryId,
        attemptNumber: ready.attemptCount, status: 'succeeded', startedAt,
        completedAt: ready.completedAt });
      const summaryItem = summarySource({ persisted: ready, structured,
        summarySources: repository.listSummarySources(ready.summaryId) }, 'current_conversation');
      return { sources: sources.map(item => folding.includes(item)
        ? { ...item, status: 'summarized', reason: 'folded_into_summary' } : item)
        .concat(summaryItem), foldingStatus: 'ready', summary: ready,
      sourceSetHash, sourceCount: folding.length };
    } catch (error) {
      const completedAt = clock().toISOString();
      const failed = repository.completeSummary({ summaryId: persisted.summaryId,
        expectedStatus: 'building', status: 'failed', structuredSummary: null,
        contentHash: null, failureCode: 'SUMMARY_BUILD_FAILED',
        attemptCount: persisted.attemptCount + 1, completedAt });
      repository.insertSummaryAttempt({ attemptId: idFactory(), summaryId: failed.summaryId,
        attemptNumber: failed.attemptCount, status: 'failed', errorCode: 'SUMMARY_BUILD_FAILED',
        startedAt, completedAt });
      if (estimateContextTokens(providerMessages(sources)) <= budget.inputBudgetTokens) {
        return { sources, foldingStatus: 'failed_fallback_original', summary: failed,
          sourceSetHash, sourceCount: folding.length };
      }
      return { sources, foldingStatus: 'failed', summary: failed,
        sourceSetHash, sourceCount: folding.length,
        failureCode: 'CONTEXT_FOLDING_FAILED', cause: error };
    }
  }

  function previewFold({ s, current, controls, sources, budget }) {
    const historical = sources.filter(item => item.sourceType === 'message_version'
      && item.origin === 'current_conversation' && item.status === 'included');
    const threshold = MODE[controls.mode].recent;
    if (historical.length <= threshold) return { sources, foldingStatus: 'not_required',
      summary: null, sourceSetHash: null, sourceCount: 0 };
    const folding = historical.slice(0, historical.length - threshold);
    const sourceSetHash = hash(folding.map(item => ({ ref: item.sourceRef, hash: item.contentHash })));
    const persisted = repository.findSummary(s.userId, s.assistantId,
      current.conversation.conversationId, current.branch.branchId, sourceSetHash);
    let summaryItem;
    let summary = null;
    let foldingStatus = 'planned';
    if (persisted?.status === 'ready') {
      const checked = checkedSummary(s, persisted);
      if (checked) {
        summaryItem = summarySource(checked, 'current_conversation');
        summary = persisted;
        foldingStatus = 'ready';
      }
    }
    if (!summaryItem) {
      const summaryId = `preview-${sourceSetHash.slice(7)}`;
      const createdAt = folding.at(-1)?.createdAt ?? clock().toISOString();
      const structured = createStructuredContextSummary(folding, { summaryId,
        scope: { conversationId: current.conversation.conversationId,
          branchId: current.branch.branchId }, createdAt });
      summaryItem = source({ sourceRef: `summary:${summaryId}`, sourceType: 'summary',
        slot: 'recent_original_text', origin: 'current_conversation',
        content: JSON.stringify(structured), conversationId: current.conversation.conversationId,
        branchId: current.branch.branchId, summaryId: null, createdAt,
        contentHash: hash(structured), evidence: { kind: 'structured_summary',
          sourceCount: folding.length } });
    }
    return { sources: sources.map(item => folding.includes(item)
      ? { ...item, status: 'summarized', reason: 'folded_into_summary' } : item)
      .concat(summaryItem), foldingStatus, summary, sourceSetHash,
    sourceCount: folding.length };
  }

  function trim(sources, budget) {
    const current = [...sources];
    const removable = current.filter(item => !item.mandatory && item.status === 'included')
      .sort((left, right) => {
        const rank = item => item.origin === 'cross_window' ? 0
          : item.origin === 'event' ? 1 : item.sourceType === 'message_version' ? 2 : 3;
        return rank(left) - rank(right) || left.createdAt.localeCompare(right.createdAt)
          || left.sourceRef.localeCompare(right.sourceRef);
      });
    let messages = providerMessages(current);
    let estimate = estimateContextTokens(messages);
    while (estimate > budget.inputBudgetTokens && removable.length) {
      const item = removable.shift();
      item.status = 'trimmed'; item.reason = 'model_input_budget';
      messages = providerMessages(current); estimate = estimateContextTokens(messages);
    }
    return { sources: current, messages, estimate,
      trimmingApplied: current.some(item => item.status === 'trimmed'),
      trimmingReason: current.some(item => item.status === 'trimmed') ? 'model_input_budget' : null };
  }

  function slotsFor(sources, currentPending = false) {
    return Object.freeze([
      slotStatus(sources, 'system_rules', 'empty'),
      slotStatus(sources, 'assistant_settings', 'empty'),
      slotStatus(sources, 'runtime_projection', 'not_available'),
      slotStatus(sources, 'unresolved_events', 'empty'),
      slotStatus(sources, 'recent_original_text', 'empty'),
      Object.freeze({ slot: 'long_term_memory', status: 'not_implemented' }),
      currentPending ? Object.freeze({ slot: 'current_user_message', status: 'pending' })
        : slotStatus(sources, 'current_user_message', 'empty'),
    ]);
  }

  function foldingView({ status, summaryId = null, failureCode = null,
    sourceSetHash = null, sourceCount = 0 }) {
    return Object.freeze({ status, summaryId, reason: failureCode, sourceSetHash,
      sourceCount, recoveryAction: status === 'failed' ? 'retry_fold' : null });
  }

  function assertLockedConsistency(record, sources) {
    const snapshot = record.snapshot;
    const persistedMessages = providerMessages(sources);
    let invalidSourceHash = false;
    try {
      invalidSourceHash = sources.some(item => item.sourceType === 'summary'
        ? hash(JSON.parse(item.source.content)) !== item.contentHash
        : hash(item.source) !== item.contentHash);
    } catch {
      invalidSourceHash = true;
    }
    if (hash(record.providerMessages) !== record.providerMessagesHash
        || invalidSourceHash
        || canonicalizeJson(record.providerMessages).toString('utf8')
          !== canonicalizeJson(persistedMessages).toString('utf8')
        || snapshot.providerMessagesHash !== record.providerMessagesHash
        || hash({ ...snapshot, snapshotHash: null }) !== record.snapshotHash
        || snapshot.snapshotHash !== record.snapshotHash
        || snapshot.contractVersion !== record.contractVersion
        || snapshot.schemaVersion !== record.schemaVersion
        || snapshot.assemblyId !== record.assemblyId || snapshot.turnId !== record.turnId
        || snapshot.conversationId !== record.conversationId
        || snapshot.branchId !== record.branchId || snapshot.state !== record.state
        || snapshot.planHash !== record.planHash || snapshot.mode !== record.mode
        || snapshot.controlsSource !== record.controlsSource
        || canonicalizeJson(snapshot.controls.excludedSourceRefs).toString('utf8')
          !== canonicalizeJson(record.excludedSourceRefs).toString('utf8')
        || canonicalizeJson(snapshot.controls.unavailableExcludedSourceRefs).toString('utf8')
          !== canonicalizeJson(record.unavailableExcludedSourceRefs).toString('utf8')
        || snapshot.budget.estimationMethod !== record.estimationMethod
        || snapshot.budget.contextLimitTokens !== record.contextLimitTokens
        || snapshot.budget.reservedOutputTokens !== record.reservedOutputTokens
        || snapshot.budget.inputBudgetTokens !== record.inputBudgetTokens
        || snapshot.budget.rawEstimatedInputTokens !== record.rawEstimatedInputTokens
        || snapshot.budget.estimatedInputTokens !== record.estimatedInputTokens
        || snapshot.budget.trimmingApplied !== record.trimmingApplied
        || snapshot.budget.trimmingReason !== record.trimmingReason
        || snapshot.folding.status !== record.foldingStatus
        || snapshot.folding.summaryId !== record.summaryId
        || canonicalizeJson(snapshot.selection).toString('utf8')
          !== canonicalizeJson(record.selection).toString('utf8')
        || snapshot.runtimeProjection.status !== record.runtimeProjectionStatus
        || snapshot.createdAt !== record.createdAt || snapshot.lockedAt !== record.lockedAt
        || snapshot.externalCall !== 'not_performed'
        || canonicalizeJson(snapshot.sources).toString('utf8')
          !== canonicalizeJson(sources.map(publicSource)).toString('utf8')) {
      throw coded('CONTEXT_LEDGER_INCONSISTENT', 'Locked context facts are inconsistent.', 500);
    }
  }

  function publicSnapshot(record, sources = repository.listAssemblySources(record.assemblyId,
    record.state === 'locked' ? 'locked' : 'failed_candidate')) {
    if (record.snapshot) {
      assertLockedConsistency(record, sources);
      return Object.freeze(record.snapshot);
    }
    const summary = record.summaryId ? repository.findSummaryById(record.summaryId) : null;
    const summarySources = summary ? repository.listSummarySources(summary.summaryId) : [];
    return Object.freeze({ contractVersion: CONTEXT_CONTRACT_VERSION,
      schemaVersion: CONTEXT_SNAPSHOT_VERSION, assemblyId: record.assemblyId,
      turnId: record.turnId, conversationId: record.conversationId,
      branchId: record.branchId, mode: record.mode, controlsSource: record.controlsSource,
      state: record.state, scope: Object.freeze({ currentOwner: true, currentAssistant: true,
        currentConversationExcludedFromCrossWindow: true }),
      controls: Object.freeze({ excludedSourceRefs: Object.freeze([...record.excludedSourceRefs]),
        unavailableExcludedSourceRefs: Object.freeze([...record.unavailableExcludedSourceRefs]) }),
      slots: slotsFor(sources), sources: Object.freeze(sources.map(publicSource)),
      budget: Object.freeze({ estimationMethod: record.estimationMethod,
        contextLimitTokens: record.contextLimitTokens,
        reservedOutputTokens: record.reservedOutputTokens,
        inputBudgetTokens: record.inputBudgetTokens,
        rawEstimatedInputTokens: record.rawEstimatedInputTokens,
        estimatedInputTokens: record.estimatedInputTokens,
        withinLimit: record.state === 'locked', trimmingApplied: record.trimmingApplied,
        trimmingReason: record.trimmingReason,
        foldPlanned: record.foldingStatus === 'ready' || record.foldingStatus === 'failed' }),
      folding: foldingView({ status: record.foldingStatus, summaryId: record.summaryId,
        failureCode: record.failureCode, sourceSetHash: summary?.sourceSetHash ?? null,
        sourceCount: summarySources.length }),
      selection: Object.freeze(record.selection),
      runtimeProjection: Object.freeze({ status: record.runtimeProjectionStatus,
        sourceRef: sources.find(item => item.sourceType === 'runtime_projection')?.sourceRef ?? null }),
      memory: Object.freeze({ status: 'not_implemented' }), planHash: record.planHash,
      providerMessagesHash: record.providerMessagesHash, snapshotHash: record.snapshotHash,
      createdAt: record.createdAt,
      lockedAt: record.lockedAt, externalCall: 'not_performed' });
  }

  function build({ s, turn, current, controls, model, forceRetry = false }) {
    const budget = limitFor(model, controls.mode);
    const gathered = gather({ s, current, controls,
      currentMessageVersionId: turn.userMessageVersionId });
    const evaluated = evaluateExclusions(gathered.sources, controls,
      gathered.availableSourceRefs, false);
    const activeControls = { ...controls,
      excludedSourceRefs: evaluated.activeExcludedSourceRefs,
      unavailableExcludedSourceRefs: Object.freeze([
        ...(controls.unavailableExcludedSourceRefs ?? []),
        ...evaluated.unavailableExcludedSourceRefs,
      ].filter((value, index, values) => values.indexOf(value) === index)) };
    const planHash = planHashFor({ s, current, controls: activeControls,
      sources: gathered.planBasis, limit: budget });
    if (!forceRetry && controls.expectedPlanHash && controls.expectedPlanHash !== planHash) {
      throw coded('CONTEXT_PLAN_STALE', 'The context plan changed before the turn was locked.');
    }
    let sources = evaluated.sources;
    const rawEstimatedInputTokens = estimateContextTokens(providerMessages(sources));
    const folded = maybeFold({ s, current, controls: activeControls, sources, budget, forceRetry });
    sources = folded.sources;
    if (folded.failureCode) {
      const now = clock().toISOString();
      const existing = repository.findAssemblyByTurn(turn.turnId);
      if (!existing) repository.insertAssembly({ assemblyId: idFactory(), turnId: turn.turnId,
        userId: s.userId, assistantId: s.assistantId,
        conversationId: current.conversation.conversationId, branchId: current.branch.branchId,
        mode: activeControls.mode, controlsSource: activeControls.controlsSource,
        excludedSourceRefs: activeControls.excludedSourceRefs,
        unavailableExcludedSourceRefs: activeControls.unavailableExcludedSourceRefs,
        state: 'fold_failed', planHash,
        modelId: model.modelId, contextLimitTokens: budget.contextLimitTokens,
        reservedOutputTokens: budget.reservedOutputTokens,
        inputBudgetTokens: budget.inputBudgetTokens, rawEstimatedInputTokens,
        estimatedInputTokens: rawEstimatedInputTokens,
        trimmingApplied: false, foldingStatus: 'failed',
        summaryId: folded.summary?.summaryId ?? null,
        selection: gathered.selection, providerMessagesHash: null,
        runtimeProjectionStatus: sources.some(item => item.sourceType === 'runtime_projection'
          && item.status === 'included')
          ? 'included' : 'not_available', failureCode: folded.failureCode, createdAt: now }, sources);
      throw coded('CONTEXT_FOLDING_FAILED', 'Context folding failed before Provider execution.');
    }
    const trimmed = trim(sources, budget);
    if (trimmed.estimate > budget.inputBudgetTokens) {
      const existing = repository.findAssemblyByTurn(turn.turnId);
      if (!existing) {
        const now = clock().toISOString();
        repository.insertAssembly({ assemblyId: idFactory(), turnId: turn.turnId,
          userId: s.userId, assistantId: s.assistantId,
          conversationId: current.conversation.conversationId, branchId: current.branch.branchId,
          mode: activeControls.mode, controlsSource: activeControls.controlsSource,
          excludedSourceRefs: activeControls.excludedSourceRefs,
          unavailableExcludedSourceRefs: activeControls.unavailableExcludedSourceRefs,
          state: 'budget_blocked', planHash,
          modelId: model.modelId, contextLimitTokens: budget.contextLimitTokens,
          reservedOutputTokens: budget.reservedOutputTokens,
          inputBudgetTokens: budget.inputBudgetTokens, rawEstimatedInputTokens,
          estimatedInputTokens: trimmed.estimate,
          trimmingApplied: trimmed.trimmingApplied,
          trimmingReason: trimmed.trimmingReason,
          foldingStatus: folded.foldingStatus,
          summaryId: folded.summary?.summaryId ?? null,
          runtimeProjectionStatus: trimmed.sources.some(item =>
            item.sourceType === 'runtime_projection' && item.status === 'included')
            ? 'included' : 'not_available',
          selection: gathered.selection, providerMessagesHash: null,
          failureCode: 'CONTEXT_BUDGET_EXCEEDED', createdAt: now,
        }, trimmed.sources);
      }
      throw coded('CONTEXT_BUDGET_EXCEEDED', 'Mandatory context exceeds the model input limit.');
    }
    const now = clock().toISOString();
    const existing = repository.findAssemblyByTurn(turn.turnId);
    const assemblyId = existing?.assemblyId ?? idFactory();
    const createdAt = existing?.createdAt ?? now;
    const providerMessagesHash = hash(trimmed.messages);
    const base = {
      contractVersion: CONTEXT_CONTRACT_VERSION, schemaVersion: CONTEXT_SNAPSHOT_VERSION,
      assemblyId, turnId: turn.turnId, conversationId: current.conversation.conversationId,
      branchId: current.branch.branchId, mode: activeControls.mode,
      controlsSource: activeControls.controlsSource, state: 'locked',
      scope: { currentOwner: true, currentAssistant: true,
        currentConversationExcludedFromCrossWindow: true },
      controls: { excludedSourceRefs: [...activeControls.excludedSourceRefs],
        unavailableExcludedSourceRefs: [...activeControls.unavailableExcludedSourceRefs] },
      slots: slotsFor(trimmed.sources), sources: trimmed.sources.map(publicSource),
      budget: { estimationMethod: 'utf8-byte-upper-bound/v1',
        contextLimitTokens: budget.contextLimitTokens,
        reservedOutputTokens: budget.reservedOutputTokens,
        inputBudgetTokens: budget.inputBudgetTokens, rawEstimatedInputTokens,
        estimatedInputTokens: trimmed.estimate, withinLimit: true,
        trimmingApplied: trimmed.trimmingApplied,
        trimmingReason: trimmed.trimmingReason,
        foldPlanned: folded.foldingStatus === 'ready' },
      folding: foldingView({ status: folded.foldingStatus,
        summaryId: folded.summary?.summaryId ?? null,
        sourceSetHash: folded.sourceSetHash, sourceCount: folded.sourceCount }),
      selection: gathered.selection,
      runtimeProjection: { status: trimmed.sources.some(item => item.sourceType === 'runtime_projection'
        && item.status === 'included') ? 'included' : 'not_available',
      sourceRef: trimmed.sources.find(item => item.sourceType === 'runtime_projection'
        && item.status === 'included')?.sourceRef ?? null },
      memory: { status: 'not_implemented' }, planHash, providerMessagesHash,
      snapshotHash: null, createdAt, lockedAt: now, externalCall: 'not_performed',
    };
    const snapshotHash = hash({ ...base, snapshotHash: null });
    const snapshot = Object.freeze({ ...base, snapshotHash });
    const record = { assemblyId, turnId: turn.turnId, userId: s.userId,
      assistantId: s.assistantId, conversationId: current.conversation.conversationId,
      branchId: current.branch.branchId, mode: activeControls.mode,
      controlsSource: activeControls.controlsSource,
      excludedSourceRefs: activeControls.excludedSourceRefs,
      unavailableExcludedSourceRefs: activeControls.unavailableExcludedSourceRefs,
      state: 'locked', planHash,
      snapshotHash, modelId: model.modelId, contextLimitTokens: budget.contextLimitTokens,
      reservedOutputTokens: budget.reservedOutputTokens,
      inputBudgetTokens: budget.inputBudgetTokens, rawEstimatedInputTokens,
      estimatedInputTokens: trimmed.estimate,
      trimmingApplied: trimmed.trimmingApplied, trimmingReason: trimmed.trimmingReason,
      foldingStatus: folded.foldingStatus, summaryId: folded.summary?.summaryId ?? null,
      runtimeProjectionStatus: snapshot.runtimeProjection.status,
      selection: gathered.selection, snapshot, providerMessages: trimmed.messages,
      providerMessagesHash, createdAt, lockedAt: now };
    return existing ? repository.replaceFailedAssembly(record, trimmed.sources)
      : repository.insertAssembly(record, trimmed.sources);
  }

  return Object.freeze({
    resolveTurnControls,
    getSettings(context, conversationId) {
      const s = scope(context); const current = conversation(s, conversationId);
      return settingsView(s, current);
    },
    updateSettings(context, conversationId, value, idempotencyKey) {
      const s = scope(context); const current = conversation(s, conversationId);
      fields(value, ['mode', 'excludedSourceRefs', 'expectedVersion'],
        ['mode', 'excludedSourceRefs', 'expectedVersion']);
      const controls = validateContextControls({ mode: value.mode,
        excludedSourceRefs: value.excludedSourceRefs });
      if (!Number.isSafeInteger(value.expectedVersion) || value.expectedVersion < 0) {
        throw new ValidationError('Invalid context settings version.', { field: 'expectedVersion' });
      }
      const input = { conversationId: current.conversation.conversationId,
        mode: controls.mode, excludedSourceRefs: controls.excludedSourceRefs,
        expectedVersion: value.expectedVersion };
      const normalizedKey = key(idempotencyKey);
      const existing = repository.findOperation(s.userId, s.assistantId, normalizedKey);
      if (existing) {
        if (existing.operationType !== 'context.settings.update' || existing.contentHash !== hash(input)) {
          throw coded('IDEMPOTENCY_CONFLICT', 'Idempotency-Key is bound to another context operation.');
        }
        return existing.result;
      }
      const gathered = gather({ s, current, controls });
      evaluateExclusions(gathered.sources, controls, gathered.availableSourceRefs, true);
      return runInTransaction(() => {
        const operation = repository.insertOperation({ operationId: idFactory(), userId: s.userId,
          assistantId: s.assistantId, idempotencyKey: normalizedKey,
          operationType: 'context.settings.update',
          contentHash: hash(input), input, resourceType: 'contextSettings',
          createdAt: clock().toISOString() });
        let saved;
        try { saved = repository.saveSettings({ userId: s.userId, assistantId: s.assistantId,
          conversationId: current.conversation.conversationId, mode: controls.mode,
          excludedSourceRefs: controls.excludedSourceRefs, expectedVersion: value.expectedVersion,
          updatedAt: clock().toISOString() }); } catch (error) {
          if (error instanceof ConflictError) {
            repository.completeOperation({ operationId: operation.operationId, status: 'failed',
              errorCode: 'CONTEXT_SETTINGS_VERSION_CONFLICT', completedAt: clock().toISOString() });
            throw coded('CONTEXT_SETTINGS_VERSION_CONFLICT', 'Context settings version conflicts.');
          }
          throw error;
        }
        const result = settingsView(s, current);
        repository.completeOperation({ operationId: operation.operationId, status: 'completed',
          resourceId: saved.conversationId, result, completedAt: clock().toISOString() });
        return result;
      });
    },
    preview(context, conversationId, params = {}) {
      const s = scope(context); const current = conversation(s, conversationId, params.branchId);
      const defaultsValue = defaults(s, current.conversation.conversationId);
      const explicit = params.mode !== undefined || (params.excludedSourceRefs?.length ?? 0) > 0;
      const controls = explicit ? validateContextControls({ mode: params.mode,
        excludedSourceRefs: params.excludedSourceRefs ?? [] }, defaultsValue.controls.mode)
        : validateContextControls(defaultsValue.controls, defaultsValue.controls.mode);
      const selection = modelRouterService.selectConfiguredDefaultModel(s.userId, 'chat');
      const budget = limitFor(selection.model, controls.mode);
      const gathered = gather({ s, current, controls });
      const evaluated = evaluateExclusions(gathered.sources, controls,
        gathered.availableSourceRefs, explicit);
      const activeControls = { ...controls,
        excludedSourceRefs: evaluated.activeExcludedSourceRefs,
        unavailableExcludedSourceRefs: evaluated.unavailableExcludedSourceRefs };
      const planHash = planHashFor({ s, current, controls: activeControls,
        sources: gathered.planBasis, limit: budget });
      const rawEstimatedInputTokens = estimateContextTokens(providerMessages(evaluated.sources));
      const folded = previewFold({ s, current, controls: activeControls,
        sources: evaluated.sources, budget });
      const trimmed = trim(folded.sources, budget);
      const sources = trimmed.sources;
      return Object.freeze({ contractVersion: CONTEXT_CONTRACT_VERSION,
        schemaVersion: CONTEXT_SNAPSHOT_VERSION, assemblyId: null, turnId: null,
        conversationId: current.conversation.conversationId, branchId: current.branch.branchId,
        mode: controls.mode, controlsSource: explicit ? 'turn' : defaultsValue.controlsSource,
        state: 'planned', scope: Object.freeze({ currentOwner: true, currentAssistant: true,
          currentConversationExcludedFromCrossWindow: true }),
        controls: Object.freeze({ excludedSourceRefs: activeControls.excludedSourceRefs,
          unavailableExcludedSourceRefs: activeControls.unavailableExcludedSourceRefs }),
        slots: slotsFor(sources, true), sources: Object.freeze(sources.map(publicSource)),
        budget: Object.freeze({ estimationMethod: 'utf8-byte-upper-bound/v1',
          contextLimitTokens: budget.contextLimitTokens,
          reservedOutputTokens: budget.reservedOutputTokens,
          inputBudgetTokens: budget.inputBudgetTokens,
          rawEstimatedInputTokens, estimatedInputTokens: trimmed.estimate,
          withinLimit: trimmed.estimate <= budget.inputBudgetTokens,
          trimmingApplied: trimmed.trimmingApplied,
          trimmingReason: trimmed.trimmingReason,
          foldPlanned: folded.foldingStatus === 'planned' || folded.foldingStatus === 'ready' }),
        folding: foldingView({ status: folded.foldingStatus,
          summaryId: folded.summary?.summaryId ?? null,
          sourceSetHash: folded.sourceSetHash, sourceCount: folded.sourceCount }),
        selection: gathered.selection,
        runtimeProjection: Object.freeze({ status: sources.some(item =>
          item.sourceType === 'runtime_projection' && item.status === 'included')
          ? 'included' : 'not_available',
        sourceRef: sources.find(item => item.sourceType === 'runtime_projection'
          && item.status === 'included')?.sourceRef ?? null }),
        memory: Object.freeze({ status: 'not_implemented' }), planHash,
        providerMessagesHash: null,
        snapshotHash: null, createdAt: clock().toISOString(), lockedAt: null,
        externalCall: 'not_performed' });
    },
    recordTurnControls(scopeValue, turn, branchId, value) {
      const controls = value?.controlsSource
        ? value : resolveTurnControls(scopeValue, turn.conversationId, value);
      return repository.insertTurnControls({ turnId: turn.turnId, userId: turn.userId,
        assistantId: turn.assistantId, conversationId: turn.conversationId, branchId,
        mode: controls.mode, controlsSource: controls.controlsSource,
        excludedSourceRefs: controls.excludedSourceRefs,
        unavailableExcludedSourceRefs: controls.unavailableExcludedSourceRefs ?? [],
        expectedPlanHash: controls.expectedPlanHash, createdAt: turn.createdAt });
    },
    lockForTurn(scopeValue, turn, model) {
      const existing = repository.findAssemblyByTurn(turn.turnId);
      if (existing?.state === 'locked') return Object.freeze({ record: existing,
        snapshot: publicSnapshot(existing), providerMessages: existing.providerMessages });
      if (existing?.state === 'fold_failed') {
        throw coded('CONTEXT_FOLDING_FAILED', 'Context folding requires explicit recovery.');
      }
      if (existing?.state === 'budget_blocked') {
        throw coded('CONTEXT_BUDGET_EXCEEDED', 'Mandatory context exceeds the model input limit.');
      }
      const controls = repository.findTurnControls(turn.turnId);
      if (!controls || controls.userId !== turn.userId || controls.assistantId !== turn.assistantId
          || controls.conversationId !== turn.conversationId) {
        throw coded('CONTEXT_LEDGER_INCONSISTENT', 'Turn context controls are missing.', 500);
      }
      const current = conversation(scopeValue, turn.conversationId, controls.branchId);
      const record = build({ s: scopeValue, turn, current, controls, model });
      return Object.freeze({ record, snapshot: publicSnapshot(record),
        providerMessages: record.providerMessages });
    },
    getSnapshot(context, turnId) {
      const s = scope(context); const id = requireOpaqueResourceId(turnId, 'turnId');
      const record = repository.findAssembly(s.userId, s.assistantId, id);
      if (!record) throw coded('CONTEXT_SNAPSHOT_NOT_FOUND', 'Context snapshot was not found.', 404);
      return publicSnapshot(record);
    },
    snapshotForTurn(turn) {
      const record = repository.findAssembly(turn.userId, turn.assistantId, turn.turnId);
      return record ? publicSnapshot(record) : null;
    },
    getEvidence(context, sourceRef) {
      const s = scope(context);
      if (typeof sourceRef !== 'string' || !REF.test(sourceRef)) {
        throw coded('CONTEXT_SOURCE_NOT_FOUND', 'Context source was not found.', 404);
      }
      const item = repository.findEvidence(s.userId, s.assistantId, sourceRef);
      if (!item || !['message_version', 'event', 'summary'].includes(item.sourceType)) {
        throw coded('CONTEXT_SOURCE_NOT_FOUND', 'Context source was not found.', 404);
      }
      if (item.sourceType !== 'summary') {
        const candidate = source({ sourceRef: item.sourceRef, sourceType: item.sourceType,
          slot: item.slot, origin: item.origin, content: item.source.content,
          role: item.source.role, sourceData: item.source.data,
          conversationId: item.sourceConversationId, branchId: item.sourceBranchId,
          messageId: item.messageId, messageVersionId: item.messageVersionId,
          eventId: item.eventId, createdAt: item.createdAt, contentHash: item.contentHash,
          evidence: item.evidence });
        if (hash(item.source) !== item.contentHash) {
          throw coded('CONTEXT_LEDGER_INCONSISTENT', 'Context source hash is inconsistent.', 500);
        }
        if (!canReadSource(s, candidate)) {
          throw coded('CONTEXT_SOURCE_NOT_FOUND', 'Context source was not found.', 404);
        }
      }
      if (item.sourceType === 'message_version') return Object.freeze({ sourceRef,
        sourceType: 'message_version', conversationId: item.sourceConversationId,
        branchId: item.sourceBranchId, messageId: item.messageId,
        messageVersionId: item.messageVersionId, senderType: item.evidence.senderType,
        content: item.source.content, createdAt: item.createdAt,
        contentHash: item.contentHash, externalCall: 'not_performed' });
      if (item.sourceType === 'event') return Object.freeze({ sourceRef, sourceType: 'event',
        conversationId: null, branchId: null, eventId: item.eventId,
        eventType: item.evidence.eventType, summary: item.evidence.summary,
        data: item.source.data ?? {}, occurredAt: item.createdAt,
        contentHash: item.contentHash, externalCall: 'not_performed' });
      const persisted = repository.findSummaryById(item.summaryId);
      if (!persisted || persisted.userId !== s.userId || persisted.assistantId !== s.assistantId) {
        throw coded('CONTEXT_SOURCE_NOT_FOUND', 'Context source was not found.', 404);
      }
      const checked = checkedSummary(s, persisted);
      if (!checked) throw coded('CONTEXT_SOURCE_NOT_FOUND', 'Context source was not found.', 404);
      let sourceSummary;
      try { sourceSummary = JSON.parse(item.source.content); } catch {
        throw coded('CONTEXT_LEDGER_INCONSISTENT', 'Context summary evidence is invalid.', 500);
      }
      if (item.contentHash !== persisted.contentHash || hash(sourceSummary) !== persisted.contentHash
          || canonicalizeJson(sourceSummary).toString('utf8')
            !== canonicalizeJson(checked.structured).toString('utf8')) {
        throw coded('CONTEXT_LEDGER_INCONSISTENT', 'Context summary evidence is inconsistent.', 500);
      }
      return Object.freeze({ sourceRef, sourceType: 'summary',
        conversationId: persisted.conversationId, branchId: persisted.branchId,
        summaryId: persisted.summaryId, structuredSummary: persisted.structuredSummary,
        sourceRefs: repository.listSummarySources(persisted.summaryId).map(value => value.sourceRef),
        sourceHashes: repository.listSummarySources(persisted.summaryId).map(value =>
          Object.freeze({ sourceRef: value.sourceRef, contentHash: value.contentHash })),
        createdAt: persisted.completedAt, contentHash: persisted.contentHash,
        externalCall: 'not_performed' });
    },
    async recoverFold(context, turnId, value, idempotencyKey) {
      fields(value, ['action'], ['action']);
      if (value.action !== 'retry_fold') throw coded('CONTEXT_RECOVERY_NOT_ALLOWED', 'Unsupported recovery action.');
      const s = scope(context); const id = requireOpaqueResourceId(turnId, 'turnId');
      const normalizedKey = key(idempotencyKey);
      const input = { turnId: id, action: 'retry_fold' };
      const existing = repository.findOperation(s.userId, s.assistantId, normalizedKey);
      if (existing) {
        if (existing.operationType !== 'context.summary.retry' || existing.contentHash !== hash(input)) {
          throw coded('IDEMPOTENCY_CONFLICT', 'Idempotency-Key is bound to another context operation.');
        }
        if (existing.status === 'completed') return existing.result;
        if (existing.status === 'failed') {
          throw coded(existing.errorCode ?? 'CONTEXT_FOLDING_FAILED',
            'The persisted context recovery failed.');
        }
        throw coded('CONTEXT_RECOVERY_IN_PROGRESS', 'Context recovery is already in progress.');
      }
      const record = repository.findAssembly(s.userId, s.assistantId, id);
      if (!record || record.state !== 'fold_failed') {
        throw coded('CONTEXT_RECOVERY_NOT_ALLOWED', 'Context folding is not recoverable.');
      }
      const execution = standaloneChatRepository.findExecutionByTurn(id);
      if (execution?.providerCallMayHaveStarted) {
        throw coded('CONTEXT_RECOVERY_NOT_ALLOWED', 'Provider execution already started.');
      }
      const turn = standaloneChatRepository.findTurn(s.userId, s.assistantId, id);
      const controls = repository.findTurnControls(id);
      const selection = modelRouterService.selectConfiguredDefaultModel(s.userId, 'chat');
      const operation = repository.insertOperation({ operationId: idFactory(), userId: s.userId,
        assistantId: s.assistantId, idempotencyKey: normalizedKey,
        operationType: 'context.summary.retry',
        contentHash: hash(input), input, resourceType: 'contextAssembly',
        createdAt: clock().toISOString() });
      let locked;
      try {
        const current = conversation(s, turn.conversationId, controls.branchId);
        locked = runInTransaction(() => build({ s, turn, current, controls,
          model: selection.model, forceRetry: true }));
      } catch (error) {
        repository.completeOperation({ operationId: operation.operationId, status: 'failed',
          resourceId: record.assemblyId, errorCode: error?.code ?? 'CONTEXT_FOLDING_FAILED',
          completedAt: clock().toISOString() });
        throw error;
      }
      const recoveryId = idFactory();
      repository.insertRecovery({ recoveryId, operationId: operation.operationId,
        assemblyId: locked.assemblyId, turnId: turn.turnId, userId: s.userId,
        assistantId: s.assistantId, conversationId: turn.conversationId,
        branchId: controls.branchId, createdAt: clock().toISOString() });
      try {
        const resumed = await standaloneRecoveryPort?.retryAfterContextFold?.(context, turn.turnId,
          `r4retry:${operation.operationId}`);
        const result = { context: publicSnapshot(locked), turn: resumed ?? null,
          externalCall: resumed?.externalCall ?? 'not_performed' };
        repository.completeRecovery(recoveryId, 'completed', clock().toISOString());
        repository.completeOperation({ operationId: operation.operationId, status: 'completed',
          resourceId: locked.assemblyId, result, completedAt: clock().toISOString() });
        return result;
      } catch (error) {
        repository.completeRecovery(recoveryId, 'failed', clock().toISOString());
        repository.completeOperation({ operationId: operation.operationId, status: 'failed',
          resourceId: locked.assemblyId, errorCode: error?.code ?? 'CONTEXT_RECOVERY_FAILED',
          completedAt: clock().toISOString() });
        throw error;
      }
    },
  });
}
