import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

import { createApplication } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createHttpContinuityIntegrationTransport } from '../src/integrations/continuity-engine/http-continuity-integration-transport.js';
import { createOpenAiCompatibleModelExecutor } from '../src/integrations/model-providers/openai-compatible-model-executor.js';
import { createEnvironmentApiCredentialStore } from '../src/integrations/secrets/environment-api-credential-store.js';
import { EXPECTED_BINDING_FIXTURE_HASH, fixedSubjectBindingFixture } from '../src/modules/continuity-integration/first-round-contract.js';
import { configureV4Execution } from './continuity-capability-v4-fixtures.js';

export const VIO_V5_PARENT = '0b68e3209cd11c662d4cb973084a18825ed3d03e';
export const ENGINE_E5A_BASELINE = 'cba52126db2fb5eca57d9b5c0c80884693c59a6f';

function git(root, ...args) {
  return execFileSync('git', ['-c', `safe.directory=${root}`, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
}

export function requireEngineRepository(value = process.env.CONTINUITY_ENGINE_REPO) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('CONTINUITY_ENGINE_REPO is required for the V5 shared test.');
  }
  const root = resolve(value);
  if (!statSync(join(root, 'src', 'continuity_engine', 'integration_server.py')).isFile()) {
    throw new Error('CONTINUITY_ENGINE_REPO does not contain the E5-A integration server.');
  }
  assert.equal(git(root, 'rev-parse', 'HEAD'), ENGINE_E5A_BASELINE);
  assert.equal(git(root, 'rev-parse', 'origin/main'), ENGINE_E5A_BASELINE);
  assert.equal(git(root, 'status', '--short'), '');
  return root;
}

