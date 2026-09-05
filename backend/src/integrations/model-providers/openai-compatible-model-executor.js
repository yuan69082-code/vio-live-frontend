import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { TextDecoder } from 'node:util';

import { ValidationError } from '../../core/errors.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]']);
const CHAT_MESSAGE_ROLES = new Set(['system', 'user', 'assistant']);
const MAX_CHAT_MESSAGES = 128;
// The legacy Capability adapter combines several individually bounded E5-A
// input fields into one Provider message. Their valid aggregate can exceed a
// single Vio Message's 32,768-character boundary, so this transport ceiling
// must cover that existing contract while request bytes remain independently
// bounded below.
const MAX_CHAT_MESSAGE_CHARACTERS = 65_536;
const MAX_OUTPUT_CHARACTERS = 16_384;
const MAX_OUTPUT_TOKENS = 16_384;
const MAX_FINISH_REASON_CHARACTERS = 128;

const deniedIpv4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]) {
  deniedIpv4.addSubnet(address, prefix, 'ipv4');
}

const globalIpv6 = new BlockList();
globalIpv6.addSubnet('2000::', 3, 'ipv6');
const deniedIpv6 = new BlockList();
for (const [address, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
]) {
  deniedIpv6.addSubnet(address, prefix, 'ipv6');
}

function requirePositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError(`${field} must be a positive safe integer.`);
  }
  return value;
}

function requirePlainObject(value, field) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new ValidationError(`${field} must be a plain object.`);
  }
  return value;
}

function requireOnlyFields(value, field, allowedFields, requiredFields = allowedFields) {
  const input = requirePlainObject(value, field);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const unknownFields = Reflect.ownKeys(input)
    .filter((name) => (
      typeof name !== 'string'
      || !allowedFields.includes(name)
      || descriptors[name]?.enumerable !== true
      || !Object.hasOwn(descriptors[name], 'value')
    ))
    .map(String);
  const missingFields = requiredFields.filter((name) => !Object.hasOwn(input, name));
  if (unknownFields.length > 0 || missingFields.length > 0) {
    throw new ValidationError(`${field} has invalid fields.`, {
      field,
      unknownFields,
      missingFields,
    });
  }
  return input;
}

function requireStrictUtcDateTime(value, field) {
  if (typeof value !== 'string' || value.length > 64) {
    throw new ValidationError(`${field} must be an RFC 3339 UTC timestamp.`);
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(value);
  if (!match) {
    throw new ValidationError(`${field} must be an RFC 3339 UTC timestamp.`);
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1
    || month > 12
    || day < 1
    || day > days[month - 1]
    || Number(hourText) > 23
    || Number(minuteText) > 59
    || Number(secondText) > 59
    || Number.isNaN(Date.parse(value))
  ) {
    throw new ValidationError(`${field} must be an RFC 3339 UTC timestamp.`);
  }
  return value;
}

function requireChatMessages(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_CHAT_MESSAGES) {
    throw new ValidationError(`messages must contain between 1 and ${MAX_CHAT_MESSAGES} items.`);
  }
  const allowedKeys = new Set(['length', ...Array.from({ length: value.length }, (_, index) => String(index))]);
  if (Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !allowedKeys.has(key))) {
    throw new ValidationError('messages must not contain non-item properties.', { field: 'messages' });
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new ValidationError('messages must not be sparse.', { field: `messages[${index}]` });
    }
  }
  return Object.freeze(value.map((message, index) => {
    const item = requireOnlyFields(message, `messages[${index}]`, ['role', 'content']);
    if (typeof item.role !== 'string' || !CHAT_MESSAGE_ROLES.has(item.role)) {
      throw new ValidationError(`messages[${index}].role is not supported.`, {
        field: `messages[${index}].role`,
        allowedValues: [...CHAT_MESSAGE_ROLES],
      });
    }
    if (
      typeof item.content !== 'string'
      || [...item.content].length < 1
      || [...item.content].length > MAX_CHAT_MESSAGE_CHARACTERS
    ) {
      throw new ValidationError(
        `messages[${index}].content must contain between 1 and ${MAX_CHAT_MESSAGE_CHARACTERS} characters.`,
        { field: `messages[${index}].content` },
      );
    }
    return Object.freeze({ role: item.role, content: item.content });
  }));
}

