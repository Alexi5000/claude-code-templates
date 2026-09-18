# Real Test Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the root `"test": "echo 'No tests specified'"` stub with a real workspace runner, give `test:e2e` an actual test, add dashboard unit tests with teeth, stop the api suite from writing rows to the production database, and align the jest major versions.

**Architecture:** No new frameworks except the dashboard's vitest (added by Plan 1; fallback setup included below so this plan stands alone). CLI keeps jest 30; `api/` moves jest 29→30; live api tests are gated behind `ALLOW_LIVE_WRITES=true` while pure validation tests always run. Every task ends with a suite that exits 0.

**Tech Stack:** jest 30 (`cli-tool`, `api`), vitest 3 (`dashboard`), `node:child_process` spawnSync for the CLI smoke test, axios (existing api tests).

## Global Constraints

- Root `package.json` version `1.28.16`, `cli-tool/package.json` version `1.28.13` — do NOT bump versions in this plan (owned by Plan 5).
- `cli-tool/jest.config.js` thresholds (`global 70%`, `./src/analytics/core/ 80%`) must keep passing — do not lower them.
- `api/__tests__/endpoints.test.js` currently defaults to `https://aitmpl.com` — after this plan nothing writes to production unless the operator opts in explicitly.
- Dashboard builds with Node 22.
- Commit style: `fix:`, `feat:`, `chore:` prefixes.

---

### Task 1: Root test script runs the real suites

**Files:**
- Modify: `package.json:10-19` (root scripts)

**Interfaces:**
- Consumes: `cli-tool` jest suite, `api` jest suite (both pre-existing).
- Produces: `npm test` (root) = cli-tool unit+integration+validation suites, then the api suite. Dashboard stays separate (`npm --prefix dashboard test`) because vitest is a different runner.

- [ ] **Step 1: Show the current stub failing its purpose**

Run: `npm test`

Expected: prints `No tests specified` and exits 0 — this is the bug (CI-green while testing nothing).

- [ ] **Step 2: Replace the stub with workspace runners**

Old (root `package.json` lines 10-19):

```json
  "scripts": {
    "dev": "vercel dev",
    "build": "echo 'Build complete'",
    "start": "vercel dev",
    "test": "echo 'No tests specified'",
```

New:

```json
  "scripts": {
    "dev": "vercel dev",
    "build": "echo 'Build complete'",
    "start": "vercel dev",
    "test": "npm --prefix cli-tool test -- --silent && npm --prefix api test -- --silent",
    "test:cli-tool": "npm --prefix cli-tool test",
    "test:api": "npm --prefix api test",
    "test:dashboard": "npm --prefix dashboard test",
```

- [ ] **Step 3: Run the new root suite**

Run: `npm test`

