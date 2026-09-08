// Opt-in disposable R3 browser integration environment. It owns every
// database, attachment, credential, Provider and proxy fact that it creates,
// listens on loopback only, and never discovers or contacts a real Engine.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import { createIsolatedTestEnvironment } from './isolated-test-environment.js';
import { sealTestCredential } from './personal-test-application.js';

const CONTROL_HEADER = 'controlled-r3-browser';
const PUBLIC_PORT = 8787;
const FRONTEND_ORIGIN = 'http://127.0.0.1:5173';
const PROVIDER_BEHAVIORS = new Set(['success', '429', 'disconnect', 'timeout']);
const DROP_KINDS = new Set(['turn', 'regeneration', 'conversation', 'attachment']);
const MAX_PROXY_RESPONSE_BYTES = 2 * 1024 * 1024;
const ENABLE_R4_CONTEXT = process.argv.includes('--r4-context');

const fixture = createIsolatedTestEnvironment({
  PATH: process.env.PATH,
  PATHEXT: process.env.PATHEXT,
  SystemRoot: process.env.SystemRoot,
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
});
process.env.VIO_TEST_PATHS_ROOT = fixture.root;
process.env.VIO_CONTINUITY_ENGINE_PATH = fixture.environment.VIO_CONTINUITY_ENGINE_PATH;
await import('./register-test-paths.js');

const { createApplication } = await import('../src/app.js');
const { loadConfig } = await import('../src/config.js');
const { createOpenAiCompatibleModelExecutor } = await import(
  '../src/integrations/model-providers/openai-compatible-model-executor.js'
);
const { createProviderConnectionChecker } = await import(
  '../src/integrations/model-providers/provider-connection-check.js'
);
const {
  SUBJECT_RUNTIME_PORT_VERSION,
  createSubjectRuntimeConnectionSnapshot,
  negotiateSubjectRuntimeVersion,
} = await import('../src/modules/subject-runtime/subject-runtime-port-v1.js');
const { createNoneSubjectRuntimeAdapter } = await import(
  '../src/modules/subject-runtime/none-subject-runtime-adapter.js'
);

let r4RuntimeEnabled = false;

const R4_RUNTIME_MANIFEST = Object.freeze({
  portVersion: SUBJECT_RUNTIME_PORT_VERSION,
  adapterId: 'r4-browser-isolated-runtime',
  adapterKind: 'third_party',
  adapterVersion: 'r4-browser-adapter/v1',
  runtimeMode: 'external',
  runtimeName: 'R4 isolated browser projection',
  runtimeVersion: 'r4-browser-runtime/v1',
  supportedPortVersions: Object.freeze([SUBJECT_RUNTIME_PORT_VERSION]),
  capabilities: Object.freeze(['observation_input', 'expression_result', 'state_projection']),
  specializedContracts: Object.freeze([]),
});

function createR4RuntimeAdapter() {
  const none = createNoneSubjectRuntimeAdapter();
  const current = () => {
    if (!r4RuntimeEnabled) return none;
    return {
      getManifest: () => structuredClone(R4_RUNTIME_MANIFEST),
      getConnectionStatus: () => createSubjectRuntimeConnectionSnapshot({
        manifest: R4_RUNTIME_MANIFEST,
        state: 'ready',
        reason: 'isolated_browser_projection_ready',
      }),
      negotiateVersion: (vioSupportedVersions) => negotiateSubjectRuntimeVersion({
        vioSupportedVersions,
        adapterManifest: R4_RUNTIME_MANIFEST,
      }),
    };
  };
  return Object.freeze({
    getManifest: () => current().getManifest(),
    getConnectionStatus: () => current().getConnectionStatus(),
    negotiateVersion: (vioSupportedVersions) => current().negotiateVersion(vioSupportedVersions),
    submitObservation() { throw new Error('R4 browser fixture must not execute a runtime.'); },
    cancel() { throw new Error('R4 browser fixture must not execute a runtime.'); },
    recover() { throw new Error('R4 browser fixture must not execute a runtime.'); },
  });
}

