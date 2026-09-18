# Dependency Patch + Audit CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate known-vulnerable dependency floors (`axios ^1.6.2`, `express ^4.18.2`, `chokidar ^3`), align the three-way version drift across `root` / `api/` / `dashboard/` (`supabase-js`, `neon/serverless`, `clerk/backend`, `discord-interactions`), and add a blocking `npm audit` CI workflow.

**Architecture:** Edit the three `package.json` files directly to exact target ranges, reinstall, verify with `npm ls` plus the repos' existing test suites; then add one new GitHub Actions workflow that audits all four installable units (`root`, `cli-tool`, `dashboard`, `api`) on push, PR, and weekly schedule.

**Tech Stack:** npm, GitHub Actions (`actions/checkout@v4`, `actions/setup-node@v6`, Node 22), jest (existing suites as regression signal).

## Global Constraints

- Dashboard builds with Node 22; `discord-interactions` v4 requires Node >= 18.4.
- Stay on Express 4 (upgrade floor to `^4.21.2`, NOT v5 — v5 changes routing/error behavior and is a separate migration).
- Stay on `chalk ^4` / `inquirer ^8` / `ora ^5` (last CommonJS releases; the CLI is CJS and ESM migration is out of scope).
- `discord-interactions` 3→4 makes `verifyKey` async — every caller must `await` it (dashboard already fixed in Plan 1; legacy `api/` checked in Task 3 below).
- Commit style: `fix:`, `feat:`, `chore:` prefixes. Never commit lockfile secrets (none exist).

---

### Task 1: Patch root package.json (axios) + cli-tool floors (express, chokidar)

**Files:**
- Modify: `package.json:23,30` (root)
- Modify: `cli-tool/package.json:69,71` (chokidar, express)

**Interfaces:**
- Consumes: nothing.
- Produces: new installed versions recorded in `package-lock.json` (root) — Task 2/3 build on a green `npm ls`.

- [ ] **Step 1: Record the pre-change baseline**

Run:

```bash
npm ls axios express chokidar
```

Expected: prints the current tree (`axios@1.6.x`, `express@4.18.x`, `chokidar@3.5.x`) — copy the output into the commit message body or keep it in the terminal for Step 4 comparison.

- [ ] **Step 2: Apply the version edits**

In root `package.json`, change line 23. Old:

```json
    "axios": "^1.6.2",
```

New:

```json
    "axios": "^1.7.4",
```

(`1.7.4` is the floor containing the CVE-2024-39341 SSRF fix; caret allows the latest 1.x at install time.)

In `cli-tool/package.json`, change lines 69 and 71. Old:

```json
    "chokidar": "^3.5.3",
    "commander": "^11.1.0",
    "express": "^4.18.2",
```

New:

```json
    "chokidar": "^4.0.0",
    "commander": "^11.1.0",
    "express": "^4.21.2",
```

- [ ] **Step 3: Reinstall and verify the floors**

Run:

```bash
npm install --package-lock-only
```

Expected: `package-lock.json` updated, `npm ls axios` shows `axios@1.7.4` or higher (1.x), `npm --prefix cli-tool ls chokidar` shows `4.x`, `npm --prefix cli-tool ls express` shows `4.21.2+`.

Then run the CLI regression suite:

```bash
npm --prefix cli-tool test -- --silent
```

Expected: jest exits 0 (existing thresholds `global 70%`, `analytics/core 80%` still met — no source changed, only transitive versions).

- [ ] **Step 4: Smoke-test chokidar v4 behavior**

Run:

```bash
node -e "const chokidar = require('chokidar'); const w = chokidar.watch('cli-tool/package.json'); w.on('ready', () => { console.log('chokidar ready'); w.close(); });"
```

