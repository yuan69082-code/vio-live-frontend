import assert from 'node:assert/strict';

// The formal CLI writes one pretty-printed JSON object via writeJson().
// pnpm may surround it with diagnostics containing inline JSON (including its
// own bundled Node version). Do not mistake those braces for the CLI result.
export function parseCliJsonOutput(output) {
  const lines = output.split(/\r?\n/u);
  const starts = lines.flatMap((line, index) => line.startsWith('{') ? [index] : []);
  const ends = lines.flatMap((line, index) => line === '}' ? [index] : []);
  assert.equal(starts.length, 1, 'Expected exactly one CLI JSON result.');
  assert.equal(ends.length, 1, 'Expected exactly one complete CLI JSON result.');
  assert.equal(lines[starts[0]], '{', 'Expected the formal CLI JSON output format.');
  assert.ok(ends[0] > starts[0], 'CLI JSON result must be complete.');
  return JSON.parse(lines.slice(starts[0], ends[0] + 1).join('\n'));
}