const R4_PROJECTION_PORT = Object.freeze({
  readVerifiedProjection({ assistantId }) {
    return Object.freeze({
      verified: true,
      projectionId: `r4-browser-${assistantId}`,
      content: 'Controlled, verified R4 browser projection. No external runtime was contacted.',
      verifiedAt: '2026-09-07T00:00:00.000Z',
    });
  },
});

const spaces = new Map([
  ['owner-a', {
    key: 'owner-a',
    passphrase: 'controlled-r3-browser-passphrase-a',
    credential: 'controlled-r3-loopback-credential-a',
    ownerName: 'R3 browser owner A',
    assistantNames: ['R3 A assistant one', 'R3 A assistant two'],
  }],
  ['owner-b', {
    key: 'owner-b',
    passphrase: 'controlled-r3-browser-passphrase-b',
    credential: 'controlled-r3-loopback-credential-b',
    ownerName: 'R3 browser owner B',
    assistantNames: ['R3 B assistant one', 'R3 B assistant two'],
  }],
]);
let activeSpaceKey = 'owner-a';
let dropNext = null;
let droppedResponses = 0;
let nextProviderBehavior = 'success';
let stopping = false;

const providerCalls = new Map([...spaces.keys()].map((key) => [key, 0]));
const attachmentFixtures = {
  image: join(fixture.root, 'r3-browser-image.png'),
  file: join(fixture.root, 'r3-browser-file.txt'),
  audio: join(fixture.root, 'r3-browser-audio.wav'),
};
writeFileSync(attachmentFixtures.image, Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
));
writeFileSync(attachmentFixtures.file, 'Controlled R3 browser attachment.\n', { encoding: 'utf8' });
const wave = Buffer.alloc(44);
wave.write('RIFF', 0, 'ascii');
wave.writeUInt32LE(36, 4);
wave.write('WAVEfmt ', 8, 'ascii');
wave.writeUInt32LE(16, 16);
wave.writeUInt16LE(1, 20);
wave.writeUInt16LE(1, 22);
wave.writeUInt32LE(8_000, 24);
wave.writeUInt32LE(16_000, 28);
wave.writeUInt16LE(2, 32);
wave.writeUInt16LE(16, 34);
wave.write('data', 36, 'ascii');
wave.writeUInt32LE(0, 40);
writeFileSync(attachmentFixtures.audio, wave);
function spaceForCredential(authorization) {
  return [...spaces.values()].find((space) => authorization === `Bearer ${space.credential}`) ?? null;
}

const provider = createServer(async (request, response) => {
  for await (const _chunk of request) {
    // Drain without retaining or logging model input.
  }
  const space = spaceForCredential(request.headers.authorization);
  if (request.method !== 'POST' || request.url !== '/chat/completions' || !space) {
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end('{"error":"denied"}');
    return;
  }
  providerCalls.set(space.key, providerCalls.get(space.key) + 1);
  const behavior = nextProviderBehavior;
  nextProviderBehavior = 'success';
  if (behavior === '429') {
    response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0' });
    response.end('{"error":{"type":"rate_limit"}}');
    return;
  }
  if (behavior === 'disconnect') {
    response.destroy();
    return;
  }
  const sendSuccess = () => {
    if (response.destroyed) return;
    const count = providerCalls.get(space.key);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      choices: [{ message: { content: `受控 ${space.key} R3 回答 ${count}。` }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 18, completion_tokens: 7, total_tokens: 25 },
    }));
  };
  if (behavior === 'timeout') setTimeout(sendSuccess, 3_000).unref();
  else sendSuccess();
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
const providerOrigin = `http://127.0.0.1:${provider.address().port}`;

