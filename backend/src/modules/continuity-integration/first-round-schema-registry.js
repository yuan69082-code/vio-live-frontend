import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import { ValidationError } from '../../core/errors.js';
import {
  FACT_SCHEMA_ID,
  OBSERVATION_SCHEMA_ID,
  REQUEST_SCHEMA_ID,
  SCHEMA_IDS,
} from './first-round-contract.js';
import { canonicalizeJson } from './first-round-hashing.js';

const DRAFT_2020_12 = 'https://json-schema.org/draft/2020-12/schema';
const schemaFiles = Object.freeze({
  [REQUEST_SCHEMA_ID]: 'continuity-interaction-request.first-round-v1.schema.json',
  [OBSERVATION_SCHEMA_ID]:
    'platform-observation.message-created.first-round-v1.schema.json',
  [FACT_SCHEMA_ID]: 'platform-fact.message-version.first-round-v1.schema.json',
});

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function strictUtcDateTime(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const parts = [yearText, monthText, dayText, hourText, minuteText, secondText]
    .map(Number);
  const [year, month, day, hour, minute, second] = parts;
  const date = new Date(0);
  date.setUTCHours(hour, minute, second, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    && date.getUTCHours() === hour
    && date.getUTCMinutes() === minute
    && date.getUTCSeconds() === second;
}

function fail(path, message) {
  throw new ValidationError(`Schema validation failed at ${path}: ${message}`, { path });
}

function validateNode(schema, value, path, registry) {
  if (schema.$ref !== undefined) {
    if (typeof schema.$ref !== 'string' || !registry.has(schema.$ref)) {
      throw new ValidationError(
        `Schema reference cannot be resolved locally: ${String(schema.$ref)}`,
      );
    }
    validateNode(registry.get(schema.$ref), value, path, registry);
    return;
  }

  if (Object.hasOwn(schema, 'const') && !isDeepStrictEqual(value, schema.const)) {
    fail(path, `must equal ${JSON.stringify(schema.const)}`);
  }

  if (schema.type === 'object') {
    if (!isPlainObject(value)) fail(path, 'must be an object');
    const properties = schema.properties ?? {};
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) fail(path, `must contain ${required}`);
    }
    if (schema.additionalProperties === false) {
      const unknown = Object.keys(value).filter((key) => !Object.hasOwn(properties, key));
      if (unknown.length > 0) fail(path, `contains unknown field ${unknown[0]}`);
    }
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) {
        validateNode(properties[key], item, `${path}.${key}`, registry);
      }
    }
    return;
  }

  if (schema.type === 'array') {
    if (!Array.isArray(value)) fail(path, 'must be an array');
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      fail(path, `must contain at least ${schema.minItems} item(s)`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      fail(path, `must contain at most ${schema.maxItems} item(s)`);
    }
    if (schema.uniqueItems) {
      const canonicalItems = value.map((item) => canonicalizeJson(item).toString('utf8'));
      if (new Set(canonicalItems).size !== canonicalItems.length) {
        fail(path, 'must contain unique items');
      }
    }
    value.forEach((item, index) => {
      validateNode(schema.items ?? {}, item, `${path}[${index}]`, registry);
    });
    return;
  }

  if (schema.type === 'string') {
    if (typeof value !== 'string') fail(path, 'must be a string');
    if (schema.minLength !== undefined && [...value].length < schema.minLength) {
      fail(path, `must contain at least ${schema.minLength} character(s)`);
    }
    if (schema.maxLength !== undefined && [...value].length > schema.maxLength) {
      fail(path, `must contain at most ${schema.maxLength} character(s)`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) {
      fail(path, 'does not match the required pattern');
    }
    if (schema.format === 'date-time' && !strictUtcDateTime(value)) {
      fail(path, 'must be a valid RFC 3339 UTC date-time ending in Z');
    }
    return;
  }

  if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value)) fail(path, 'must be a safe integer');
    if (schema.minimum !== undefined && value < schema.minimum) {
      fail(path, `must be at least ${schema.minimum}`);
    }
  }
}

function collectReferences(value, output = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectReferences(item, output));
  } else if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (key === '$ref') output.push(item);
      collectReferences(item, output);
    }
  }
  return output;
}

function assertStrictObjects(value, path = '$') {
  if (!isPlainObject(value)) return;
  if (value.type === 'object' && value.additionalProperties !== false) {
    throw new ValidationError(`Contract schema object is not strict at ${path}.`);
  }
  for (const [key, item] of Object.entries(value)) {
    if (Array.isArray(item)) {
      item.forEach((nested, index) => assertStrictObjects(nested, `${path}.${key}[${index}]`));
    } else {
      assertStrictObjects(item, `${path}.${key}`);
    }
  }
}

export function createFirstRoundSchemaRegistry() {
  const schemas = new Map();
  for (const schemaId of SCHEMA_IDS) {
    const filename = schemaFiles[schemaId];
    const location = new URL(`./schemas/${filename}`, import.meta.url);
    const schema = JSON.parse(readFileSync(location, 'utf8'));
    if (schema.$schema !== DRAFT_2020_12 || schema.$id !== schemaId) {
      throw new ValidationError(`Local schema ${filename} has an invalid identity.`);
    }
    assertStrictObjects(schema);
    schemas.set(schemaId, schema);
  }

  if (schemas.size !== 3 || new Set(schemas.keys()).size !== 3) {
    throw new ValidationError('First-round registry must contain exactly three schemas.');
  }
  const references = collectReferences(schemas.get(REQUEST_SCHEMA_ID));
  if (
    references.length !== 2
    || new Set(references).size !== 2
    || !references.includes(OBSERVATION_SCHEMA_ID)
    || !references.includes(FACT_SCHEMA_ID)
  ) {
    throw new ValidationError('Request schema must contain the two fixed local references.');
  }

  return Object.freeze({
    schemaIds: Object.freeze([...schemas.keys()]),
    getSchema(schemaId) {
      if (!schemas.has(schemaId)) {
        throw new ValidationError(`Schema identifier is not registered locally: ${schemaId}`);
      }
      return structuredClone(schemas.get(schemaId));
    },
    validate(schemaId, value) {
      if (!schemas.has(schemaId)) {
        throw new ValidationError(`Schema identifier is not registered locally: ${schemaId}`);
      }
      validateNode(schemas.get(schemaId), value, '$', schemas);
    },
    validateInline(schema, value) {
      validateNode(schema, value, '$', schemas);
    },
  });
}

export const FIRST_ROUND_SCHEMA_REGISTRY = createFirstRoundSchemaRegistry();
