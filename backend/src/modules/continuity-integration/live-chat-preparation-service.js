import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { ConflictError, ValidationError } from '../../core/errors.js';
import {
  EXPECTED_BINDING_FIXTURE_HASH,
  fixedSubjectBindingFixture,
} from './first-round-contract.js';
import { calculateBindingFixtureHash } from './first-round-hashing.js';
import { validateFixedSubjectBindingFixture } from './first-round-validator.js';
import { inspectLiveChatSandbox } from './live-chat-sandbox-service.js';

export const LIVE_CHAT_CONFIGURATION = Object.freeze({
  providerDisplayName: 'Vio Live OpenAI-Compatible Provider',
  providerType: 'custom',
  interfaceFormat: 'openai_compatible',
  credentialSecretRef: 'env:VIO_MODEL_API_KEY_LIVE',
  userId: 'user-001',
  assistantId: 'assistant-001',
  engineSubjectId: 'subject-001',
  conversationId: 'conversation-001',
  defaultDailyTokenLimit: 50_000,
  defaultSessionTokenLimit: 10_000,
  overagePolicy: 'block',
  costDescription: 'Provider-reported usage; cost is not assumed by Vio.',
});

const EXPECTED_PROFILE = Object.freeze({
  user: Object.freeze({
    user_id: 'user-001',
    primary_email: 'local-chat@vio.invalid',
    display_name: 'Vio Local Chat User',
    status: 'active',
  }),
  assistant: Object.freeze({
    subject_id: 'assistant-001',
    owner_user_id: 'user-001',
    name: 'Vio',
    avatar_ref: null,
    basic_settings_json: JSON.stringify({ profile: 'fixed-local-chat-v1' }),
    status: 'active',
  }),
  userSpace: Object.freeze({
    space_id: 'user-space-user-001',
    user_id: 'user-001',
    identity_mode: 'development_unverified',
    status: 'active',
    current_assistant_id: 'assistant-001',
  }),
  conversation: Object.freeze({
    conversation_id: 'conversation-001',
    user_id: 'user-001',
    subject_id: 'assistant-001',
    title: 'Vio Local Chat',
    status: 'active',
  }),
  assistantSettings: Object.freeze({
    owner_user_id: 'user-001',
    subject_id: 'assistant-001',
    personality_description: 'Fixed local chat profile for Continuity integration.',
    expression_style_json: '{}',
    relationship_definition: 'Local development assistant',
    long_term_requirements_json: '[]',
    prohibitions_json: '[]',
  }),
});

function item(component, status, action, reason = null) {
  return Object.freeze({ component, status, action, reason });
}

const READINESS_PRIORITY = Object.freeze(['unsafe', 'conflict', 'missing']);

const ENVIRONMENT_ISSUE_STATUS = Object.freeze({
  provider_base_url_missing: 'missing',
  provider_base_url_unsafe: 'unsafe',
  model_name_missing: 'missing',
  model_name_invalid: 'unsafe',
  daily_token_limit_invalid: 'unsafe',
  session_token_limit_invalid: 'unsafe',
  session_token_limit_exceeds_daily: 'conflict',
  provider_key_missing: 'missing',
  provider_key_unsafe: 'unsafe',
});

function highestReadinessStatus(statuses, successStatus) {
  return READINESS_PRIORITY.find((status) => statuses.includes(status)) ?? successStatus;
}

function issueStatus(issue) {
  return ENVIRONMENT_ISSUE_STATUS[issue] ?? 'conflict';
}

function highestIssueStatus(issues, successStatus = 'ready') {
  return highestReadinessStatus(issues.map(issueStatus), successStatus);
}

function firstIssueForStatus(issues, status) {
  return issues.find((issue) => issueStatus(issue) === status) ?? null;
}

function parseBudget(value, fallback, name) {
  const supplied = value === undefined || value === null ? '' : String(value).trim();
  const raw = supplied === '' ? String(fallback) : supplied;
  if (!/^[1-9][0-9]*$/u.test(raw)) {
    return { value: null, issue: `${name}_invalid` };
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed > 100_000_000) {
    return { value: null, issue: `${name}_invalid` };
  }
  return { value: parsed, issue: null };
}