async function internalCall(space, path, method = 'GET', body = undefined, headers = {}) {
  const response = await fetch(`${space.origin}/api/v1/personal${path}`, {
    method,
    headers: {
      cookie: space.seedCookie ?? '',
      'x-vio-csrf': space.seedCsrf ?? '',
      origin: FRONTEND_ORIGIN,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (response.headers.has('set-cookie')) {
    const jar = new Map((space.seedCookie ?? '').split(';').map((item) => item.trim()).filter(Boolean).map((item) => {
      const separator = item.indexOf('=');
      return [item.slice(0, separator), item.slice(separator + 1)];
    }));
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(';')[0];
      const separator = pair.indexOf('=');
      if (/Max-Age=0(?:;|$)/iu.test(header)) jar.delete(pair.slice(0, separator));
      else jar.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    space.seedCookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  }
  if (value.data?.csrfToken) space.seedCsrf = value.data.csrfToken;
  return { status: response.status, ...value };
}

async function secured(space, path, method, body, idempotencyKey) {
  let result = await internalCall(space, path, method, body, { 'idempotency-key': idempotencyKey });
  assert.equal(result.status, 200, JSON.stringify(result));
  if (result.data.operationStatus === 'confirmation_required') {
    const confirmationId = result.data.security.confirmation.confirmationId;
    const decision = await internalCall(space, `/confirmations/${confirmationId}/decision`, 'POST', { decision: 'approve' });
    assert.equal(decision.status, 200, JSON.stringify(decision));
    result = await internalCall(space, path, method, { ...body, confirmationId }, { 'idempotency-key': idempotencyKey });
  }
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.data.operationStatus, 'completed', JSON.stringify(result));
  return result.data;
}

function createSpaceApplication(space) {
  return createApplication({
    config: loadConfig({
      VIO_BACKEND_HOST: '127.0.0.1',
      VIO_BACKEND_PORT: '0',
      VIO_BACKEND_DB_PATH: join(fixture.root, `${space.key}.sqlite`),
      VIO_PERSONAL_ALLOWED_ORIGIN: FRONTEND_ORIGIN,
    }),
    environment: {},
    logger: { error() {} },
    modelExecutor: createOpenAiCompatibleModelExecutor({
      allowLoopbackHttp: true,
      connectTimeoutMs: 200,
      responseTimeoutMs: 2_000,
      maxRequestBytes: 256 * 1024,
      maxResponseBytes: 256 * 1024,
    }),
    providerConnectionChecker: createProviderConnectionChecker({
      allowedLoopbackOrigins: [providerOrigin],
    }),
    standaloneChatAttachmentRoot: join(fixture.root, `${space.key}-attachments`),
    ...(ENABLE_R4_CONTEXT ? {
      subjectRuntimeAdapter: createR4RuntimeAdapter(),
      runtimeProjectionPort: R4_PROJECTION_PORT,
    } : {}),
  });
}

async function startSpace(space) {
  space.app = createSpaceApplication(space);
  const address = await space.app.start();
  space.origin = `http://127.0.0.1:${address.port}`;
}

async function seedSpace(space) {
  const invitation = space.app.personalIdentityService.issueInvitation();
  const initialized = await internalCall(space, '/initialize', 'POST', {
    invitation,
    passphrase: space.passphrase,
    agreementVersion: 'personal-use/v1',
  }, { 'idempotency-key': `r3-browser-${space.key}-initialize` });
  assert.equal(initialized.status, 200, JSON.stringify(initialized));
  const onboarded = await internalCall(space, '/onboarding', 'POST', {
    displayName: space.ownerName,
    avatar: null,
    assistant: {
      name: space.assistantNames[0],
      avatar: null,
      settings: {
        positioning: 'personal assistant',
        personality: 'careful',
        persona: 'concise',
        requirements: `Use only ${space.key} selected conversation.`,
        contextMode: 'balanced',
      },
    },
    preferences: { storagePreference: 'local', contextMode: 'balanced' },
  }, { 'idempotency-key': `r3-browser-${space.key}-onboarding` });
  assert.equal(onboarded.status, 200, JSON.stringify(onboarded));
  const secondAssistant = await internalCall(space, '/assistants', 'POST', {
    name: space.assistantNames[1],
    avatar: null,
    settings: {
      positioning: 'research assistant',
      personality: 'methodical',
      persona: 'precise',
      requirements: `Use only ${space.key} second assistant and selected conversation.`,
      contextMode: 'balanced',
    },
  }, { 'idempotency-key': `r3-browser-${space.key}-second-assistant` });
  assert.equal(secondAssistant.status, 201, JSON.stringify(secondAssistant));

  const providerResult = await secured(space, '/providers', 'POST', {
    displayName: `${space.key} controlled loopback Provider`,
    providerType: 'openai',
    baseUrl: providerOrigin,
    interfaceFormat: 'openai_compatible',
    status: 'enabled',
  }, `r3-browser-${space.key}-provider`);
  const providerId = providerResult.provider.providerId;
  const transport = (await internalCall(space, '/vault')).data.transport;
  await secured(
    space,
    `/providers/${providerId}/credential`,
    'PUT',
    sealTestCredential(transport, space.credential),
    `r3-browser-${space.key}-credential`,
  );
  await secured(space, '/models', 'POST', {
    providerId,
    modelName: `${space.key}-controlled-model`,
    modelType: 'chat',
    capabilities: ['chat'],
    defaultForChat: true,
  }, `r3-browser-${space.key}-model`);
  const assistantIds = [onboarded.data.currentAssistantId, secondAssistant.data.assistantId];
  for (const assistantId of assistantIds) {
    space.app.proactiveInteractionService.upsertTokenBudget(
      initialized.data.user.userId,
      assistantId,
      { dailyTokenLimit: 100_000, sessionTokenLimit: 50_000, overagePolicy: 'block', status: 'enabled' },
    );
  }
  async function selectAssistant(assistantId, expectedSelectionVersion) {
    const selected = await internalCall(space, '/current-assistant', 'PUT', {
      assistantId,
      expectedSelectionVersion,
    });
    assert.equal(selected.status, 200, JSON.stringify(selected));
    return selected.data.selectionVersion;
  }
  async function seedConversations(prefix, count) {
    for (let index = 1; index <= count; index += 1) {
      const title = index === count && count > 2
        ? `${prefix} Search Needle`
        : `${prefix} seeded ${String(index).padStart(2, '0')}`;
      const created = await internalCall(space, '/chat/conversations', 'POST', { title }, {
        'idempotency-key': `r3-browser-${space.key}-${prefix.toLowerCase().replaceAll(' ', '-')}-${index}`,
      });
      assert.equal(created.status, 201, JSON.stringify(created));
    }
  }
  await seedConversations(`${space.key} A1`, space.key === 'owner-a' ? 51 : 2);
  let selectionVersion = await selectAssistant(assistantIds[1], onboarded.data.selectionVersion);
  await seedConversations(`${space.key} A2`, 2);
  selectionVersion = await selectAssistant(assistantIds[0], selectionVersion);
  assert.ok(Number.isInteger(selectionVersion));
  space.userId = initialized.data.user.userId;
  space.assistantIds = assistantIds;
  space.seeded = true;
}

for (const space of spaces.values()) {
  await startSpace(space);
  await seedSpace(space);
}

function matchesDrop(kind, method, pathname) {
  if (method !== 'POST') return false;
  if (kind === 'turn') return /\/api\/v1\/personal\/chat\/conversations\/[^/]+\/turns$/u.test(pathname);
  if (kind === 'regeneration') return /\/api\/v1\/personal\/chat\/conversations\/[^/]+\/messages\/[^/]+\/regenerations$/u.test(pathname);
  if (kind === 'conversation') return pathname === '/api/v1/personal/chat/conversations';
  if (kind === 'attachment') return /\/api\/v1\/personal\/chat\/conversations\/[^/]+\/attachments$/u.test(pathname);
  return false;
}

function publicSpace(space) {
  if (!space.app) return { key: space.key, status: 'stopped', providerCalls: providerCalls.get(space.key) };
  const count = (table) => space.app.database.connection.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
  const subjectRuntime = ENABLE_R4_CONTEXT
    ? space.app.subjectRuntimeStatusService.getStatus()
    : null;
  return {
    key: space.key,
    status: 'running',
    assistantCount: space.assistantIds.length,
    conversations: count('personal_chat_conversations'),
    turns: count('standalone_chat_turns'),
    messages: count('messages'),
    attachments: count('personal_chat_attachments'),
    providerCalls: providerCalls.get(space.key),
    r4Context: ENABLE_R4_CONTEXT ? 'enabled' : 'disabled',
    ...(ENABLE_R4_CONTEXT ? {
      subjectRuntime: {
        mode: subjectRuntime.mode,
        state: subjectRuntime.state,
        runtimeStatus: subjectRuntime.runtimeStatus,
      },
    } : {}),
  };
}

function controlResponse() {
  return {
    status: 'ready',
    activeSpace: activeSpaceKey,
    spaces: [...spaces.values()].map(publicSpace),
    dropNext,
    droppedResponses,
    nextProviderBehavior,
    engine: 'not_accessed',
    r4RuntimeProjection: ENABLE_R4_CONTEXT
      ? (r4RuntimeEnabled ? 'enabled' : 'disabled')
      : 'unavailable',
    externalProvider: 'not_used',
    providerCharge: 'not_incurred',
  };
}

async function readControlBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32 * 1024) throw new Error('control_body_too_large');
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

async function restartSpace(space) {
  await space.app.stop();
  space.app = null;
  space.origin = null;
  await startSpace(space);
}

async function setR4RuntimeProjection(enabled) {
  if (!ENABLE_R4_CONTEXT) throw new Error('r4_context_not_enabled');
  if (r4RuntimeEnabled === enabled) return;
  r4RuntimeEnabled = enabled;
  for (const space of spaces.values()) await restartSpace(space);
}

async function handleControl(request, response) {
  if (request.headers['x-r3-test-control'] !== CONTROL_HEADER) {
    response.writeHead(403, { 'content-type': 'application/json' });
    response.end('{"status":"denied"}');
    return;
  }
  if (request.method === 'GET') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(controlResponse()));
    return;
  }
  if (request.method !== 'POST') {
    response.writeHead(405, { 'content-type': 'application/json' });
    response.end('{"status":"unsupported"}');
    return;
  }
  try {
    const value = await readControlBody(request);
    if (value.action === 'switch-owner' && spaces.has(value.owner)) activeSpaceKey = value.owner;
    else if (value.action === 'drop-next' && DROP_KINDS.has(value.kind)) dropNext = value.kind;
    else if (value.action === 'provider-next' && PROVIDER_BEHAVIORS.has(value.behavior)) nextProviderBehavior = value.behavior;
    else if (value.action === 'r4-runtime' && ENABLE_R4_CONTEXT
        && typeof value.enabled === 'boolean') await setR4RuntimeProjection(value.enabled);
    else if (value.action === 'restart-active') await restartSpace(spaces.get(activeSpaceKey));
    else if (value.action === 'clear-faults') {
      dropNext = null;
      nextProviderBehavior = 'success';
    } else if (value.action === 'stop') {
      response.writeHead(202, { 'content-type': 'application/json' });
      response.end('{"status":"stopping"}');
      setImmediate(() => void shutdown());
      return;
    } else throw new Error('unsupported_control_action');
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(controlResponse()));
  } catch (error) {
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'invalid', reason: error.message }));
  }
}

