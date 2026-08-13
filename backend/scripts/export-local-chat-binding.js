import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  EXPECTED_BINDING_FIXTURE_HASH,
  fixedSubjectBindingFixture,
} from '../src/modules/continuity-integration/first-round-contract.js';
import { calculateBindingFixtureHash } from '../src/modules/continuity-integration/first-round-hashing.js';
import { validateFixedSubjectBindingFixture } from '../src/modules/continuity-integration/first-round-validator.js';
import {
  normalizeScriptArguments,
  writeJson,
} from './live-chat-script-support.js';

function outputPath(argv) {
  const normalized = normalizeScriptArguments(argv);
  const index = normalized.indexOf('--output');
  if (index === -1 || !normalized[index + 1] || normalized.length !== 2) {
    throw new Error('Usage: pnpm run export:local-chat-binding -- --output <absolute-runtime-path>');
  }
  if (!isAbsolute(normalized[index + 1])) {
    throw new Error('Binding output must use an absolute path outside the repository.');
  }
  return resolve(normalized[index + 1]);
}

const target = outputPath(process.argv.slice(2));
const backendRoot = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(backendRoot, '..');
const relativeToRepository = relative(repositoryRoot, target);
if (
  relativeToRepository === ''
  || (!relativeToRepository.startsWith('..') && !isAbsolute(relativeToRepository))
) {
  throw new Error('Binding output must be in a user-selected runtime directory outside the repository.');
}

const fixture = fixedSubjectBindingFixture();
const bindingFixtureHash = calculateBindingFixtureHash(fixture);
validateFixedSubjectBindingFixture(fixture, bindingFixtureHash);
if (bindingFixtureHash !== EXPECTED_BINDING_FIXTURE_HASH) {
  throw new Error('The formal SubjectBinding fixture hash does not match the fixed contract.');
}

let action = 'created';
if (existsSync(target)) {
  let existing;
  try { existing = JSON.parse(readFileSync(target, 'utf8')); } catch {
    throw new Error('Existing Binding file is not valid UTF-8 JSON and will not be overwritten.');
  }
  if (!isDeepStrictEqual(existing, fixture)) {
    throw new Error('Existing Binding file differs from the formal fixture and will not be overwritten.');
  }
  action = 'reused';
} else {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(fixture, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

writeJson({
  status: 'configured',
  action,
  outputPath: target,
  bindingFixtureHash,
  fixture,
  externalCall: 'not_performed',
});