export function inspectLiveChatEnvironment(environment = process.env) {
  const issues = [];
  const rawBaseUrl = typeof environment.VIO_LIVE_PROVIDER_BASE_URL === 'string'
    ? environment.VIO_LIVE_PROVIDER_BASE_URL.trim()
    : '';
  let providerBaseUrl = null;
  if (!rawBaseUrl) {
    issues.push('provider_base_url_missing');
  } else {
    try {
      const url = new URL(rawBaseUrl);
      if (
        url.protocol !== 'https:'
        || url.username
        || url.password
        || url.search
        || url.hash
      ) {
        throw new TypeError('unsafe Provider URL');
      }
      providerBaseUrl = url.toString();
    } catch {
      issues.push('provider_base_url_unsafe');
    }
  }

  const rawModelName = environment.VIO_LIVE_MODEL_NAME;
  const modelName = typeof rawModelName === 'string' ? rawModelName.trim() : '';
  if (!modelName) issues.push('model_name_missing');
  else if (modelName.length > 160) issues.push('model_name_invalid');

  const daily = parseBudget(
    environment.VIO_LIVE_DAILY_TOKEN_LIMIT,
    LIVE_CHAT_CONFIGURATION.defaultDailyTokenLimit,
    'daily_token_limit',
  );
  const session = parseBudget(
    environment.VIO_LIVE_SESSION_TOKEN_LIMIT,
    LIVE_CHAT_CONFIGURATION.defaultSessionTokenLimit,
    'session_token_limit',
  );
  if (daily.issue) issues.push(daily.issue);
  if (session.issue) issues.push(session.issue);
  if (daily.value !== null && session.value !== null && session.value > daily.value) {
    issues.push('session_token_limit_exceeds_daily');
  }

  const rawKey = environment.VIO_MODEL_API_KEY_LIVE;
  let keyStatus = 'missing';
  if (typeof rawKey === 'string' && rawKey.trim() !== '') {
    keyStatus = rawKey === rawKey.trim()
      && rawKey.length <= 8192
      && !/[\u0000-\u001f\u007f]/u.test(rawKey)
      ? 'ready'
      : 'unsafe';
  }
  if (keyStatus === 'missing') issues.push('provider_key_missing');
  else if (keyStatus === 'unsafe') issues.push('provider_key_unsafe');

  return Object.freeze({
    providerBaseUrl,
    modelName: modelName || null,
    dailyTokenLimit: daily.value,
    sessionTokenLimit: session.value,
    keyPresent: keyStatus === 'ready',
    keyStatus,
    issues: Object.freeze(issues),
  });
}

function requireLiveChatEnvironment(environment) {
  const inspected = inspectLiveChatEnvironment(environment);
  if (inspected.issues.length > 0) {
    throw new ValidationError('Live chat environment is missing or unsafe.', {
      issues: inspected.issues,
    });
  }
  return inspected;
}

function tableExists(connection, tableName) {
  return Boolean(connection.prepare(
    'SELECT 1 present FROM sqlite_master WHERE type = ? AND name = ?',
  ).get('table', tableName));
}

function oneOrNone(connection, sql, ...parameters) {
  return connection.prepare(sql).get(...parameters) ?? null;
}

function rows(connection, sql, ...parameters) {
  return connection.prepare(sql).all(...parameters);
}

