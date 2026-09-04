import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startPersonalTestApplication, sealTestCredential } from '../test-support/personal-test-application.js';
import { createProviderConnectionChecker } from '../src/integrations/model-providers/provider-connection-check.js';

test('R2 HTTP wrong vault challenge keeps a valid session, while a revoked session remains unauthorized', async t => {
  const f = await startPersonalTestApplication(t);
  const initial = await f.initialize();
  const originalSession = initial.data.session.sessionId;
  const originalCookie = f.state.cookie;
  const originalCsrf = f.state.csrf;
  await f.restart();
  assert.equal((await f.call('/session')).data.vaultStatus, 'locked');

  const wrong = await f.call('/vault/unlock', 'POST', { passphrase: 'incorrect-controlled-test-passphrase' });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.error.code, 'VAULT_UNLOCK_FAILED');
  assert.equal(JSON.stringify(wrong).includes('incorrect-controlled-test-passphrase'), false);
  assert.equal(f.state.cookie, originalCookie, 'vault challenge must not clear the session cookie');
  const active = await f.call('/session');
  assert.equal(active.status, 200);
  assert.equal(active.data.session.sessionId, originalSession);
  assert.equal(active.data.vaultStatus, 'locked');
  const profile = await f.call('/profile');
  assert.equal(profile.status, 200);
  assert.equal(profile.data.userId, initial.data.user.userId);
  assert.equal((await f.call('/sessions')).data.items.find(s => s.sessionId === originalSession).status, 'active');

  const unlocked = await f.call('/vault/unlock', 'POST', { passphrase: 'controlled-personal-test-passphrase' });
  assert.equal(unlocked.status, 200);
  assert.equal(unlocked.data.status, 'ready');
  assert.equal((await f.call('/session')).data.session.sessionId, originalSession);

  assert.equal((await f.call('/session', 'DELETE')).status, 200);
  const invalid = await f.call('/vault/unlock', 'POST', { passphrase: 'controlled-personal-test-passphrase' }, {
    cookie: originalCookie, 'x-vio-csrf': originalCsrf,
  });
  assert.equal(invalid.status, 401);
  assert.equal(invalid.error.code, 'ACCESS_DENIED');
  assert.equal((await f.call('/profile', 'GET', undefined, { cookie: originalCookie })).status, 401);
});

test('R2 HTTP cancelled connection key never executes; an explicitly new key executes once and replays stably', async t => {
  let providerCalls = 0;
  const server = createServer((request, response) => {
    providerCalls += 1;
    assert.equal(request.method, 'GET');
    assert.equal(request.url, '/models');
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [{ id: 'controlled-cancellation-model' }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const f = await startPersonalTestApplication(t, {
    providerConnectionChecker: createProviderConnectionChecker({ allowedLoopbackOrigins: [origin] }),
  });
  await f.initialize();
  const created = await f.secured('/providers', 'POST', {
    displayName: 'Controlled cancellation provider', providerType: 'custom', baseUrl: origin,
    interfaceFormat: 'openai_compatible', status: 'enabled',
  }, 'provider-for-cancellation');
  const providerId = created.provider.providerId;
  const transport = (await f.call('/vault')).data.transport;
  await f.secured(`/providers/${providerId}/credential`, 'PUT',
    sealTestCredential(transport, 'isolated-cancellation-fixture'), 'credential-for-cancellation');

  const path = `/providers/${providerId}/connection-tests`;
  const operation = `connection/${providerId}`;
  const input = { scope: 'authentication' };
  const oldKey = 'explicitly-cancelled-connection';
  const waiting = await f.call(path, 'POST', input, { 'idempotency-key': oldKey });
  assert.equal(waiting.status, 200);
  assert.equal(waiting.data.operationStatus, 'confirmation_required');
  assert.equal(providerCalls, 0);
  const cancellation = await f.call('/operation-cancellations', 'POST', { operation, key: oldKey });
  assert.equal(cancellation.status, 200);
  assert.equal(cancellation.data.status, 'cancelled');
  const query = `/operations?operation=${encodeURIComponent(operation)}&key=${oldKey}`;
  assert.equal((await f.call(query)).data.status, 'cancelled');
  const replay = await f.call(path, 'POST', input, { 'idempotency-key': oldKey });
  assert.equal(replay.data.operationStatus, 'cancelled');
  assert.equal(providerCalls, 0);
  assert.equal(f.app.database.connection.prepare('SELECT count(*) n FROM personal_connection_tests').get().n, 0);

  await f.restart();
  assert.equal((await f.call(query)).data.status, 'cancelled');
  assert.equal((await f.call(path, 'POST', input, { 'idempotency-key': oldKey })).data.operationStatus, 'cancelled');
  assert.equal(providerCalls, 0);
  await f.call('/vault/unlock', 'POST', { passphrase: 'controlled-personal-test-passphrase' });
  const newKey = 'newly-approved-connection';
  const completed = await f.secured(path, 'POST', input, newKey);
  assert.equal(completed.test.status, 'succeeded');
  assert.equal(completed.test.generation, 'not_performed');
  assert.equal(providerCalls, 1);
  const exactReplay = await f.call(path, 'POST', input, { 'idempotency-key': newKey });
  assert.deepEqual(exactReplay.data.test, completed.test);
  assert.equal(providerCalls, 1);
  assert.equal((await f.call(path, 'POST', input, { 'idempotency-key': oldKey })).data.operationStatus, 'cancelled');
  assert.equal((await f.call(query)).data.status, 'cancelled');
  assert.equal(f.app.database.connection.prepare('SELECT count(*) n FROM personal_connection_tests').get().n, 1);
});