Expected: cli-tool jest output followed by api jest output, final exit 0. (If the api leg fails on live-HTTP timeouts, that is pre-existing and fixed by Task 4 of this plan — complete Task 4 before committing Task 1's change, or commit Task 1 with the api leg noted. Recommended order: do Task 4 first, then return here.)

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "fix: root npm test runs cli-tool and api suites instead of stub"
```

---

### Task 2: Give test:e2e a real CLI smoke test

**Files:**
- Create: `cli-tool/tests/e2e/cli-smoke.test.js`
- Modify: none (`cli-tool/package.json:23` `"test:e2e": "jest tests/e2e"` already points here — today it fails with `No tests found`)

**Interfaces:**
- Consumes: `cli-tool/bin/create-claude-config.js` (existing binary, invoked with `--help`).
- Produces: a passing e2e leg; `npm --prefix cli-tool run test:e2e` exits 0.

- [ ] **Step 1: Prove the leg is broken today**

Run: `npm --prefix cli-tool run test:e2e`

Expected: FAIL with `No tests found, exiting with code 1` / `testPathPattern: tests/e2e - 0 matches`.

- [ ] **Step 2: Write the smoke test**

Create `cli-tool/tests/e2e/cli-smoke.test.js` with this exact content:

```js
/**
 * CLI smoke test: the published binary must start and print help.
 * Run: npm run test:e2e (from cli-tool/)
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'create-claude-config.js');

function runCli(...args) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 60000,
  });
}

describe('CLI smoke', () => {
  test('--help exits 0 and names the tool', () => {
    const result = runCli('--help');
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/claude-code-templates/i);
  });

  test('--version exits 0 and prints a semver', () => {
    const result = runCli('--version');
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
  });
});
```

- [ ] **Step 3: Run it (expect a possible first-run failure)**

Run: `npm --prefix cli-tool run test:e2e`

Expected: PASS with 2 tests — unless the binary's help text does not contain its own name or `--version` is unsupported, in which case jest shows the received stdout. If that happens, adjust ONLY the two matchers to the actual help output (paste the real first line into the regex), rerun, and note the adjustment in the commit body. Do not change the binary.

- [ ] **Step 4: Run the full cli-tool suite to prove nothing else broke**

Run: `npm --prefix cli-tool test -- --silent`

Expected: exit 0, all suites pass including `tests/e2e/cli-smoke.test.js`.

- [ ] **Step 5: Commit**

```bash
git add cli-tool/tests/e2e/cli-smoke.test.js
git commit -m "feat: add CLI --help/--version smoke test backing test:e2e"
```

---

### Task 3: Dashboard unit tests for the changelog parser + CI test gate

**Files:**
- Create: `dashboard/src/lib/api/changelog-parser.test.ts`
- Modify: `.github/workflows/deploy.yml` (insert test step before Build)

**Interfaces:**
- Consumes: exported `parseVersionChangelog`, `generateSummary`, `formatForDiscord` from `dashboard/src/lib/api/changelog-parser.ts` (lines 31, 115, 129 — pure, no env needed); vitest runner from Plan 1.
- Produces: 8 passing dashboard tests; `deploy.yml` fails the deploy before building when tests fail.

Prerequisite check (run first): `node -e "console.log(require('./dashboard/package.json').scripts.test || 'MISSING')"`. If it prints `MISSING`, Plan 1 is not merged — apply its Task 1 Step 1 first (add `"test": "vitest run"` to `dashboard/package.json` scripts and run `npm --prefix dashboard install -D vitest@^3`), then continue here.

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/lib/api/changelog-parser.test.ts` with this exact content:

```ts
import { describe, it, expect } from 'vitest';
import { formatForDiscord, generateSummary, parseVersionChangelog } from './changelog-parser';

const SAMPLE = `# Changelog

## 1.2.3

### Features

- Add new login flow
- Fix crash on startup

## 1.2.2

- Old change
`;

describe('parseVersionChangelog', () => {
  it('extracts the requested version section', () => {
    const parsed = parseVersionChangelog(SAMPLE, '1.2.3');
    expect(parsed.version).toBe('1.2.3');
    expect(parsed.content).toContain('Add new login flow');
    expect(parsed.changeCount).toBe(2);
  });

  it('classifies feature vs fix and keeps the ### category', () => {
    const parsed = parseVersionChangelog(SAMPLE, '1.2.3');
    const byDescription = Object.fromEntries(parsed.changes.map((c) => [c.description, c]));
    expect(byDescription['Add new login flow'].type).toBe('feature');
    expect(byDescription['Fix crash on startup'].type).toBe('fix');
    expect(byDescription['Add new login flow'].category).toBe('Features');
  });

  it('stops at the next version boundary', () => {
    const parsed = parseVersionChangelog(SAMPLE, '1.2.3');
    expect(parsed.content).not.toContain('Old change');
  });

  it('returns an error shape for unknown versions', () => {
    const parsed = parseVersionChangelog(SAMPLE, '9.9.9');
    expect(parsed.content).toBeNull();
    expect(parsed.changes).toEqual([]);
    expect(parsed.error).toBe('Version not found in changelog');
  });
});

describe('generateSummary', () => {
  it('counts by type and highlights breaking + feature', () => {
    const summary = generateSummary([
      { type: 'feature', description: 'Add x', category: 'CLI', raw: '- Add x' },
      { type: 'fix', description: 'Fix y', category: 'CLI', raw: '- Fix y' },
      { type: 'breaking', description: 'Breaking z', category: null, raw: '- Breaking z' },
    ]);
    expect(summary.total).toBe(3);
    expect(summary.byType).toEqual({ feature: 1, fix: 1, breaking: 1 });
    expect(summary.byCategory).toEqual({ CLI: 2 });
    expect(summary.highlights.map((h) => h.description)).toEqual(['Add x', 'Breaking z']);
  });
});

describe('formatForDiscord', () => {
  it('groups descriptions with bullet prefixes', () => {
    const formatted = formatForDiscord([
      { type: 'feature', description: 'Add x', category: null, raw: '- Add x' },
      { type: 'fix', description: 'Fix y', category: null, raw: '- Fix y' },
    ]);
    expect(formatted.features).toContain('• Add x');
    expect(formatted.fixes).toContain('• Fix y');
    expect(formatted.breaking).toBe('');
  });

  it('truncates long groups with a read-more marker', () => {
    const formatted = formatForDiscord(
      [{ type: 'feature', description: 'A'.repeat(200), category: null, raw: '- big' }],
      40,
    );
    expect(formatted.features.length).toBeLessThanOrEqual(60);
    expect(formatted.features).toContain('... [Read more in changelog]');
  });

  it('buckets performance into improvements', () => {
    const formatted = formatForDiscord([
      { type: 'performance', description: 'Faster cache', category: null, raw: '- Faster cache' },
    ]);
    expect(formatted.improvements).toContain('Faster cache');
  });
});
```

(Behavioral notes, verified against `changelog-parser.ts`: `classifyChange` maps `add…`→`feature`, `fix…`→`fix`; `### Features` becomes `currentCategory`; `truncate` appends `\n... [Read more in changelog]` only when over `maxLength`; `performance`→`improvements` bucket per the switch on lines 132-140.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix dashboard test -- src/lib/api/changelog-parser.test.ts`

Expected: FAIL with `Error: Cannot find module './changelog-parser'` ONLY if the import path is wrong — otherwise it may pass on first run (pure characterization test). Either outcome is actionable: if it passes immediately, skip to Step 4 (no implementation needed — the value is the locked-in regression net). If it fails on an assertion, the parser — not the test — is suspect: re-read the cited parser lines before touching anything.

- [ ] **Step 3: (Only if Step 2 failed on an assertion) Fix the test to match verified parser behavior**

Do not change `changelog-parser.ts` in this task. Correct the expectation using the exact code path cited in the failure, rerun until green.

- [ ] **Step 4: Gate the Cloudflare deploy on dashboard tests**

In `.github/workflows/deploy.yml`, insert a test step between Install and Build (lines 25-29). Old:

```yaml
      - name: Install dependencies
        run: npm install
        working-directory: dashboard
      - name: Build
```

New:

```yaml
      - name: Install dependencies
        run: npm install
        working-directory: dashboard
      - name: Test
        run: npm test
        working-directory: dashboard
      - name: Build
```

- [ ] **Step 5: Run the full dashboard suite + validate the workflow YAML**

Run: `npm --prefix dashboard test`

Expected: all test files pass (cron-auth, rate-limit, cors from Plan 1 + changelog-parser here).

Run:

```bash
node -e "const y=require('js-yaml');const d=y.load(require('fs').readFileSync('.github/workflows/deploy.yml','utf8'));console.log(d.jobs.deploy.steps.map(s=>s.name||'unnamed').join(' > '))"
```

Expected: `unnamed > unnamed > Install dependencies > Test > Build > Deploy www + app.aitmpl.com` (checkout/setup-node steps are unnamed; what matters is `Test` appears before `Build`).

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/lib/api/changelog-parser.test.ts .github/workflows/deploy.yml
git commit -m "feat: dashboard parser unit tests and deploy test gate"
```

---

### Task 4: Stop api tests from writing to production

**Files:**
- Modify: `api/__tests__/endpoints.test.js:12-16` (BASE_URL default), `:16` (describe wrapper for the write test)

**Interfaces:**
- Consumes: existing axios tests (read-only validation tests keep running always).
- Produces: writes run only with `ALLOW_LIVE_WRITES=true`; default target is local `http://localhost:4321` (Astro dev) instead of `https://aitmpl.com`.

- [ ] **Step 1: Write the change as a test-configuration test**

No new test file — the "failing test" is demonstrated by running the suite and observing it POST `test-agent` rows to production. Run:

```bash
node -e "const fs=require('fs');const s=fs.readFileSync('api/__tests__/endpoints.test.js','utf8');console.log('BASE_URL default:',/process\.env\.API_BASE_URL \|\| '([^']+)'/.exec(s)[1]);console.log('write-gate present:',s.includes('ALLOW_LIVE_WRITES'))"
```

Expected: `BASE_URL default: https://aitmpl.com` and `write-gate present: false` — the problem statement, confirmed.

- [ ] **Step 2: Gate writes and repoint the default**

Edit 1 — lines 12-13. Old:

```js
// Configuration
const BASE_URL = process.env.API_BASE_URL || 'https://aitmpl.com';
```

New:

```js
// Configuration
// Writes (POSTs that create rows) only run with ALLOW_LIVE_WRITES=true.
// Default target is local Astro dev so an unset env can never hit production.
const BASE_URL = process.env.API_BASE_URL || 'http://localhost:4321';
const LIVE = process.env.ALLOW_LIVE_WRITES === 'true' ? describe : describe.skip;
```

Edit 2 — line 16. Old:

```js
describe('API Endpoints - Critical Tests', () => {
```

New: (no change — keep the outer describe always running).

Edit 3 — the download-tracking write block, line 18. Old:

```js
  describe('🔴 CRITICAL: Component Download Tracking', () => {
```

New:

```js
  LIVE('🔴 CRITICAL: Component Download Tracking (writes — needs ALLOW_LIVE_WRITES=true)', () => {
```

Then find every other `describe(` in the file whose body performs a POST with valid tracking data (creating rows) and prefix it with `LIVE(` the same way; leave all `400`-expectation tests (invalid payloads — rejected before any insert) under plain `describe(` so validation coverage always runs. List the blocks you converted in the commit body.

- [ ] **Step 3: Run the suite gated (default) and prove zero writes**

Run: `npm --prefix api test`

Expected: write blocks report `skipped`, validation tests run. Confirm with:

```bash
npm --prefix api test -- --verbose 2>&1 | grep -ci "skipped"
```

Expected: a nonzero count (at least 1 skipped suite). No POST with valid data leaves the machine in this mode.

- [ ] **Step 4: Commit**

```bash
git add api/__tests__/endpoints.test.js
git commit -m "fix: api tests skip live writes unless ALLOW_LIVE_WRITES=true, default to localhost"
```

Document in the commit body which describe blocks were converted to `LIVE(` and which stayed always-on.

---

### Task 5: Align api/ jest 29 → 30 with cli-tool

**Files:**
- Modify: `api/package.json:21-23` (devDependencies)

**Interfaces:**
- Consumes: Task 4 (suite is safe to run repeatedly now).
- Produces: `api/` on `jest ^30.0.4` (same major as `cli-tool/package.json:101`), `@types/jest ^30`.

- [ ] **Step 1: Apply the bump**

Old (`api/package.json` lines 20-24):

```json
  "devDependencies": {
    "jest": "^29.7.0",
    "@types/jest": "^29.5.11"
  }
```

New:

```json
  "devDependencies": {
    "jest": "^30.0.4",
    "@types/jest": "^30.0.0"
  }
```

- [ ] **Step 2: Reinstall and run (expect possible breakage — that is the test)**

Run:

```bash
npm --prefix api install && npm --prefix api test -- --silent
```

Expected: exit 0 with all non-skipped tests passing. Known jest 30 deltas that could bite: `testTimeout`/`maxWorkers` semantics (unchanged for this config), snapshot format (this suite uses no snapshots), `jest.config.cjs` `testMatch` (still supported). If a failure names a removed/renamed jest API, fix the config line it names (only that line), rerun.

- [ ] **Step 3: Commit**

```bash
git add api/package.json
git commit -m "chore: align api jest to v30 with cli-tool"
```

Same lockfile rule as Plan 2: add `api/package-lock.json` only if git reports it modified.

---

## Deferred (explicitly out of scope)

- Extending `cli-tool/jest.config.js collectCoverageFrom` to `src/index.js` / `file-operations.js` — that 3,247-line monolith has near-zero coverage and would trip the 70% gate; splitting it is a project of its own (see review follow-up, not this plan).
- E2E against a deployed preview URL — needs a preview environment + seed data; the `ALLOW_LIVE_WRITES` gate is the safety prerequisite and is done here.
- Mocked-DB unit tests for the Supabase/Neon handlers — needs a supabase-js + neon mock harness; the write-gate here is the safety prerequisite and is done first.
- Dashboard coverage thresholds (`--coverage` gate in `vitest`) — add once the suite grows beyond lib helpers.
