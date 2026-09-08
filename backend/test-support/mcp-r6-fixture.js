import { createServer } from 'node:http';

import { createMcpStreamableHttpClient, MCP_PROTOCOL_VERSION } from '../src/integrations/mcp/mcp-streamable-http-client.js';

export const MCP_ECHO_TOOL = Object.freeze({
  name: 'echo',
  title: 'Controlled echo',
  description: 'Returns the bounded controlled test input.',
  inputSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      trace: { type: 'string', maxLength: 80, 'x-mcp-header': 'Trace' },
      text: { type: 'string', maxLength: 2000 },
    },
    required: ['text'],
    additionalProperties: false,
  },
  outputSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: { echoed: { type: 'string', maxLength: 2000 } },
    required: ['echoed'],
    additionalProperties: false,
  },
});

export async function startMcpR6Server(t, { mode = 'json', tools = [MCP_ECHO_TOOL] } = {}) {
  const requests = [];
  let behavior = mode;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    let body = null;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
    requests.push({
      method: request.method,
      url: request.url,
      protocolVersion: request.headers['mcp-protocol-version'],
      mcpMethod: request.headers['mcp-method'],
      mcpName: request.headers['mcp-name'],
      trace: request.headers['mcp-param-trace'],
      accept: request.headers.accept,
      body,
    });
    if (behavior === 'disconnect') { request.socket.destroy(); return; }
    if (behavior === 'timeout') return;
    if (behavior === 'redirect') { response.writeHead(302, { location: '/other' }); response.end(); return; }
    if (behavior === 'rate_limit') { response.writeHead(429); response.end(); return; }
    if (behavior === 'server_error') { response.writeHead(503); response.end(); return; }
    const result = body?.method === 'tools/list'
      ? { resultType: 'complete', tools, ttlMs: 60_000, cacheScope: 'private' }
      : { resultType: 'complete', content: [{ type: 'text', text: body?.params?.arguments?.text ?? '' }], structuredContent: { echoed: body?.params?.arguments?.text ?? '' }, isError: false };
    const payload = JSON.stringify({ jsonrpc: '2.0', id: body?.id, result });
    if (behavior === 'sse') {
      response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
      response.end(`event: message\ndata: ${payload}\n\n`);
    } else {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(payload);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    serviceUrl: `${origin}/mcp`,
    requests,
    client: createMcpStreamableHttpClient({ allowedLoopbackOrigins: [origin], connectTimeoutMs: 100, responseTimeoutMs: 200 }),
    setMode(value) { behavior = value; },
  };
}

export function assertMcpRequestShape(assert, request, method, { name = null } = {}) {
  assert.equal(request.method, 'POST');
  assert.equal(request.url, '/mcp');
  assert.equal(request.protocolVersion, MCP_PROTOCOL_VERSION);
  assert.equal(request.mcpMethod, method);
  assert.equal(request.mcpName ?? null, name);
  assert.match(request.accept, /application\/json/);
  assert.match(request.accept, /text\/event-stream/);
  assert.deepEqual(request.body.params._meta, {
    'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
    'io.modelcontextprotocol/clientInfo': { name: 'Vio', version: '0.19.0' },
    'io.modelcontextprotocol/clientCapabilities': {},
  });
}
