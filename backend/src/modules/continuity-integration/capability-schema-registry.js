import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import { ValidationError } from '../../core/errors.js';
import { canonicalizeJson } from './first-round-hashing.js';
import {
  CAPABILITY_MODEL_OUTPUT_SCHEMA_ID,
  CAPABILITY_REQUEST_SCHEMA_ID,
  CAPABILITY_RESULT_SCHEMA_ID,
} from './capability-contract.js';

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
const FILES = Object.freeze({
  [CAPABILITY_REQUEST_SCHEMA_ID]: 'capability-request.v1.schema.json',
  [CAPABILITY_RESULT_SCHEMA_ID]: 'capability-result.v1.schema.json',
  [CAPABILITY_MODEL_OUTPUT_SCHEMA_ID]: 'capability-model-output.v1.schema.json',
});

function plainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function utcDateTime(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const [year, month, day, hour, minute, second] = [
    yearText, monthText, dayText, hourText, minuteText, secondText,
  ].map(Number);
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
  throw new ValidationError(`Capability schema validation failed at ${path}: ${message}`, {
    path,
  });
}

function matches(schema, value, path, registry) {
  try {
    validateNode(schema, value, path, registry);
    return true;
  } catch (error) {
    if (error instanceof ValidationError) return false;
    throw error;
  }
}

function validateType(type, value, path) {
  if (type === 'null' && value !== null) fail(path, 'must be null');
  if (type === 'object' && !plainObject(value)) fail(path, 'must be an object');
  if (type === 'array' && !Array.isArray(value)) fail(path, 'must be an array');
  if (type === 'string' && typeof value !== 'string') fail(path, 'must be a string');
  if (type === 'integer' && !Number.isSafeInteger(value)) fail(path, 'must be a safe integer');
  if (type === 'boolean' && typeof value !== 'boolean') fail(path, 'must be a boolean');
}

function validateNode(schema, value, path, registry) {
  if (schema.$ref) {
    const referenced = registry.get(schema.$ref);
    if (!referenced) throw new ValidationError(`Capability schema reference is unknown: ${schema.$ref}`);
    validateNode(referenced, value, path, registry);
    return;
  }
  if (schema.oneOf) {
    const count = schema.oneOf.filter((item) => matches(item, value, path, registry)).length;
    if (count !== 1) fail(path, 'must match exactly one schema');
  }
  if (schema.allOf) schema.allOf.forEach((item) => validateNode(item, value, path, registry));
  if (schema.if) {
    const branch = matches(schema.if, value, path, registry) ? schema.then : schema.else;
    if (branch) validateNode(branch, value, path, registry);
  }
  if (Object.hasOwn(schema, 'const') && !isDeepStrictEqual(value, schema.const)) {
    fail(path, `must equal ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.some((item) => isDeepStrictEqual(item, value))) {
    fail(path, 'must be one of the fixed values');
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => {
      try { validateType(type, value, path); return true; } catch (error) {
        if (error instanceof ValidationError) return false;
        throw error;
      }
    })) fail(path, `must have type ${types.join(' or ')}`);
  }

  if (plainObject(value) && (schema.type === 'object' || schema.properties)) {
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) fail(path, `must contain ${key}`);
    }
    if (schema.additionalProperties === false) {
      const unknown = Object.keys(value).filter((key) => !Object.hasOwn(properties, key));
      if (unknown.length) fail(path, `contains unknown field ${unknown[0]}`);
    }
    for (const [key, item] of Object.entries(value)) {
      if (properties[key]) validateNode(properties[key], item, `${path}.${key}`, registry);
    }
  }
  if (typeof value === 'string') {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength) fail(path, 'is too short');
    if (schema.maxLength !== undefined && length > schema.maxLength) fail(path, 'is too long');
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) fail(path, 'does not match pattern');
    if (schema.format === 'date-time' && !utcDateTime(value)) fail(path, 'must be RFC 3339 UTC Z time');
  }
  if (Number.isSafeInteger(value) && schema.minimum !== undefined && value < schema.minimum) {
    fail(path, `must be at least ${schema.minimum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail(path, 'has too few items');
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(path, 'has too many items');
    if (schema.uniqueItems) {
      const items = value.map((item) => canonicalizeJson(item).toString('utf8'));
      if (new Set(items).size !== items.length) fail(path, 'must contain unique items');
    }
    value.forEach((item, index) => validateNode(schema.items ?? {}, item, `${path}[${index}]`, registry));
  }
}

function assertStrictObjects(schema, path = '$') {
  if (!plainObject(schema)) return;
  if (schema.type === 'object' && schema.additionalProperties !== false) {
    throw new ValidationError(`Capability schema object is not strict at ${path}.`);
  }
  for (const [key, item] of Object.entries(schema)) {
    if (Array.isArray(item)) item.forEach((entry, index) => assertStrictObjects(entry, `${path}.${key}[${index}]`));
    else assertStrictObjects(item, `${path}.${key}`);
  }
}

export function createCapabilitySchemaRegistry() {
  const schemas = new Map();
  for (const [schemaId, filename] of Object.entries(FILES)) {
    const schema = JSON.parse(readFileSync(new URL(`./schemas/${filename}`, import.meta.url), 'utf8'));
    if (schema.$schema !== DRAFT || schema.$id !== schemaId) {
      throw new ValidationError(`Capability schema ${filename} has an invalid identity.`);
    }
    assertStrictObjects(schema);
    schemas.set(schemaId, schema);
  }
  return Object.freeze({
    schemaIds: Object.freeze([...schemas.keys()]),
    getSchema(id) { return structuredClone(schemas.get(id)); },
    validate(id, value) {
      const schema = schemas.get(id);
      if (!schema) throw new ValidationError(`Capability schema is not registered: ${id}`);
      validateNode(schema, value, '$', schemas);
    },
  });
}

export const CAPABILITY_SCHEMA_REGISTRY = createCapabilitySchemaRegistry();
