import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { TextDecoder } from 'node:util';

import { ValidationError } from '../../core/errors.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]']);

function requirePositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError(`${field} must be a positive safe integer.`);
  }
  return value;
}

function normalizeEndpoint(baseUrl, allowLoopbackHttp) {
  let url;
  try { url = new URL(baseUrl); } catch {
    throw new ValidationError('Model Provider baseUrl is invalid.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ValidationError('Model Provider baseUrl must not contain credentials, query, or fragment.');
  }
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(allowLoopbackHttp && loopback && url.protocol === 'http:')) {
    throw new ValidationError('Model Provider must use HTTPS; loopback HTTP is test-only.');
  }
  url.pathname = `${url.pathname.replace(/\/$/, '')}/chat/completions`;
  return url;
}

function result(status, startedAt, completedAt, values = {}) {
  return Object.freeze({
    status,
    output: values.output ?? null,
    usage: values.usage ?? null,
    errorCode: values.errorCode ?? null,
    requestMayHaveBeenSent: values.requestMayHaveBeenSent ?? false,
    startedAt,
    completedAt,
    cost: values.cost ?? Object.freeze({ status: 'not_reported', amountMicros: null, currency: null }),
  });
}

export function createOpenAiCompatibleModelExecutor({
  connectTimeoutMs = 2_000,
  responseTimeoutMs = 30_000,
  maxResponseBytes = 2_097_152,
  maxRequestBytes = 1_048_576,
  allowLoopbackHttp = false,
  clock = () => new Date(),
} = {}) {
  requirePositiveInteger(connectTimeoutMs, 'connectTimeoutMs');
  requirePositiveInteger(responseTimeoutMs, 'responseTimeoutMs');
  requirePositiveInteger(maxResponseBytes, 'maxResponseBytes');
  requirePositiveInteger(maxRequestBytes, 'maxRequestBytes');

  return Object.freeze({
    async execute({ provider, model, apiKey, capabilityRequest, cancelled = false }) {
      const startedAt = clock().toISOString();
      if (cancelled) return result('CANCELLED', startedAt, startedAt, { errorCode: 'USER_CANCELLED' });
      if (Date.parse(capabilityRequest.deadlineAt) <= Date.parse(startedAt)) {
        return result('EXPIRED', startedAt, startedAt, { errorCode: 'CAPABILITY_DEADLINE_EXPIRED' });
      }
      if (provider.interfaceFormat !== 'openai_compatible') {
        return result('FAILED_TERMINAL', startedAt, startedAt, { errorCode: 'PROVIDER_INTERFACE_UNSUPPORTED' });
      }
      if (
        typeof apiKey !== 'string'
        || apiKey.length < 1
        || apiKey.length > 8192
        || /[\u0000-\u001f\u007f]/u.test(apiKey)
      ) {
        return result('FAILED_TERMINAL', startedAt, startedAt, { errorCode: 'PROVIDER_CREDENTIAL_UNAVAILABLE' });
      }
      let endpoint;
      try {
        endpoint = normalizeEndpoint(provider.baseUrl, allowLoopbackHttp);
      } catch {
        return result('FAILED_TERMINAL', startedAt, startedAt, { errorCode: 'PROVIDER_CONFIGURATION_INVALID' });
      }
      const body = Buffer.from(JSON.stringify({
        model: model.modelName,
        stream: false,
        messages: [{
          role: 'user',
          content: [
            capabilityRequest.input.instruction,
            capabilityRequest.input.messageContent,
            capabilityRequest.input.perceptionSummary,
            capabilityRequest.input.currentFocus,
          ].filter(Boolean).join('\n\n'),
        }],
      }), 'utf8');
      if (body.length > maxRequestBytes) {
        return result('FAILED_TERMINAL', startedAt, clock().toISOString(), { errorCode: 'PROVIDER_REQUEST_TOO_LARGE' });
      }

      return new Promise((resolve) => {
        let settled = false;
        let requestSent = false;
        let responseStarted = false;
        let connectTimer;
        let responseTimer;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(connectTimer);
          clearTimeout(responseTimer);
          resolve(value);
        };
        const requestFn = endpoint.protocol === 'https:' ? httpsRequest : httpRequest;
        const request = requestFn({
          protocol: endpoint.protocol,
          hostname: endpoint.hostname,
          port: endpoint.port,
          path: endpoint.pathname,
          method: 'POST',
          agent: false,
          headers: {
            authorization: `Bearer ${apiKey}`,
            accept: 'application/json',
            'content-type': 'application/json; charset=utf-8',
            'content-length': String(body.length),
            connection: 'close',
          },
        });
        request.on('finish', () => { requestSent = true; });
        connectTimer = setTimeout(() => request.destroy(new Error('connect_timeout')), connectTimeoutMs);
        request.on('socket', (socket) => {
          const connected = () => {
            clearTimeout(connectTimer);
            responseTimer = setTimeout(() => request.destroy(new Error('response_timeout')), responseTimeoutMs);
          };
          if (socket.connecting) socket.once('connect', connected);
          else connected();
        });
        request.on('response', (response) => {
          responseStarted = true;
          const chunks = [];
          let bytes = 0;
          response.on('data', (chunk) => {
            bytes += chunk.length;
            if (bytes > maxResponseBytes) response.destroy(new Error('response_too_large'));
            else chunks.push(chunk);
          });
          response.on('error', (error) => {
            finish(result('UNKNOWN', startedAt, clock().toISOString(), {
              errorCode: error.message === 'response_too_large' ? 'PROVIDER_RESPONSE_TOO_LARGE' : 'PROVIDER_RESPONSE_INTERRUPTED',
              requestMayHaveBeenSent: true,
            }));
          });
          response.on('end', () => {
            if (settled) return;
            const status = response.statusCode ?? 0;
            if (status === 429 || status >= 500) {
              finish(result('FAILED_RETRYABLE', startedAt, clock().toISOString(), {
                errorCode: status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_RETRYABLE_RESPONSE',
                requestMayHaveBeenSent: true,
              }));
              return;
            }
            if (status < 200 || status >= 300) {
              finish(result('FAILED_TERMINAL', startedAt, clock().toISOString(), {
                errorCode: 'PROVIDER_REJECTED_REQUEST',
                requestMayHaveBeenSent: true,
              }));
              return;
            }
            let payload;
            try {
              const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
              payload = JSON.parse(text);
            } catch {
              finish(result('UNKNOWN', startedAt, clock().toISOString(), {
                errorCode: 'PROVIDER_RESPONSE_INVALID',
                requestMayHaveBeenSent: true,
              }));
              return;
            }
            const content = payload?.choices?.[0]?.message?.content;
            const finishReason = payload?.choices?.[0]?.finish_reason;
            const inputTokens = payload?.usage?.prompt_tokens;
            const outputTokens = payload?.usage?.completion_tokens;
            const totalTokens = payload?.usage?.total_tokens;
            if (
              typeof content !== 'string' || content.trim().length < 1
              || typeof finishReason !== 'string' || finishReason.length < 1
              || !Number.isSafeInteger(inputTokens) || inputTokens < 0
              || !Number.isSafeInteger(outputTokens) || outputTokens < 0
              || !Number.isSafeInteger(totalTokens) || totalTokens !== inputTokens + outputTokens
            ) {
              finish(result('UNKNOWN', startedAt, clock().toISOString(), {
                errorCode: 'PROVIDER_RESULT_NOT_RECOVERABLE',
                requestMayHaveBeenSent: true,
              }));
              return;
            }
            if ([...content].length > capabilityRequest.input.maximumOutputCharacters) {
              finish(result('FAILED_TERMINAL', startedAt, clock().toISOString(), {
                errorCode: 'PROVIDER_OUTPUT_TOO_LONG',
                requestMayHaveBeenSent: true,
              }));
              return;
            }
            finish(result('SUCCEEDED', startedAt, clock().toISOString(), {
              output: { responseCandidate: content, finishReason },
              usage: { inputTokens, outputTokens, totalTokens },
              requestMayHaveBeenSent: true,
            }));
          });
        });
        request.on('error', (error) => {
          const afterSend = requestSent || responseStarted;
          finish(result(afterSend ? 'UNKNOWN' : 'FAILED_RETRYABLE', startedAt, clock().toISOString(), {
            errorCode: error.message === 'connect_timeout'
              ? 'PROVIDER_CONNECT_TIMEOUT'
              : error.message === 'response_timeout'
                ? 'PROVIDER_RESPONSE_TIMEOUT'
                : 'PROVIDER_CONNECTION_FAILED',
            requestMayHaveBeenSent: afterSend,
          }));
        });
        request.write(body);
        request.end();
      });
    },
  });
}
