import assert from 'node:assert/strict';
import test from 'node:test';
import { collectAdvisories, evaluate, ghsaId } from './npm-audit-gate.mjs';

const report = {
  vulnerabilities: {
    deepmerge: {
      via: [{ source: 1, name: 'deepmerge', severity: 'low', title: 't', url: 'https://github.com/advisories/GHSA-gcqx-w48m-w2h4' }],
    },
    'jest-config': { via: ['deepmerge'] },
    glob: {
      via: [{ source: 2, name: 'glob', severity: 'moderate', title: 'g', url: 'https://github.com/advisories/GHSA-3g3m-2fjr-6pw4' }],
    },
  },
};
const allowlist = [{ id: 'GHSA-gcqx-w48m-w2h4', package: 'deepmerge', units: ['cli-tool'], expires: '2027-01-31' }];

test('extracts GHSA ids', () => {
  assert.equal(ghsaId('https://github.com/advisories/GHSA-gcqx-w48m-w2h4'), 'GHSA-gcqx-w48m-w2h4');
  assert.equal(ghsaId(undefined), null);
});

test('collects only advisory objects, not transitive pointers', () => {
  assert.deepEqual(collectAdvisories(report).map((a) => a.id), ['GHSA-gcqx-w48m-w2h4', 'GHSA-3g3m-2fjr-6pw4']);
});

test('allowlisted advisory passes only for listed unit, other advisories block', () => {
  const advisories = collectAdvisories(report);
  const r = evaluate(advisories, allowlist, 'cli-tool', '2026-11-01');
  assert.equal(r.allowed.length, 1);
  assert.deepEqual(r.blocked.map((b) => b.advisory.id), ['GHSA-3g3m-2fjr-6pw4']);
  assert.equal(evaluate(advisories, allowlist, 'dashboard', '2026-11-01').blocked.length, 2);
});

test('expired entries block', () => {
  const r = evaluate(collectAdvisories(report).slice(0, 1), allowlist, 'cli-tool', '2027-02-01');
  assert.equal(r.blocked.length, 1);
  assert.equal(r.blocked[0].expired, true);
});

test('package mismatch blocks', () => {
  const r = evaluate([{ id: 'GHSA-gcqx-w48m-w2h4', package: 'other' }], allowlist, 'cli-tool', '2026-11-01');
  assert.equal(r.blocked.length, 1);
});

test('npm error output is rejected', () => {
  assert.throws(() => collectAdvisories({ error: { code: 'ENOAUDIT' } }));
});
