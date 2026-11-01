#!/usr/bin/env node
// Runs `npm audit --json` in the current directory and fails on any advisory
// (any severity) that is not listed in .github/npm-audit-allowlist.json.
//
// The allowlist is only for advisories with no patched release. Each entry is
// scoped to one GHSA id, one package and explicit audit units, and carries an
// expiry date so it is re-reviewed. Anything else fails exactly like
// `npm audit --audit-level=low`.
//
// Usage: node scripts/npm-audit-gate.mjs --unit <matrix unit name>
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ALLOWLIST_PATH = fileURLToPath(new URL('../.github/npm-audit-allowlist.json', import.meta.url));

export function ghsaId(url) {
  const match = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i.exec(url || '');
  return match ? match[0] : null;
}

export function collectAdvisories(report) {
  if (!report || typeof report !== 'object' || report.error || !report.vulnerabilities) {
    throw new Error(`unexpected npm audit output: ${JSON.stringify(report?.error ?? report).slice(0, 500)}`);
  }
  const advisories = [];
  for (const [pkg, vuln] of Object.entries(report.vulnerabilities)) {
    for (const via of vuln.via || []) {
      if (typeof via !== 'object') continue; // transitive pointer, reported under its own package
      advisories.push({
        package: via.name || pkg,
        id: ghsaId(via.url) || String(via.source),
        severity: via.severity,
        title: via.title,
        url: via.url,
      });
    }
  }
  return advisories;
}

export function evaluate(advisories, allowlist, unit, today = new Date().toISOString().slice(0, 10)) {
  const blocked = [];
  const allowed = [];
  for (const advisory of advisories) {
    const entry = allowlist.find(
      (e) => e.id === advisory.id && e.package === advisory.package && Array.isArray(e.units) && e.units.includes(unit),
    );
    if (entry && entry.expires && entry.expires >= today) allowed.push({ advisory, entry });
    else blocked.push({ advisory, expired: Boolean(entry) });
  }
  return { blocked, allowed };
}

function main() {
  const unitIdx = process.argv.indexOf('--unit');
  const unit = unitIdx > -1 ? process.argv[unitIdx + 1] : null;
  if (!unit) {
    console.error('usage: npm-audit-gate.mjs --unit <name>');
    process.exit(2);
  }
  const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8')).advisories || [];
  const run = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let report;
  try {
    report = JSON.parse(run.stdout);
  } catch {
    console.error(`npm audit did not return JSON (exit ${run.status}):\n${run.stderr}`);
    process.exit(1);
  }
  const { blocked, allowed } = evaluate(collectAdvisories(report), allowlist, unit);
  for (const { advisory, entry } of allowed) {
    console.log(`::warning::allowlisted ${advisory.id} (${advisory.package}, ${advisory.severity}) until ${entry.expires}: ${entry.reason}`);
  }
  for (const { advisory, expired } of blocked) {
    console.log(`::error::${advisory.id} ${advisory.package} (${advisory.severity})${expired ? ' [allowlist entry expired]' : ''}: ${advisory.title} ${advisory.url || ''}`);
  }
  console.log(`${unit}: ${blocked.length} blocking, ${allowed.length} allowlisted advisories`);
  process.exit(blocked.length ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