const proxy = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  if (pathname === '/__r3-test-support__/control') {
    void handleControl(request, response);
    return;
  }
  const space = spaces.get(activeSpaceKey);
  if (!space?.origin) {
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end('{"success":false,"data":null,"error":{"code":"TEST_BACKEND_RESTARTING","message":"Temporary backend is restarting."}}');
    return;
  }
  const target = new URL(request.url, space.origin);
  const upstream = httpRequest(target, {
    method: request.method,
    headers: { ...request.headers, host: target.host },
  }, (upstreamResponse) => {
    const chunks = [];
    let size = 0;
    upstreamResponse.on('data', (chunk) => {
      size += chunk.length;
      if (size <= MAX_PROXY_RESPONSE_BYTES) chunks.push(chunk);
    });
    upstreamResponse.once('end', () => {
      const shouldDrop = dropNext && matchesDrop(dropNext, request.method, pathname);
      if (shouldDrop) {
        dropNext = null;
        droppedResponses += 1;
        response.destroy();
        return;
      }
      if (size > MAX_PROXY_RESPONSE_BYTES) {
        response.writeHead(502, { 'content-type': 'application/json' });
        response.end('{"success":false,"data":null,"error":{"code":"TEST_PROXY_RESPONSE_TOO_LARGE","message":"Temporary proxy response exceeded its limit."}}');
        return;
      }
      response.writeHead(upstreamResponse.statusCode, upstreamResponse.headers);
      response.end(Buffer.concat(chunks));
    });
  });
  upstream.once('error', () => {
    if (response.headersSent || response.destroyed) response.destroy();
    else {
      response.writeHead(502, { 'content-type': 'application/json' });
      response.end('{"success":false,"data":null,"error":{"code":"TEST_PROXY_UPSTREAM_UNAVAILABLE","message":"Temporary backend is unavailable."}}');
    }
  });
  request.pipe(upstream);
});
await new Promise((resolve) => proxy.listen(PUBLIC_PORT, '127.0.0.1', resolve));