Expected output: `chokidar ready` (v4 keeps the v3 watch API used by the CLI; a hang or throw here blocks the commit — do not proceed).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json cli-tool/package.json
git commit -m "fix: raise axios, express, chokidar to patched floors"
```

Note: `cli-tool/package-lock.json` — if it exists in the repo, `git add` it too; if `git status` does not list it as modified, skip it (do not force-add ignored files).

---

### Task 2: Align api/ dependency majors with dashboard/

**Files:**
- Modify: `api/package.json:13-18`

**Interfaces:**
- Consumes: Task 1 (green baseline).
- Produces: `api/` on `@supabase/supabase-js ^2.100.1`, `@neondatabase/serverless ^1.0.2`, `@clerk/backend ^3.0.1`, `discord-interactions ^4.4.0`, `axios ^1.7.4`.

- [ ] **Step 1: Apply the version edits**

Old (`api/package.json` lines 12-19):

```json
  "dependencies": {
    "@vercel/postgres": "^0.10.0",
    "@supabase/supabase-js": "^2.45.0",
    "@neondatabase/serverless": "^0.10.1",
    "@clerk/backend": "^1.0.0",
    "axios": "^1.6.2",
    "discord-interactions": "^3.4.0"
  },
```

New:

```json
  "dependencies": {
    "@vercel/postgres": "^0.10.0",
    "@supabase/supabase-js": "^2.100.1",
    "@neondatabase/serverless": "^1.0.2",
    "@clerk/backend": "^3.0.1",
    "axios": "^1.7.4",
    "discord-interactions": "^4.4.0"
  },
```

(`@vercel/postgres` stays — legacy `api/` still targets Vercel functions until Plan 4 deprecates it. The four aligned versions are copied verbatim from `dashboard/package.json` lines 16-24.)

- [ ] **Step 2: Reinstall and run the api unit suite**

Run:

```bash
npm --prefix api install
```

Expected: installs cleanly. Then run:

```bash
npm --prefix api test
```

Expected: jest exits 0. (`api/__tests__/endpoints.test.js` hits `https://aitmpl.com` live — network-dependent failures here are pre-existing and owned by Plan 3 Task 4; what must NOT appear are import/constructor errors like `verifyKey is not a function` or `neon is not a function`. If the only failures are HTTP timeouts/status mismatches, proceed and note them in the commit body.)

- [ ] **Step 3: Commit**

```bash
git add api/package.json
git commit -m "fix: align api deps with dashboard majors (supabase, neon, clerk, discord-interactions)"
```

Note: same lockfile rule as Task 1 — `git add api/package-lock.json` only if git reports it modified.

---

### Task 3: Audit legacy discord verifyKey call for the v4 async break

**Files:**
- Read: `api/discord/interactions.js` (inspect only)
- Modify (only if needed): `api/discord/interactions.js` verifyKey call site

**Interfaces:**
- Consumes: Task 2 (`discord-interactions@4` installed in `api/`).
- Produces: an `await`ed `verifyKey` call, or a written confirmation that the file already awaits.

- [ ] **Step 1: Find the verifyKey call**

Run:

```bash
node -e "const fs=require('fs');const s=fs.readFileSync('api/discord/interactions.js','utf8');s.split('\n').forEach((l,i)=>{if(l.includes('verifyKey'))console.log((i+1)+': '+l.trim())})"
```

Expected: prints each line containing `verifyKey` with its line number, e.g. `116: const isValid = verifyKey(...)`.

- [ ] **Step 2: Classify the call**

If the printed line contains `await verifyKey(` — no code change needed. Skip to Step 4 and state `already-awaited` in the commit message.

If it reads `verifyKey(` without `await` — this is the same signature-bypass bug Plan 1 fixed on the dashboard (a Promise is always truthy, so the 401 branch is dead). Proceed to Step 3.

- [ ] **Step 3 (only when Step 2 found a missing await): Write the failing characterization first**

There is no unit harness around this file, so the "failing test" is a live negative check. Start the legacy function locally if possible, else verify by code inspection against the v4 type (`Promise<boolean>` per `discord-interactions` v4.0.0 release notes) and apply the minimal fix: add `await` and make the enclosing handler `async`. Concrete edit pattern (adjust identifiers to the exact line printed in Step 1):

Old pattern:

```js
const isValidRequest = verifyKey(rawBody, signature, timestamp, publicKey);
if (!isValidRequest) {
```

New pattern:

```js
const isValidRequest = await verifyKey(rawBody, signature, timestamp, publicKey);
if (!isValidRequest) {
```