function exactRow(actual, expected) {
  return actual && Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function inspectProfile(connection) {
  const requiredTables = [
    'users', 'subjects', 'user_spaces', 'conversations',
    'assistant_global_settings', 'continuity_first_round_binding_fixtures',
  ];
  if (requiredTables.some((name) => !tableExists(connection, name))) {
    return {
      profile: item('fixed_profile', 'missing', 'create'),
      binding: item('subject_binding', 'missing', 'create'),
    };
  }
  const values = [
    oneOrNone(connection, 'SELECT user_id, primary_email, display_name, status FROM users WHERE user_id = ?', LIVE_CHAT_CONFIGURATION.userId),
    oneOrNone(connection, 'SELECT subject_id, owner_user_id, name, avatar_ref, basic_settings_json, status FROM subjects WHERE owner_user_id = ? AND subject_id = ?', LIVE_CHAT_CONFIGURATION.userId, LIVE_CHAT_CONFIGURATION.assistantId),
    oneOrNone(connection, 'SELECT space_id, user_id, identity_mode, status, current_assistant_id FROM user_spaces WHERE user_id = ?', LIVE_CHAT_CONFIGURATION.userId),
    oneOrNone(connection, 'SELECT conversation_id, user_id, subject_id, title, status FROM conversations WHERE user_id = ? AND subject_id = ? AND conversation_id = ?', LIVE_CHAT_CONFIGURATION.userId, LIVE_CHAT_CONFIGURATION.assistantId, LIVE_CHAT_CONFIGURATION.conversationId),
  ];
  const expected = [
    EXPECTED_PROFILE.user,
    EXPECTED_PROFILE.assistant,
    EXPECTED_PROFILE.userSpace,
    EXPECTED_PROFILE.conversation,
  ];
  const settings = oneOrNone(
    connection,
    `SELECT owner_user_id, subject_id, personality_description, expression_style_json,
      relationship_definition, long_term_requirements_json, prohibitions_json
      FROM assistant_global_settings WHERE owner_user_id = ? AND subject_id = ?`,
    LIVE_CHAT_CONFIGURATION.userId,
    LIVE_CHAT_CONFIGURATION.assistantId,
  );
  const presentCount = values.filter(Boolean).length + (settings ? 1 : 0);
  const profile = presentCount === 0
    ? item('fixed_profile', 'missing', 'create')
    : values.every((value, index) => exactRow(value, expected[index]))
      && exactRow(settings, EXPECTED_PROFILE.assistantSettings)
      ? item('fixed_profile', 'configured', 'reuse')
      : item('fixed_profile', 'conflict', 'stop', 'fixed_profile_mismatch');

  const storedBinding = oneOrNone(
    connection,
    'SELECT fixture_json, binding_fixture_hash FROM continuity_first_round_binding_fixtures WHERE binding_id = ?',
    'binding-001',
  );
  let binding = item('subject_binding', 'missing', 'create');
  if (storedBinding) {
    try {
      const fixture = JSON.parse(storedBinding.fixture_json);
      validateFixedSubjectBindingFixture(fixture, storedBinding.binding_fixture_hash);
      binding = isDeepStrictEqual(fixture, fixedSubjectBindingFixture())
        && storedBinding.binding_fixture_hash === EXPECTED_BINDING_FIXTURE_HASH
        ? item('subject_binding', 'configured', 'reuse')
        : item('subject_binding', 'conflict', 'stop', 'binding_mismatch');
    } catch {
      binding = item('subject_binding', 'conflict', 'stop', 'binding_invalid');
    }
  }
  return { profile, binding };
}

function inspectProvider(connection, settings) {
  if (!tableExists(connection, 'api_providers')) {
    return { provider: item('provider', 'missing', 'create'), providerId: null };
  }
  const matches = rows(
    connection,
    'SELECT * FROM api_providers WHERE owner_user_id = ? AND display_name = ?',
    LIVE_CHAT_CONFIGURATION.userId,
    LIVE_CHAT_CONFIGURATION.providerDisplayName,
  );
  const enabledCompatible = rows(
    connection,
    `SELECT api_provider_id FROM api_providers
      WHERE owner_user_id = ? AND status = 'enabled' AND interface_format = 'openai_compatible'`,
    LIVE_CHAT_CONFIGURATION.userId,
  );
  if (matches.length === 0) {
    return enabledCompatible.length === 0
      ? { provider: item('provider', 'missing', 'create'), providerId: null }
      : { provider: item('provider', 'conflict', 'stop', 'another_enabled_provider_exists'), providerId: null };
  }
  const expected = matches.length === 1
    && matches[0].provider_type === LIVE_CHAT_CONFIGURATION.providerType
    && matches[0].base_url === settings.providerBaseUrl
    && matches[0].interface_format === LIVE_CHAT_CONFIGURATION.interfaceFormat
    && matches[0].status === 'enabled'
    && enabledCompatible.length === 1
    && enabledCompatible[0].api_provider_id === matches[0].api_provider_id;
  return expected
    ? { provider: item('provider', 'configured', 'reuse'), providerId: matches[0].api_provider_id }
    : { provider: item('provider', 'conflict', 'stop', 'provider_mismatch'), providerId: null };
}

function inspectModel(connection, settings, providerId) {
  if (!providerId || !tableExists(connection, 'models') || !tableExists(connection, 'model_capabilities')) {
    return { model: item('model', 'missing', 'create'), modelId: null };
  }
  const matches = rows(
    connection,
    'SELECT * FROM models WHERE owner_user_id = ? AND provider_id = ? AND model_name = ?',
    LIVE_CHAT_CONFIGURATION.userId,
    providerId,
    settings.modelName,
  );
  const enabledChatModels = rows(
    connection,
    `SELECT models.model_id FROM models
      INNER JOIN model_capabilities ON model_capabilities.model_id = models.model_id
      INNER JOIN api_providers ON api_providers.api_provider_id = models.provider_id
        AND api_providers.owner_user_id = models.owner_user_id
      WHERE models.owner_user_id = ? AND model_capabilities.capability = 'chat'
        AND api_providers.status = 'enabled'`,
    LIVE_CHAT_CONFIGURATION.userId,
  );
  if (matches.length === 0) {
    return enabledChatModels.length === 0
      ? { model: item('model', 'missing', 'create'), modelId: null }
      : { model: item('model', 'conflict', 'stop', 'another_chat_model_exists'), modelId: null };
  }
  const capabilities = matches.length === 1
    ? rows(connection, 'SELECT capability FROM model_capabilities WHERE model_id = ? ORDER BY capability', matches[0].model_id).map(({ capability }) => capability)
    : [];
  const exact = matches.length === 1
    && matches[0].model_type === 'chat'
    && matches[0].cost_description === LIVE_CHAT_CONFIGURATION.costDescription
    && isDeepStrictEqual(capabilities, ['chat'])
    && enabledChatModels.length === 1
    && enabledChatModels[0].model_id === matches[0].model_id;
  return exact
    ? { model: item('model', 'configured', 'reuse'), modelId: matches[0].model_id }
    : { model: item('model', 'conflict', 'stop', 'model_mismatch'), modelId: null };
}

function inspectRoute(connection, modelId) {
  if (!tableExists(connection, 'model_routing_rules')) return item('chat_route', 'missing', 'create');
  const route = oneOrNone(
    connection,
    'SELECT * FROM model_routing_rules WHERE owner_user_id = ? AND task_type = ?',
    LIVE_CHAT_CONFIGURATION.userId,
    'chat',
  );
  if (!route) return item('chat_route', 'missing', 'create');
  return modelId
    && route.default_model_id === modelId
    && route.fallback_model_id === null
    && route.status === 'enabled'
    ? item('chat_route', 'configured', 'reuse')
    : item('chat_route', 'conflict', 'stop', 'chat_route_mismatch');
}

function inspectPermission(connection, providerId, action) {
  if (!providerId || !tableExists(connection, 'permissions')) {
    return item(`permission_${action}`, 'missing', 'create');
  }
  const matches = rows(
    connection,
    `SELECT * FROM permissions WHERE user_id = ? AND subject_id = ?
      AND resource_type = 'api' AND resource_id = ? AND action = ? AND status <> 'deleted'`,
    LIVE_CHAT_CONFIGURATION.userId,
    LIVE_CHAT_CONFIGURATION.assistantId,
    providerId,
    action,
  );
  if (matches.length === 0) return item(`permission_${action}`, 'missing', 'create');
  return matches.length === 1
    && matches[0].permission_level === 'always_allow'
    && matches[0].status === 'active'
    ? item(`permission_${action}`, 'configured', 'reuse')
    : item(`permission_${action}`, 'conflict', 'stop', `permission_${action}_mismatch`);
}

function inspectBudget(connection, settings) {
  if (!tableExists(connection, 'token_budgets')) return item('token_budget', 'missing', 'create');
  const budget = oneOrNone(
    connection,
    'SELECT * FROM token_budgets WHERE user_id = ? AND subject_id = ?',
    LIVE_CHAT_CONFIGURATION.userId,
    LIVE_CHAT_CONFIGURATION.assistantId,
  );
  if (!budget) return item('token_budget', 'missing', 'create');
  return budget.daily_token_limit === settings.dailyTokenLimit
    && budget.session_token_limit === settings.sessionTokenLimit
    && budget.overage_policy === LIVE_CHAT_CONFIGURATION.overagePolicy
    && budget.status === 'enabled'
    ? item('token_budget', 'configured', 'reuse')
    : item('token_budget', 'conflict', 'stop', 'token_budget_mismatch');
}

function inspectCredential(connection, providerId) {
  if (!providerId || !tableExists(connection, 'api_provider_credential_bindings')) {
    return item('credential_binding', 'missing', 'create_with_confirmation');
  }
  const binding = oneOrNone(
    connection,
    `SELECT secret_ref FROM api_provider_credential_bindings
      WHERE owner_user_id = ? AND provider_id = ? AND status = 'active'`,
    LIVE_CHAT_CONFIGURATION.userId,
    providerId,
  );
  if (!binding) return item('credential_binding', 'missing', 'create_with_confirmation');
  return binding.secret_ref === LIVE_CHAT_CONFIGURATION.credentialSecretRef
    ? item('credential_binding', 'configured', 'reuse')
    : item('credential_binding', 'conflict', 'stop', 'credential_binding_mismatch');
}

export function inspectLiveChatDatabase(connection, settings) {
  const profile = inspectProfile(connection);
  const provider = inspectProvider(connection, settings);
  const model = inspectModel(connection, settings, provider.providerId);
  return Object.freeze({
    items: Object.freeze([
      profile.profile,
      profile.binding,
      provider.provider,
      model.model,
      inspectRoute(connection, model.modelId),
      inspectPermission(connection, provider.providerId, 'manage'),
      inspectPermission(connection, provider.providerId, 'execute'),
      inspectBudget(connection, settings),
      inspectCredential(connection, provider.providerId),
    ]),
    providerId: provider.providerId,
    modelId: model.modelId,
  });
}

function ensureNoConflict(plan) {
  const conflicts = plan.items.filter(({ status }) => status === 'conflict');
  if (conflicts.length > 0) {
    throw new ConflictError('Live chat preparation conflicts with existing configuration.');
  }
}

export function createLiveChatPreparationService({
  connection,
  fixedLocalChatProfileService,
  apiProviderService,
  modelService,
  modelRoutingRuleService,
  permissionService,
  confirmationService,
  proactiveInteractionService,
  environment = process.env,
}) {
  function plan() {
    const settings = inspectLiveChatEnvironment(environment);
    const issueReadiness = highestIssueStatus(settings.issues, 'configured');
    if (issueReadiness === 'unsafe' || issueReadiness === 'conflict') {
      return Object.freeze({ status: issueReadiness, issues: settings.issues, configuration: null, items: Object.freeze([]) });
    }
    if (!settings.providerBaseUrl || !settings.modelName || settings.dailyTokenLimit === null || settings.sessionTokenLimit === null) {
      return Object.freeze({ status: 'missing', issues: settings.issues, configuration: null, items: Object.freeze([]) });
    }
    const database = inspectLiveChatDatabase(connection, settings);
    const key = item('provider_api_key', settings.keyPresent ? 'present' : 'missing', 'environment_only');
    const items = Object.freeze([...database.items, key]);
    const status = items.some((entry) => entry.status === 'conflict')
      ? 'conflict'
      : items.some((entry) => entry.status === 'missing')
        ? 'missing'
        : 'configured';
    return Object.freeze({
      status,
      issues: settings.issues,
      configuration: Object.freeze({
        providerBaseUrl: settings.providerBaseUrl,
        providerInterface: LIVE_CHAT_CONFIGURATION.interfaceFormat,
        modelName: settings.modelName,
        taskType: 'chat',
        dailyTokenLimit: settings.dailyTokenLimit,
        sessionTokenLimit: settings.sessionTokenLimit,
        overagePolicy: LIVE_CHAT_CONFIGURATION.overagePolicy,
        credential: settings.keyPresent ? 'present' : 'missing',
      }),
      items,
    });
  }

  function apply({ acknowledgeExternalProvider, acknowledgePossibleCharges }) {
    if (!acknowledgeExternalProvider || !acknowledgePossibleCharges) {
      throw new ValidationError('Applying live chat preparation requires both explicit acknowledgements.');
    }
    const settings = requireLiveChatEnvironment(environment);
    ensureNoConflict(inspectLiveChatDatabase(connection, settings));
    fixedLocalChatProfileService.prepare();

    let state = inspectLiveChatDatabase(connection, settings);
    let providerId = state.providerId;
    if (!providerId) {
      providerId = apiProviderService.createProvider(LIVE_CHAT_CONFIGURATION.userId, {
        displayName: LIVE_CHAT_CONFIGURATION.providerDisplayName,
        providerType: LIVE_CHAT_CONFIGURATION.providerType,
        baseUrl: settings.providerBaseUrl,
        interfaceFormat: LIVE_CHAT_CONFIGURATION.interfaceFormat,
        status: 'enabled',
      }).providerId;
    }

    state = inspectLiveChatDatabase(connection, settings);
    let modelId = state.modelId;
    if (!modelId) {
      modelId = modelService.createModel(
        LIVE_CHAT_CONFIGURATION.userId,
        providerId,
        {
          modelName: settings.modelName,
          modelType: 'chat',
          capabilities: ['chat'],
          costDescription: LIVE_CHAT_CONFIGURATION.costDescription,
        },
      ).modelId;
    }

    state = inspectLiveChatDatabase(connection, settings);
    if (state.items.find(({ component }) => component === 'chat_route').status === 'missing') {
      modelRoutingRuleService.createRule(LIVE_CHAT_CONFIGURATION.userId, {
        taskType: 'chat',
        defaultModelId: modelId,
        fallbackModelId: null,
        status: 'enabled',
      });
    }

    for (const action of ['manage', 'execute']) {
      state = inspectLiveChatDatabase(connection, settings);
      if (state.items.find(({ component }) => component === `permission_${action}`).status === 'missing') {
        permissionService.createPermission(LIVE_CHAT_CONFIGURATION.userId, {
          subjectId: LIVE_CHAT_CONFIGURATION.assistantId,
          resourceType: 'api',
          resourceId: providerId,
          action,
          permissionLevel: 'always_allow',
          status: 'active',
        });
      }
    }

    state = inspectLiveChatDatabase(connection, settings);
    if (state.items.find(({ component }) => component === 'token_budget').status === 'missing') {
      proactiveInteractionService.upsertTokenBudget(
        LIVE_CHAT_CONFIGURATION.userId,
        LIVE_CHAT_CONFIGURATION.assistantId,
        {
          dailyTokenLimit: settings.dailyTokenLimit,
          sessionTokenLimit: settings.sessionTokenLimit,
          overagePolicy: LIVE_CHAT_CONFIGURATION.overagePolicy,
          status: 'enabled',
        },
      );
    }

    state = inspectLiveChatDatabase(connection, settings);
    if (state.items.find(({ component }) => component === 'credential_binding').status === 'missing') {
      const pending = apiProviderService.bindCredentialReference(
        LIVE_CHAT_CONFIGURATION.userId,
        providerId,
        {
          subjectId: LIVE_CHAT_CONFIGURATION.assistantId,
          secretRef: LIVE_CHAT_CONFIGURATION.credentialSecretRef,
        },
      );
      if (pending.operationStatus !== 'confirmation_required') {
        throw new ConflictError('Credential binding did not enter the required confirmation flow.');
      }
      const confirmationId = pending.security?.confirmation?.confirmationId;
      confirmationService.decideConfirmation(
        LIVE_CHAT_CONFIGURATION.userId,
        confirmationId,
        { decision: 'approve' },
      );
      const bound = apiProviderService.bindCredentialReference(
        LIVE_CHAT_CONFIGURATION.userId,
        providerId,
        {
          subjectId: LIVE_CHAT_CONFIGURATION.assistantId,
          secretRef: LIVE_CHAT_CONFIGURATION.credentialSecretRef,
          confirmationId,
        },
      );
      if (bound.operationStatus !== 'completed') {
        throw new ConflictError('Credential reference confirmation did not complete.');
      }
    }

    const completed = inspectLiveChatDatabase(connection, settings);
    ensureNoConflict(completed);
    if (completed.items.some(({ status }) => status !== 'configured')) {
      throw new ConflictError('Live chat preparation did not reach an exact configured state.');
    }
    return Object.freeze({
      status: 'configured',
      providerId: completed.providerId,
      modelId: completed.modelId,
      items: completed.items,
      configuration: Object.freeze({
        providerBaseUrl: settings.providerBaseUrl,
        providerInterface: LIVE_CHAT_CONFIGURATION.interfaceFormat,
        modelName: settings.modelName,
        taskType: 'chat',
        dailyTokenLimit: settings.dailyTokenLimit,
        sessionTokenLimit: settings.sessionTokenLimit,
        overagePolicy: LIVE_CHAT_CONFIGURATION.overagePolicy,
        credential: 'configured',
      }),
      externalCall: 'not_performed',
      providerCharge: 'not_incurred',
    });
  }

  return Object.freeze({ plan, apply });
}

function runtimeItem(component, status, reason = null) {
  return Object.freeze({ component, status, reason });
}

function sha256FileStem(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function inspectInitializedEngineData(engineDataDir, cycleId) {
  const runtimeBinding = readJson(join(
    engineDataDir,
    'integration',
    'subject-binding.runtime-v1.json',
  ));
  const binding = runtimeBinding?.binding;
  const expectedBinding = {
    ...fixedSubjectBindingFixture(),
    cycleId,
    bindingFixtureHash: EXPECTED_BINDING_FIXTURE_HASH,
  };
  if (
    runtimeBinding?.bindingPersistenceFormatVersion !== 1
    || !isDeepStrictEqual(binding, expectedBinding)
  ) {
    return 'engine_runtime_binding_mismatch';
  }

  const stateDocument = readJson(join(
    engineDataDir,
    'subject-state',
    `${sha256FileStem(LIVE_CHAT_CONFIGURATION.engineSubjectId)}.json`,
  ));
  const state = stateDocument?.state ?? stateDocument;
  if (
    state?.subject_id !== LIVE_CHAT_CONFIGURATION.engineSubjectId
    || !Number.isSafeInteger(state?.revision)
    || state.revision < 0
  ) {
    return 'engine_subject_state_mismatch';
  }

  const cycle = readJson(join(
    engineDataDir,
    'awakening',
    'cycles',
    `${sha256FileStem(cycleId)}.json`,
  ));
  if (
    cycle?.cycle_id !== cycleId
    || cycle?.subject_id !== LIVE_CHAT_CONFIGURATION.engineSubjectId
    || cycle?.mode !== 'manual'
  ) {
    return 'engine_cycle_mismatch';
  }

  const resultLedger = readJson(join(
    engineDataDir,
    'integration',
    'result-ledger.first-round-v1.json',
  ));
  const operationJournal = readJson(join(
    engineDataDir,
    'integration',
    'operation-journal.first-round-v1.json',
  ));
  const capabilityLedger = readJson(join(
    engineDataDir,
    'integration',
    'capability-ledger.v1.json',
  ));
  if (
    resultLedger?.ledgerPersistenceFormatVersion !== 1
    || !Array.isArray(resultLedger.results)
    || operationJournal?.operationJournalFormatVersion !== 3
    || !Array.isArray(operationJournal.operations)
    || capabilityLedger?.capabilityLedgerFormatVersion !== 1
    || !Array.isArray(capabilityLedger.requests)
    || !Array.isArray(capabilityLedger.attempts)
  ) {
    return 'engine_integration_ledgers_invalid';
  }
  return null;
}

export function inspectLiveChatRuntime(environment = process.env) {
  const items = [];
  const bindingFile = environment.VIO_LIVE_BINDING_FILE?.trim() ?? '';
  if (!bindingFile) {
    items.push(runtimeItem('binding_file', 'missing', 'binding_file_missing'));
  } else if (!existsSync(bindingFile)) {
    items.push(runtimeItem('binding_file', 'conflict', 'binding_file_unavailable'));
  } else {
    try {
      const fixture = JSON.parse(readFileSync(bindingFile, 'utf8'));
      const hash = calculateBindingFixtureHash(fixture);
      validateFixedSubjectBindingFixture(fixture, hash);
      items.push(runtimeItem(
        'binding_file',
        hash === EXPECTED_BINDING_FIXTURE_HASH && isDeepStrictEqual(fixture, fixedSubjectBindingFixture())
          ? 'ready'
          : 'conflict',
        hash === EXPECTED_BINDING_FIXTURE_HASH ? null : 'binding_hash_mismatch',
      ));
    } catch {
      items.push(runtimeItem('binding_file', 'conflict', 'binding_file_invalid'));
    }
  }

  const engineDataDir = environment.VIO_LIVE_ENGINE_DATA_DIR?.trim() ?? '';
  const cycleId = environment.VIO_LIVE_ENGINE_CYCLE_ID?.trim() ?? '';
  let engineDataStatus = 'missing';
  let engineDataReason = 'engine_data_dir_missing';
  if (engineDataDir) {
    if (!existsSync(engineDataDir)) {
      engineDataStatus = 'conflict';
      engineDataReason = 'engine_data_dir_unavailable';
    } else {
      try {
        const reason = inspectInitializedEngineData(engineDataDir, cycleId);
        if (reason === null) {
          engineDataStatus = 'ready';
          engineDataReason = null;
        } else {
          engineDataStatus = 'conflict';
          engineDataReason = reason;
        }
      } catch {
        engineDataStatus = 'conflict';
        engineDataReason = 'engine_runtime_binding_missing_or_invalid';
      }
    }
  }
  items.push(runtimeItem('engine_data_dir', engineDataStatus, engineDataReason));
  items.push(runtimeItem(
    'engine_cycle_id',
    !cycleId ? 'missing' : cycleId.length <= 128 ? 'ready' : 'conflict',
    !cycleId ? 'engine_cycle_id_missing' : cycleId.length <= 128 ? null : 'engine_cycle_id_invalid',
  ));
  const thinkingMode = environment.VIO_LIVE_ENGINE_THINKING_MODE?.trim() ?? '';
  items.push(runtimeItem(
    'engine_thinking_mode',
    !thinkingMode ? 'missing' : thinkingMode === 'capability' ? 'ready' : 'conflict',
    !thinkingMode ? 'engine_thinking_mode_missing' : thinkingMode === 'capability' ? null : 'capability_mode_required',
  ));
  const continuityEnabled = environment.VIO_CONTINUITY_ENGINE_ENABLED?.trim() ?? '';
  items.push(runtimeItem(
    'continuity_enabled',
    !continuityEnabled ? 'missing' : continuityEnabled === 'true' ? 'ready' : 'conflict',
    !continuityEnabled ? 'continuity_enabled_missing' : continuityEnabled === 'true' ? null : 'continuity_must_be_enabled',
  ));

  const rawEngineBaseUrl = environment.VIO_CONTINUITY_ENGINE_BASE_URL?.trim() ?? '';
  let baseUrlReady = false;
  if (rawEngineBaseUrl) {
    try {
      const url = new URL(rawEngineBaseUrl);
      baseUrlReady = url.protocol === 'http:'
        && url.hostname === '127.0.0.1'
        && Boolean(url.port)
        && !url.username && !url.password && !url.search && !url.hash
        && (url.pathname === '/' || url.pathname === '');
    } catch {}
  }
  items.push(runtimeItem(
    'engine_base_url',
    !rawEngineBaseUrl ? 'missing' : baseUrlReady ? 'ready' : 'unsafe',
    !rawEngineBaseUrl ? 'engine_base_url_missing' : baseUrlReady ? null : 'loopback_engine_url_required',
  ));

  const vioToken = environment.VIO_CONTINUITY_ENGINE_TOKEN;
  const engineToken = environment.CONTINUITY_ENGINE_INTEGRATION_TOKEN;
  const vioTokenPresent = typeof vioToken === 'string' && vioToken.trim() !== '';
  const engineTokenPresent = typeof engineToken === 'string' && engineToken.trim() !== '';
  const tokensMissing = !vioTokenPresent && !engineTokenPresent;
  const tokenFormatValid = vioTokenPresent && engineTokenPresent
    && vioToken.length >= 32 && vioToken.length <= 8192
    && engineToken.length >= 32 && engineToken.length <= 8192
    && vioToken === vioToken.trim() && engineToken === engineToken.trim()
    && !/[\u0000-\u001f\u007f]/u.test(vioToken)
    && !/[\u0000-\u001f\u007f]/u.test(engineToken);
  const tokenStatus = tokensMissing
    ? 'missing'
    : !tokenFormatValid || vioToken !== engineToken
      ? 'conflict'
      : 'ready';
  items.push(runtimeItem(
    'service_tokens',
    tokenStatus,
    tokenStatus === 'missing'
      ? 'service_tokens_missing'
      : tokenStatus === 'ready'
        ? null
        : !vioTokenPresent || !engineTokenPresent
          ? 'service_tokens_incomplete'
          : !tokenFormatValid
            ? 'service_tokens_invalid'
            : 'service_tokens_mismatch',
  ));
  return Object.freeze(items);
}

export function doctorLiveChat({ connection, environment = process.env }) {
  const settings = inspectLiveChatEnvironment(environment);
  const providerIssues = settings.issues.filter((issue) => !issue.startsWith('provider_key_'));
  const providerStatus = highestIssueStatus(providerIssues);
  const environmentItems = [
    runtimeItem(
      'provider_environment',
      providerStatus,
      firstIssueForStatus(providerIssues, providerStatus),
    ),
    runtimeItem(
      'provider_api_key',
      settings.keyStatus,
      settings.keyStatus === 'ready' ? null : `provider_key_${settings.keyStatus}`,
    ),
  ];
  const database = settings.providerBaseUrl && settings.modelName
    && settings.dailyTokenLimit !== null && settings.sessionTokenLimit !== null
    ? inspectLiveChatDatabase(connection, settings).items.map((entry) => runtimeItem(
      entry.component,
      entry.status === 'configured' ? 'ready' : entry.status,
      entry.reason,
    ))
    : [];
  const sandbox = inspectLiveChatSandbox(environment);
  const items = Object.freeze([
    runtimeItem(
      's4_live_sandbox',
      sandbox.status,
      sandbox.reason,
    ),
    ...environmentItems,
    ...database,
    ...inspectLiveChatRuntime(environment),
  ]);
  const status = highestReadinessStatus(items.map(({ status: value }) => value), 'ready');
  return Object.freeze({ status, items, modelCall: 'not_performed', providerCharge: 'not_incurred' });
}