function requireChatExecution(value) {
  const input = requireOnlyFields(
    value,
    'chat execution',
    [
      'provider', 'model', 'apiKey', 'messages', 'deadlineAt',
      'maxOutputCharacters', 'maxOutputTokens', 'cancelled', 'onRequestStart',
    ],
    ['provider', 'model', 'apiKey', 'messages', 'deadlineAt', 'maxOutputCharacters'],
  );
  const provider = requirePlainObject(input.provider, 'provider');
  const model = requirePlainObject(input.model, 'model');
  if (typeof provider.baseUrl !== 'string' || typeof provider.interfaceFormat !== 'string') {
    throw new ValidationError('provider must contain baseUrl and interfaceFormat.');
  }
  if (typeof model.modelName !== 'string' || model.modelName.length < 1 || model.modelName.length > 160) {
    throw new ValidationError('model.modelName must contain between 1 and 160 characters.');
  }
  if (input.cancelled !== undefined && typeof input.cancelled !== 'boolean') {
    throw new ValidationError('cancelled must be a boolean.');
  }
  if (input.onRequestStart !== undefined && typeof input.onRequestStart !== 'function') {
    throw new ValidationError('onRequestStart must be a function.');
  }
  const maxOutputCharacters = requirePositiveInteger(
    input.maxOutputCharacters,
    'maxOutputCharacters',
  );
  if (maxOutputCharacters > MAX_OUTPUT_CHARACTERS) {
    throw new ValidationError(`maxOutputCharacters must not exceed ${MAX_OUTPUT_CHARACTERS}.`);
  }
  const maxOutputTokens = input.maxOutputTokens === undefined
    ? null
    : requirePositiveInteger(input.maxOutputTokens, 'maxOutputTokens');
  if (maxOutputTokens !== null && maxOutputTokens > MAX_OUTPUT_TOKENS) {
    throw new ValidationError(`maxOutputTokens must not exceed ${MAX_OUTPUT_TOKENS}.`);
  }
  return Object.freeze({
    provider,
    model,
    apiKey: input.apiKey,
    messages: requireChatMessages(input.messages),
    deadlineAt: requireStrictUtcDateTime(input.deadlineAt, 'deadlineAt'),
    maxOutputCharacters,
    maxOutputTokens,
    cancelled: input.cancelled ?? false,
    onRequestStart: input.onRequestStart ?? null,
  });
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

function unbracketHostname(hostname) {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

function isSafePublicAddress(entry) {
  if (
    entry === null
    || typeof entry !== 'object'
    || typeof entry.address !== 'string'
    || ![4, 6].includes(entry.family)
    || isIP(entry.address) !== entry.family
  ) {
    return false;
  }
  if (entry.family === 4) return !deniedIpv4.check(entry.address, 'ipv4');
  return globalIpv6.check(entry.address, 'ipv6')
    && !deniedIpv6.check(entry.address, 'ipv6');
}

function resolutionFailure(status, errorCode) {
  return Object.freeze({ ok: false, status, errorCode });
}

async function resolveEndpointAddress({
  endpoint,
  allowLoopbackHttp,
  resolveAddresses,
  timeoutMs,
}) {
  const hostname = unbracketHostname(endpoint.hostname);
  const literalFamily = isIP(hostname);
  const testLoopback = allowLoopbackHttp
    && endpoint.protocol === 'http:'
    && LOOPBACK_HOSTS.has(endpoint.hostname);

  if (testLoopback) {
    return Object.freeze({
      ok: true,
      address: hostname,
      family: literalFamily,
    });
  }

  let addresses;
  try {
    if (literalFamily !== 0) {
      addresses = [{ address: hostname, family: literalFamily }];
    } else {
      let timeout;
      try {
        addresses = await Promise.race([
          resolveAddresses(hostname, { all: true, verbatim: true }),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('dns_timeout')), timeoutMs);
            timeout.unref?.();
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
    }
  } catch {
    return resolutionFailure('FAILED_RETRYABLE', 'PROVIDER_DNS_UNAVAILABLE');
  }

  if (!Array.isArray(addresses) || addresses.length === 0) {
    return resolutionFailure('FAILED_RETRYABLE', 'PROVIDER_DNS_UNAVAILABLE');
  }
  if (addresses.some((entry) => !isSafePublicAddress(entry))) {
    return resolutionFailure('FAILED_TERMINAL', 'PROVIDER_TARGET_UNSAFE');
  }

  const selected = addresses.find((entry) => entry.family === 4);
  if (!selected) {
    return resolutionFailure(
      'FAILED_TERMINAL',
      'PROVIDER_ADDRESS_FAMILY_UNSUPPORTED',
    );
  }
  return Object.freeze({ ok: true, address: selected.address, family: selected.family });
}

function pinnedLookup(address, family) {
  return (_hostname, options, callback) => {
    const normalizedOptions = typeof options === 'object' && options !== null
      ? options
      : {};
    const done = typeof options === 'function' ? options : callback;
    if (normalizedOptions.all) {
      done(null, [{ address, family }]);
      return;
    }
    done(null, address, family);
  };
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
  resolveAddresses = lookup,
  requestHttp = httpRequest,
  requestHttps = httpsRequest,
} = {}) {
  requirePositiveInteger(connectTimeoutMs, 'connectTimeoutMs');
  requirePositiveInteger(responseTimeoutMs, 'responseTimeoutMs');
  requirePositiveInteger(maxResponseBytes, 'maxResponseBytes');
  requirePositiveInteger(maxRequestBytes, 'maxRequestBytes');
  if (typeof resolveAddresses !== 'function') {
    throw new ValidationError('resolveAddresses must be a function.');
  }
  if (typeof requestHttp !== 'function' || typeof requestHttps !== 'function') {
    throw new ValidationError('Provider request dependencies must be functions.');
  }

  async function executeChatCore(value, deadlineErrorCode) {
      const {
        provider,
        model,
        apiKey,
        messages,
        deadlineAt,
        maxOutputCharacters,
        maxOutputTokens,
        cancelled,
        onRequestStart,
      } = requireChatExecution(value);
      const startedAt = clock().toISOString();
      if (cancelled) return result('CANCELLED', startedAt, startedAt, { errorCode: 'USER_CANCELLED' });
      if (Date.parse(deadlineAt) <= Date.parse(startedAt)) {
        return result('EXPIRED', startedAt, startedAt, { errorCode: deadlineErrorCode });
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
        messages,
        ...(maxOutputTokens === null ? {} : { max_tokens: maxOutputTokens }),
      }), 'utf8');
      if (body.length > maxRequestBytes) {
        return result('FAILED_TERMINAL', startedAt, clock().toISOString(), { errorCode: 'PROVIDER_REQUEST_TOO_LARGE' });
      }

      const resolved = await resolveEndpointAddress({
        endpoint,
        allowLoopbackHttp,
        resolveAddresses,
        timeoutMs: connectTimeoutMs,
      });
      if (!resolved.ok) {
        return result(resolved.status, startedAt, clock().toISOString(), {
          errorCode: resolved.errorCode,
          requestMayHaveBeenSent: false,
        });
      }

      return new Promise((resolve) => {
        let settled = false;
        let requestSent = false;
        let responseStarted = false;
        let boundaryCrossed = false;
        let connectTimer;
        let responseTimer;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(connectTimer);
          clearTimeout(responseTimer);
          resolve(value);
        };
        const requestFn = endpoint.protocol === 'https:' ? requestHttps : requestHttp;
        let request;
        try {
          onRequestStart?.();
          boundaryCrossed = onRequestStart !== null;
          request = requestFn({
          protocol: endpoint.protocol,
          hostname: endpoint.hostname,
          port: endpoint.port,
          path: endpoint.pathname,
          method: 'POST',
          agent: false,
          lookup: pinnedLookup(resolved.address, resolved.family),
          headers: {
            authorization: `Bearer ${apiKey}`,
            accept: 'application/json',
            'content-type': 'application/json; charset=utf-8',
            'content-length': String(body.length),
            connection: 'close',
          },
          });
        } catch {
          request?.destroy();
          finish(result(boundaryCrossed ? 'UNKNOWN' : 'FAILED_RETRYABLE', startedAt, clock().toISOString(), {
            errorCode: boundaryCrossed
              ? 'PROVIDER_REQUEST_INTERRUPTED'
              : 'PROVIDER_REQUEST_NOT_SENT',
            requestMayHaveBeenSent: boundaryCrossed,
          }));
          return;
        }
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
              || typeof finishReason !== 'string'
              || [...finishReason].length < 1
              || [...finishReason].length > MAX_FINISH_REASON_CHARACTERS
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
            if ([...content].length > maxOutputCharacters) {
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
          const afterSend = boundaryCrossed || requestSent || responseStarted;
          finish(result(afterSend ? 'UNKNOWN' : 'FAILED_RETRYABLE', startedAt, clock().toISOString(), {
            errorCode: error.message === 'connect_timeout'
              ? 'PROVIDER_CONNECT_TIMEOUT'
              : error.message === 'response_timeout'
                ? 'PROVIDER_RESPONSE_TIMEOUT'
                : 'PROVIDER_CONNECTION_FAILED',
            requestMayHaveBeenSent: afterSend,
          }));
        });
        try {
          request.write(body);
          request.end();
        } catch {
          const afterSend = boundaryCrossed || requestSent || responseStarted;
          request.destroy();
          finish(result(afterSend ? 'UNKNOWN' : 'FAILED_RETRYABLE', startedAt, clock().toISOString(), {
            errorCode: afterSend
              ? 'PROVIDER_REQUEST_INTERRUPTED'
              : 'PROVIDER_REQUEST_NOT_SENT',
            requestMayHaveBeenSent: afterSend,
          }));
        }
      });
  }

  async function executeChat(value) {
    return executeChatCore(value, 'MODEL_DEADLINE_EXPIRED');
  }

  return Object.freeze({
    executeChat,
    async execute({ provider, model, apiKey, capabilityRequest, cancelled = false }) {
      return executeChatCore({
        provider,
        model,
        apiKey,
        messages: [{
          role: 'user',
          content: [
            capabilityRequest.input.instruction,
            capabilityRequest.input.messageContent,
            capabilityRequest.input.perceptionSummary,
            capabilityRequest.input.currentFocus,
          ].filter(Boolean).join('\n\n'),
        }],
        deadlineAt: capabilityRequest.deadlineAt,
        maxOutputCharacters: capabilityRequest.input.maximumOutputCharacters,
        cancelled,
      }, 'CAPABILITY_DEADLINE_EXPIRED');
    },
  });
}