And if the enclosing function is declared as `(req, res) => {` or `function handler(...) {`, change it to `async (req, res) => {` / `async function handler(...) {`. Rerun the Step 1 command to confirm the `await` is present, then rerun `npm --prefix api test` for the import-level regression signal.

- [ ] **Step 4: Commit**

```bash
git add api/discord/interactions.js
git commit -m "fix: await async verifyKey in legacy discord interactions (v4 break)"
```

If Step 2 found the call already awaited, commit an empty-state note instead — do NOT create an empty commit; just record the finding in the Plan 4 deprecation task and move on (no commit for this task).

---

### Task 4: Add blocking npm audit CI for all four installable units

**Files:**
- Create: `.github/workflows/security-audit.yml`

**Interfaces:**
- Consumes: Tasks 1-2 (post-bump lockfiles are what gets audited).
- Produces: CI signal `audit` — fails the run on any `high` or `critical` advisory in `root`, `cli-tool`, `dashboard`, or `api`.

- [ ] **Step 1: Write the workflow (no failing-test step — this IS the test)**

Create `.github/workflows/security-audit.yml` with this exact content (style modeled on the existing `.github/workflows/deploy.yml`: `actions/checkout@v4`, `actions/setup-node@v6`, Node 22):

```yaml
name: Dependency Security Audit

on:
  push:
    branches: [main]
    paths:
      - 'package.json'
      - 'package-lock.json'
      - 'cli-tool/package.json'
      - 'dashboard/package.json'
      - 'api/package.json'
  pull_request:
    paths:
      - 'package.json'
      - 'package-lock.json'
      - 'cli-tool/package.json'
      - 'dashboard/package.json'
      - 'api/package.json'
  schedule:
    - cron: '0 6 * * 1'

permissions:
  contents: read

jobs:
  audit:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        include:
          - unit: root
            dir: .
          - unit: cli-tool
            dir: cli-tool
          - unit: dashboard
            dir: dashboard
          - unit: api
            dir: api
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v6
        with:
          node-version: 22
      - name: Audit ${{ matrix.unit }}
        run: npm audit --audit-level=high
        working-directory: ${{ matrix.dir }}
```

- [ ] **Step 2: Validate the YAML locally**

Run:

```bash
node -e "const y=require('js-yaml');const fs=require('fs');const d=y.load(fs.readFileSync('.github/workflows/security-audit.yml','utf8'));console.log('on:',Object.keys(d.on||d['on']||{}).join(','));console.log('jobs:',Object.keys(d.jobs).join(','));console.log('dirs:',d.jobs.audit.strategy.matrix.include.map(r=>r.unit+':'+r.dir).join(','))"
```

Expected output:

```
on: push,pull_request,schedule
jobs: audit
dirs: root:.,cli-tool:cli-tool,dashboard:dashboard,api:api
```

(`js-yaml` is a root dependency, so `require('js-yaml')` resolves from the repo root. If it prints anything else, fix the YAML before committing.)

- [ ] **Step 3: Dry-run the exact audit commands locally**

Run:

```bash
npm audit --audit-level=high --prefix cli-tool; npm audit --audit-level=high --prefix dashboard; npm audit --audit-level=high --prefix api
```

Expected: exit 0 for all three (post-Tasks-1-2 floors). If any unit reports `high`/`critical`, fix by bumping that package within its compatible range and amend Tasks 1-2 first — do NOT commit a workflow that fails on main. Root has no lockfile-auditable install beyond `package-lock.json`; the `root` matrix leg runs `npm audit` at repo root.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/security-audit.yml
git commit -m "feat: add weekly + per-PR npm audit CI for all installable units"
```

---

## Deferred (explicitly out of scope)

- Express 5 migration, `chalk`/`inquirer`/`ora` ESM migration, `commander`/`fs-extra`/`js-yaml`/`uuid`/`ws`/`boxen` bumps — pinned intentionally or no CVE driver; revisit when the audit workflow flags them.
- `jest 29 → 30` alignment in `api/` — owned by Plan 3, Task 5 (test behavior change, not a CVE fix).
- Removing the legacy `api/` directory entirely — owned by Plan 4 (deprecation + parity check first).
