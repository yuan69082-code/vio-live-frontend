import { isDeepStrictEqual } from 'node:util';

import { ValidationError } from '../../core/errors.js';
import {
  EXPECTED_BINDING_FIXTURE_HASH,
  REQUEST_SCHEMA_ID,
  fixedSubjectBindingFixture,
} from './first-round-contract.js';
import {
  calculateBindingFixtureHash,
  calculateContentHash,
  calculateRequestHash,
  verifyDeclaredHash,
} from './first-round-hashing.js';
import { FIRST_ROUND_SCHEMA_REGISTRY } from './first-round-schema-registry.js';

const forbiddenStateWriteFields = new Set([
  'mutation',
  'statemutation',
  'impactscope',
  'fieldpath',
  'operation',
  'beforestate',
  'afterstate',
  'statepatch',
  'statesnapshot',
  'subjectstate',
  'subjectstateoverride',
  'subjectstatepatch',
  'subjectstatesnapshot',
]);

function normalizedFieldName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function rejectStateWriteFields(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectStateWriteFields(item, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (forbiddenStateWriteFields.has(normalizedFieldName(key))) {
      throw new ValidationError(`State-write field is forbidden at ${path}.${key}.`, {
        field: `${path}.${key}`,
      });
    }
    rejectStateWriteFields(item, `${path}.${key}`);
  }
}

function requireEqual(name, actual, expected) {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new ValidationError(`${name} does not match.`, { field: name });
  }
}

export function validateFirstRoundRequest(
  payload,
  schemaRegistry = FIRST_ROUND_SCHEMA_REGISTRY,
) {
  rejectStateWriteFields(payload);
  schemaRegistry.validate(REQUEST_SCHEMA_ID, payload);

  const observation = payload.observations[0];
  const factPackage = payload.platformFactPackage;
  const fact = factPackage.facts[0];
  requireEqual('Observation identity', observation.identity, payload.identity);
  requireEqual('fact identity', fact.identity, payload.identity);
  requireEqual('Observation messageVersionRef', observation.messageVersionRef, payload.conversation);
  requireEqual('fact conversation reference', {
    conversationId: fact.conversationId,
    messageId: fact.messageId,
    messageVersionId: fact.messageVersionId,
  }, payload.conversation);
  requireEqual('observationRefs', factPackage.observationRefs, [observation.observationId]);

  verifyDeclaredHash({
    declared: fact.contentHash,
    calculated: calculateContentHash(fact.content),
    fieldName: 'contentHash',
  });
  verifyDeclaredHash({
    declared: payload.requestHash,
    calculated: calculateRequestHash(payload),
    fieldName: 'requestHash',
  });
  return structuredClone(payload);
}

export function validateFixedSubjectBindingFixture(
  payload,
  bindingFixtureHash = EXPECTED_BINDING_FIXTURE_HASH,
) {
  rejectStateWriteFields(payload);
  const expected = fixedSubjectBindingFixture();
  if (!isDeepStrictEqual(payload, expected)) {
    throw new ValidationError(
      'SubjectBinding fixture does not match the fixed first-round fixture.',
    );
  }
  verifyDeclaredHash({
    declared: bindingFixtureHash,
    calculated: calculateBindingFixtureHash(payload),
    fieldName: 'bindingFixtureHash',
  });
  return structuredClone(payload);
}
