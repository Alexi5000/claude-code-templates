import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, symlinkSync, linkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readManifest, writeOutput } from '../scripts/og-output.mjs';

test('OG worker honors a custom output root and its manifest cache', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'og-worker-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = fileURLToPath(new URL('../scripts/generate-og-images.mjs', import.meta.url));
  const args = [script, '--only', 'agents/development-team/frontend-developer', '--out', root];
  assert.match(execFileSync(process.execPath, args, { encoding: 'utf8' }), /1 rendered, 0 unchanged/);
  const png = readFileSync(join(root, 'agents/development-team/frontend-developer.png'));
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.match(execFileSync(process.execPath, args, { encoding: 'utf8' }), /0 rendered, 1 unchanged/);
});

test('OG outputs preserve binary images and replace regular manifests', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'og-output-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(readManifest(root), {});
  writeOutput(root, '.manifest.json', JSON.stringify({ one: 'hash' }));
  assert.deepEqual(readManifest(root), { one: 'hash' });
  writeOutput(root, '.manifest.json', '{}');
  assert.deepEqual(readManifest(root), {});
  const png = Buffer.from([137, 80, 78, 71, 0, 255]);
  writeOutput(root, 'agents/example.png', png);
  assert.deepEqual(readFileSync(join(root, 'agents/example.png')), png);
  assert.throws(() => writeOutput(root, '../outside.png', png));
});

test('OG manifest and image writes refuse symlinks and hardlinks', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'og-links-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const protectedFile = join(root, 'protected');
  writeFileSync(protectedFile, '{"secret":"untouched"}');
  for (const link of [symlinkSync, linkSync]) {
    for (const name of ['.manifest.json', 'image.png']) {
      const target = join(root, name);
      link(protectedFile, target);
      assert.throws(() => writeOutput(root, name, 'overwrite'));
      if (name === '.manifest.json') assert.throws(() => readManifest(root));
      assert.equal(readFileSync(protectedFile, 'utf8'), '{"secret":"untouched"}');
      rmSync(target);
    }
  }
  const outside = join(root, 'outside');
  mkdirSync(outside);
  symlinkSync(outside, join(root, 'agents'));
  assert.throws(() => writeOutput(root, 'agents/new.png', 'overwrite'));
});
