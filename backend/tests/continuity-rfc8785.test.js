import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  canonicalizeJson,
  sha256Hash,
} from '../src/modules/continuity-integration/first-round-hashing.js';

const RFC_8785_SECTION_3_CANONICAL = String.raw`{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\u000f\nA'B\"\\\\\"/"}`;
const RFC_8785_SECTION_3_UTF8_HEX =
  '7b226c69746572616c73223a5b6e756c6c2c747275652c66616c73655d2c226e756d62657273223a5b3333333333333333332e333333333333332c31652b33302c342e352c302e3030322c31652d32375d2c22737472696e67223a22e282ac245c75303030665c6e4127425c225c5c5c5c5c222f227d';

const RFC_8785_PROPERTY_SORT_CANONICAL =
  '{"\\r":"Carriage Return","1":"One","":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}';

const NON_ASCII_CANONICAL = '{"emoji":"😀","中文":"汉字"}';
const NON_ASCII_UTF8_HEX =
  '7b22656d6f6a69223a22f09f9880222c22e4b8ade69687223a22e6b189e5ad97227d';
const NON_ASCII_SHA256 =
  'sha256:fba38df1ed1350d83ad0c115a630d0bd7aa20a7804842828b246fe62435e30a6';

function utf8(value) {
  return canonicalizeJson(value).toString('utf8');
}

function numberFromIeee754Hex(hex) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(`0x${hex}`));
  return buffer.readDoubleBE(0);
}

test('RFC 8785 Sections 3.2.2-3.2.4 comprehensive vector matches canonical JSON and UTF-8 bytes', () => {
  const input = {
    numbers: [333333333.33333329, 1E30, 4.50, 2e-3, 1e-27],
    string: `€$\u000f\nA'B"\\\\"/`,
    literals: [null, true, false],
  };

  const canonical = canonicalizeJson(input);
  assert.equal(canonical.toString('utf8'), RFC_8785_SECTION_3_CANONICAL);
  assert.equal(canonical.toString('hex'), RFC_8785_SECTION_3_UTF8_HEX);
});

test('RFC 8785 Appendix B representative IEEE 754 numbers use ECMAScript serialization', () => {
  const samples = [
    ['0000000000000000', '0'],
    ['8000000000000000', '0'],
    ['0000000000000001', '5e-324'],
    ['8000000000000001', '-5e-324'],
    ['7fefffffffffffff', '1.7976931348623157e+308'],
    ['ffefffffffffffff', '-1.7976931348623157e+308'],
    ['4340000000000000', '9007199254740992'],
    ['c340000000000000', '-9007199254740992'],
    ['4430000000000000', '295147905179352830000'],
    ['44b52d02c7e14af5', '9.999999999999997e+22'],
    ['44b52d02c7e14af6', '1e+23'],
    ['44b52d02c7e14af7', '1.0000000000000001e+23'],
    ['444b1ae4d6e2ef4e', '999999999999999700000'],
    ['444b1ae4d6e2ef4f', '999999999999999900000'],
    ['444b1ae4d6e2ef50', '1e+21'],
    ['3eb0c6f7a0b5ed8c', '9.999999999999997e-7'],
    ['3eb0c6f7a0b5ed8d', '0.000001'],
    ['41b3de4355555553', '333333333.3333332'],
    ['41b3de4355555554', '333333333.33333325'],
    ['41b3de4355555555', '333333333.3333333'],
    ['41b3de4355555556', '333333333.3333334'],
    ['41b3de4355555557', '333333333.33333343'],
    ['becbf647612f3696', '-0.0000033333333333333333'],
    ['43143ff3c1cb0959', '1424953923781206.2'],
  ];

  for (const [bits, expected] of samples) {
    assert.equal(utf8(numberFromIeee754Hex(bits)), expected, bits);
  }
  for (const [value, expected] of [
    [0, '0'],
    [-0, '0'],
    [42, '42'],
    [4.50, '4.5'],
    [0.000001, '0.000001'],
    [1e-27, '1e-27'],
    [1e+30, '1e+30'],
    [-1e-27, '-1e-27'],
  ]) {
    assert.equal(utf8(value), expected);
  }
});