process.stdout.write(`${JSON.stringify({
  status: 'ready',
  backend: `http://127.0.0.1:${PUBLIC_PORT}`,
  frontend: FRONTEND_ORIGIN,
  control: `http://127.0.0.1:${PUBLIC_PORT}/__r3-test-support__/control`,
  controlHeader: CONTROL_HEADER,
  owners: [...spaces.values()].map((space) => ({
    key: space.key,
    loginPassphrase: space.passphrase,
    assistantNames: space.assistantNames,
  })),
  provider: 'controlled_loopback',
  r4Context: ENABLE_R4_CONTEXT ? 'enabled' : 'disabled',
  r4RuntimeProjection: ENABLE_R4_CONTEXT ? 'toggle_via_control' : 'unavailable',
  faultInjection: [...DROP_KINDS],
  providerBehaviors: [...PROVIDER_BEHAVIORS],
  attachmentFixtures,
  fixtureRoot: fixture.root,
  engine: 'not_accessed',
  providerCharge: 'not_incurred',
})}\n`);

const commands = createInterface({ input: process.stdin });
async function shutdown() {
  if (stopping) return;
  stopping = true;
  commands.close();
  if (proxy.listening) await new Promise((resolve) => proxy.close(resolve));
  for (const space of spaces.values()) {
    if (space.app) await space.app.stop();
    space.app = null;
  }
  await new Promise((resolve) => provider.close(resolve));
  fixture.remove();
  process.stdout.write('fixture_removed=true\n');
  process.exit(0);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
for await (const command of commands) {
  const [verb, value] = command.trim().split(/\s+/u);
  if (verb === 'status') process.stdout.write(`${JSON.stringify(controlResponse())}\n`);
  else if (verb === 'use' && spaces.has(value)) {
    activeSpaceKey = value;
    process.stdout.write(`${JSON.stringify(controlResponse())}\n`);
  } else if (verb === 'drop-next' && DROP_KINDS.has(value)) {
    dropNext = value;
    process.stdout.write(`${JSON.stringify(controlResponse())}\n`);
  } else if (verb === 'provider-next' && PROVIDER_BEHAVIORS.has(value)) {
    nextProviderBehavior = value;
    process.stdout.write(`${JSON.stringify(controlResponse())}\n`);
  } else if (verb === 'r4-runtime' && ENABLE_R4_CONTEXT && ['on', 'off'].includes(value)) {
    await setR4RuntimeProjection(value === 'on');
    process.stdout.write(`${JSON.stringify(controlResponse())}\n`);
  } else if (verb === 'restart') {
    await restartSpace(spaces.get(activeSpaceKey));
    process.stdout.write(`${JSON.stringify(controlResponse())}\n`);
  } else if (verb === 'stop') await shutdown();
  else process.stdout.write('{"status":"unsupported"}\n');
}
await new Promise(() => {});