function pythonEnvironment(engineRoot, token = null) {
  const environment = {
    ...process.env,
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONPATH: [join(engineRoot, 'src'), process.env.PYTHONPATH]
      .filter(Boolean)
      .join(delimiter),
  };
  if (token === null) delete environment.CONTINUITY_ENGINE_INTEGRATION_TOKEN;
  else environment.CONTINUITY_ENGINE_INTEGRATION_TOKEN = token;
  return environment;
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const port = server.address().port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

function initializeEngine(engineRoot, dataDir, bindingFile) {
  const python = process.env.PYTHON || 'python';
  const output = execFileSync(python, [
    '-m', 'continuity_engine.integration_server', 'init',
    '--data-dir', dataDir,
    '--binding-file', bindingFile,
    '--binding-fixture-hash', EXPECTED_BINDING_FIXTURE_HASH,
    '--cycle-id', 'v5-public-chat-cycle-001',
  ], {
    cwd: engineRoot,
    env: pythonEnvironment(engineRoot),
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.match(output, /local integration data is initialized/);
}

async function startEngine(engineRoot, dataDir, port, token) {
  const python = process.env.PYTHON || 'python';
  const child = spawn(python, [
    '-m', 'continuity_engine.integration_server', 'serve',
    '--data-dir', dataDir,
    '--port', String(port),
    '--thinking-mode', 'capability',
  ], {
    cwd: engineRoot,
    env: pythonEnvironment(engineRoot, token),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk) => { output += chunk.toString('utf8'); });
  const closed = once(child, 'close');
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`Engine exited before readiness: ${output}`);
    try {
      const [live, ready] = await Promise.all([
        fetch(`${baseUrl}/health/live`),
        fetch(`${baseUrl}/health/ready`),
      ]);
      if (live.status === 200 && ready.status === 200) break;
    } catch {
      // Loopback listener is still starting.
    }
    if (Date.now() >= deadline) throw new Error(`Engine did not become ready: ${output}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  return {
    baseUrl,
    get output() { return output; },
    async stop() {
      if (child.exitCode === null) child.kill();
      await closed;
    },
  };
}

async function startProvider(secret) {
  const calls = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      calls.push({
        path: request.url,
        authorizationMatches: request.headers.authorization === `Bearer ${secret}`,
        model: body.model,
        stream: body.stream,
      });
      const payload = Buffer.from(JSON.stringify({
        choices: [{
          message: { content: 'V5 loopback Provider candidate.' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 13, completion_tokens: 5, total_tokens: 18 },
      }));
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': payload.length,
        connection: 'close',
      });
      response.end(payload);
    });
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    calls,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolveClose) => server.close(resolveClose));
    },
  };
}

function assertSecretsAbsent(root, secrets) {
  const visit = (directory) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) visit(path);
      else {
        const bytes = readFileSync(path);
        for (const secret of secrets) assert.ok(!bytes.includes(Buffer.from(secret)));
      }
    }
  };
  visit(root);
}

export function inspectEngine(environment) {
  const source = [
    'import json, sys',
    'from continuity_engine.domain.capability import IntegrationThinkingMode',
    'from continuity_engine.interfaces.local_integration_app import build_local_integration_app',
    'from continuity_engine.storage.json_thinking_repository import JsonThinkingRepository',
    'app = build_local_integration_app(sys.argv[1], thinking_mode=IntegrationThinkingMode.CAPABILITY)',
    'state = app.subject_states.load(app.binding.subject_id)',
    'operations = app.ledger.list_operations()',
    'thinking = JsonThinkingRepository(app.data_dir).list_think_sessions(app.binding.subject_id)',
    'print(json.dumps({"revision": state.revision, "operations": len(operations), "completed": len(app.ledger.list_completed()), "thinking": len(thinking)}))',
  ].join('\n');
  return JSON.parse(execFileSync(process.env.PYTHON || 'python', [
    '-c', source, environment.engineData,
  ], {
    cwd: environment.engineRoot,
    env: pythonEnvironment(environment.engineRoot),
    encoding: 'utf8',
    windowsHide: true,
  }));
}

export async function createV5SharedEnvironment() {
  const engineRoot = requireEngineRepository();
  const root = mkdtempSync(join(tmpdir(), 'vio-v5-shared-'));
  const engineData = join(root, 'engine-data');
  const bindingFile = join(root, 'binding.json');
  const databasePath = join(root, 'vio.sqlite');
  const serviceToken = randomBytes(32).toString('hex');
  const providerSecret = `v5_${randomBytes(24).toString('hex')}`;
  const enginePort = await reservePort();
  writeFileSync(bindingFile, JSON.stringify(fixedSubjectBindingFixture()), 'utf8');
  initializeEngine(engineRoot, engineData, bindingFile);
  let engine = await startEngine(engineRoot, engineData, enginePort, serviceToken);
  const provider = await startProvider(providerSecret);
  let application;
  let vioBaseUrl;

  async function startVio(seed) {
    const transport = createHttpContinuityIntegrationTransport({
      baseUrl: engine.baseUrl,
      serviceToken,
      connectTimeoutMs: 2_000,
      responseTimeoutMs: 20_000,
      maxResponseBytes: 2_097_152,
    });
    application = createApplication({
      config: loadConfig({
        VIO_BACKEND_HOST: '127.0.0.1',
        VIO_BACKEND_PORT: '0',
        VIO_BACKEND_DB_PATH: databasePath,
        VIO_CONTINUITY_ENGINE_ENABLED: 'true',
        VIO_CONTINUITY_ENGINE_BASE_URL: engine.baseUrl,
        VIO_CONTINUITY_ENGINE_TOKEN: serviceToken,
      }),
      logger: { error() {} },
      continuityTransport: transport,
      credentialStore: createEnvironmentApiCredentialStore({
        VIO_MODEL_API_KEY_TEST: providerSecret,
      }),
      modelExecutor: createOpenAiCompatibleModelExecutor({
        allowLoopbackHttp: true,
        connectTimeoutMs: 1_000,
        responseTimeoutMs: 2_000,
      }),
    });
    if (seed) {
      application.fixedLocalChatProfileService.prepare();
      configureV4Execution(application, { baseUrl: provider.baseUrl });
    }
    const address = await application.start();
    vioBaseUrl = `http://127.0.0.1:${address.port}`;
  }

  await startVio(true);
  return {
    engineRoot,
    engineData,
    root,
    databasePath,
    provider,
    get application() { return application; },
    get engine() { return engine; },
    get vioBaseUrl() { return vioBaseUrl; },
    async restartVio() {
      await application.stop();
      await startVio(false);
    },
    async restartEngine() {
      await engine.stop();
      engine = await startEngine(engineRoot, engineData, enginePort, serviceToken);
    },
    async cleanup() {
      await application?.stop();
      await engine?.stop();
      await provider.close();
      assertSecretsAbsent(root, [serviceToken, providerSecret]);
      rmSync(root, { recursive: true, force: true });
    },
  };
}