test('RFC 8785 rejects NaN and positive or negative Infinity instead of emitting null', () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => canonicalizeJson(value), /numbers must be finite/);
    assert.throws(() => canonicalizeJson([value]), /numbers must be finite/);
  }
});

test('Unicode strings preserve code points and combining sequences while lone surrogates fail', () => {
  const input = {
    quoteAndSlash: '"\\',
    controls: '\b\t\n\f\r\u0000\u001f',
    composed: 'é',
    decomposed: 'e\u0301',
    emoji: '😀',
    chinese: '中文',
  };
  const expected = String.raw`{"chinese":"中文","composed":"é","controls":"\b\t\n\f\r\u0000\u001f","decomposed":"é","emoji":"😀","quoteAndSlash":"\"\\"}`;
  assert.equal(utf8(input), expected);
  assert.notEqual(input.composed, input.decomposed);
  assert.ok(utf8(input).includes('"decomposed":"é"'));

  for (const value of ['\ud800', '\udfff', { '\ud800': 'bad key' }, { value: '\udfff' }]) {
    assert.throws(() => canonicalizeJson(value), /unpaired surrogate/);
  }
});

test('RFC 8785 Section 3.2.3 sorts raw property names by UTF-16 code units at every object level', () => {
  const official = {
    '€': 'Euro Sign',
    '\r': 'Carriage Return',
    'דּ': 'Hebrew Letter Dalet With Dagesh',
    '1': 'One',
    '😀': 'Emoji: Grinning Face',
    '\u0080': 'Control',
    'ö': 'Latin Small Letter O With Diaeresis',
  };
  assert.equal(utf8(official), RFC_8785_PROPERTY_SORT_CANONICAL);

  const nested = {
    z: [{ z: 1, a: 2 }, { b: 3, a: 4 }],
    ab: 3,
    aa: 2,
    a: 1,
    '': 0,
  };
  assert.equal(
    utf8(nested),
    '{"":0,"a":1,"aa":2,"ab":3,"z":[{"a":2,"z":1},{"a":4,"b":3}]}',
  );
  assert.deepEqual(nested.z.map((item) => Object.values(item)), [[1, 2], [3, 4]]);
});

test('mixed nested JSON is insertion-order independent without reordering arrays', () => {
  const first = {
    z: [{ beta: false, alpha: null }, '中文', 1e-7],
    a: { y: ['😀', true, 4.50], x: { b: 2, a: 1 } },
  };
  const second = {
    a: { x: { a: 1, b: 2 }, y: ['😀', true, 4.50] },
    z: [{ alpha: null, beta: false }, '中文', 1e-7],
  };
  const expected =
    '{"a":{"x":{"a":1,"b":2},"y":["😀",true,4.5]},"z":[{"alpha":null,"beta":false},"中文",1e-7]}';
  const firstBytes = canonicalizeJson(first);
  const secondBytes = canonicalizeJson(second);
  assert.equal(firstBytes.toString('utf8'), expected);
  assert.deepEqual(firstBytes, secondBytes);
  assert.equal(sha256Hash(firstBytes), sha256Hash(secondBytes));
});

test('canonical non-ASCII JSON has fixed UTF-8 bytes and SHA-256', () => {
  const canonical = canonicalizeJson({ 中文: '汉字', emoji: '😀' });
  assert.equal(canonical.toString('utf8'), NON_ASCII_CANONICAL);
  assert.equal(canonical.toString('hex'), NON_ASCII_UTF8_HEX);
  assert.equal(sha256Hash(canonical), NON_ASCII_SHA256);
  assert.equal(
    createHash('sha256').update(Buffer.from(NON_ASCII_UTF8_HEX, 'hex')).digest('hex'),
    NON_ASCII_SHA256.slice('sha256:'.length),
  );
});

test('non-JSON JavaScript values are rejected at top level and when nested', () => {
  const invalid = [undefined, 1n, () => {}, Symbol('not-json')];
  for (const value of invalid) {
    assert.throws(() => canonicalizeJson(value), /cannot be canonicalized/);
    assert.throws(() => canonicalizeJson({ value }), /cannot be canonicalized/);
    assert.throws(() => canonicalizeJson([value]), /cannot be canonicalized/);
  }
});

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const engineRoot = resolve(
  process.env.VIO_CONTINUITY_ENGINE_PATH
    ?? join(currentDirectory, '..', '..', '..', 'continuity-engine'),
);
const engineHashingModule = join(
  engineRoot,
  'src',
  'continuity_engine',
  'domain',
  'integration_hashing.py',
);

test('Vio and Engine 189441f produce identical canonical UTF-8 and SHA-256 for independent corpus', {
  skip: existsSync(engineHashingModule)
    ? false
    : `Continuity Engine checkout not found at ${engineRoot}`,
}, () => {
  const corpus = [
    {
      name: 'rfc-section-3',
      value: {
        numbers: [333333333.33333329, 1E30, 4.50, 2e-3, 1e-27],
        string: `€$\u000f\nA'B"\\\\"/`,
        literals: [null, true, false],
      },
    },
    {
      name: 'unicode-properties',
      value: { '€': 1, '😀': 2, 'דּ': 3, '\u0080': 4, 'ö': 5 },
    },
    {
      name: 'chinese-and-emoji',
      value: { 中文: '连续性', emoji: '😀' },
    },
    {
      name: 'mixed-nesting',
      value: { outer: [{ z: null, a: true }, ['中文', false, { b: 2, a: 1 }]] },
    },
    {
      name: 'numbers',
      value: { decimal: 4.50, exponent: 1e+30, negativeExponent: -1e-27, negativeZero: -0 },
    },
  ];
  const transportCorpus = JSON.parse(JSON.stringify(corpus, (_key, value) => (
    typeof value === 'number' && Object.is(value, -0)
      ? { $number: '-0' }
      : value
  )));

  const gitResult = spawnSync('git', [
    '-c',
    `safe.directory=${engineRoot.replaceAll('\\', '/')}`,
    '-C',
    engineRoot,
    'rev-parse',
    'HEAD',
  ], { encoding: 'utf8' });
  assert.equal(gitResult.status, 0, gitResult.stderr);
  assert.equal(
    gitResult.stdout.trim(),
    '189441f9bad2a34119b4ef10365a4385ed0949cc',
  );

  const pythonScript = String.raw`
import hashlib
import json
import sys
from continuity_engine.domain.integration_hashing import canonicalize_json

def restore(value):
    if isinstance(value, dict):
        if value == {"$number": "-0"}:
            return -0.0
        return {key: restore(item) for key, item in value.items()}
    if isinstance(value, list):
        return [restore(item) for item in value]
    return value

corpus = restore(json.loads(sys.stdin.buffer.read().decode("utf-8")))
result = []
for case in corpus:
    canonical = canonicalize_json(case["value"])
    result.append({
        "name": case["name"],
        "canonicalJson": canonical.decode("utf-8"),
        "canonicalHex": canonical.hex(),
        "sha256": "sha256:" + hashlib.sha256(canonical).hexdigest(),
    })
sys.stdout.buffer.write(
    json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
)
`;
  const pythonPath = join(engineRoot, 'src');
  const pythonResult = spawnSync(
    process.env.VIO_ENGINE_PYTHON ?? 'python',
    ['-c', pythonScript],
    {
      input: JSON.stringify(transportCorpus),
      encoding: 'utf8',
      env: {
        ...process.env,
        PYTHONPATH: process.env.PYTHONPATH
          ? `${pythonPath}${delimiter}${process.env.PYTHONPATH}`
          : pythonPath,
      },
      maxBuffer: 1024 * 1024,
    },
  );
  assert.equal(pythonResult.status, 0, pythonResult.stderr);
  const engineResults = JSON.parse(pythonResult.stdout);
  const vioResults = corpus.map(({ name, value }) => {
    const canonical = canonicalizeJson(value);
    return {
      name,
      canonicalJson: canonical.toString('utf8'),
      canonicalHex: canonical.toString('hex'),
      sha256: sha256Hash(canonical),
    };
  });
  assert.deepEqual(vioResults, engineResults);
  const officialResult = engineResults.find(({ name }) => name === 'rfc-section-3');
  assert.equal(officialResult.canonicalJson, RFC_8785_SECTION_3_CANONICAL);
  assert.equal(officialResult.canonicalHex, RFC_8785_SECTION_3_UTF8_HEX);
});
