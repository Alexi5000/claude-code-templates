# API Dedup + Deploy Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze the legacy `api/` directory with a checked-in parity manifest and CI guard, remove the superseded Vercel cron config, document the real database surface, and eliminate the root/cli-tool version drift.

**Architecture:** Docs-plus-guards, no runtime changes: `api/PARITY.md` declares `dashboard/src/pages/api/` canonical; `scripts/sync-api.sh` is rewritten from a copy-script into a freeze-enforcer; a new `api-parity.yml` workflow runs it; `dashboard/vercel.json` loses only its dead crons; `DATABASE.md` is generated from verified code reads; `scripts/check-versions.sh` red-greens the version drift.

**Tech Stack:** Bash (CI runs ubuntu-latest; Windows steps use the `node -e` equivalent shown), GitHub Actions, JSON, Markdown.

## Global Constraints

- `dashboard/src/pages/api/` is canonical. No new endpoints in legacy `api/`.
- The Cloudflare worker `cloudflare-workers/crons/index.js` is the live scheduler (its header comment says "Replaces Vercel cron jobs"; it sends `Authorization: Bearer ${TRIGGER_SECRET}`).
- After Plan 1, headerless cron GETs return 401 — any surviving headerless scheduler is noise, not function.
- Do not delete `api/` files or `docs/api/` copies in this plan (deletion needs the traffic evidence gathered after the parity guard ships).
- Commit style: `fix:`, `feat:`, `chore:` prefixes.

---

### Task 1: Parity manifest + freeze-enforcer + CI guard

**Files:**
- Create: `api/PARITY.md`
- Modify: `scripts/sync-api.sh` (full rewrite, same path)
- Create: `.github/workflows/api-parity.yml`

**Interfaces:**
- Consumes: nothing.
- Produces: `api/PARITY.md` (human manifest), `scripts/sync-api.sh` exit 0/1 freeze check, `api-parity` CI signal.

- [ ] **Step 1: Enumerate both endpoint trees (the failing baseline)**

Run:

```bash
ls api/*.js api/discord/*.js dashboard/src/pages/api/*.ts dashboard/src/pages/api/discord/*.ts dashboard/src/pages/api/collections/*.ts dashboard/src/pages/api/github/*.ts
```

Expected: all paths print. Confirm these eight mirrored pairs exist (legacy → canonical):

1. `api/track-download-supabase.js` → `dashboard/src/pages/api/track-download-supabase.ts`
2. `api/track-command-usage.js` → `dashboard/src/pages/api/track-command-usage.ts`
3. `api/track-installation-outcome.js` → `dashboard/src/pages/api/track-installation-outcome.ts`
4. `api/track-website-events.js` → `dashboard/src/pages/api/track-website-events.ts`
5. `api/claude-code-check.js` → `dashboard/src/pages/api/claude-code-check.ts`
6. `api/health-check.js` → `dashboard/src/pages/api/health-check.ts`
7. `api/collections.js` → `dashboard/src/pages/api/collections/index.ts`
8. `api/discord/interactions.js` → `dashboard/src/pages/api/discord/interactions.ts`

If any pair is missing a side, record it in the manifest table as `DIVERGED` instead of `mirrored`.

- [ ] **Step 2: Write the manifest**

Create `api/PARITY.md` with this exact content (adjust a row to `DIVERGED` only if Step 1 proved a side missing):

```markdown
# API Parity Manifest

`dashboard/src/pages/api/` is canonical. Legacy `api/` is FROZEN.

Rules:

1. New endpoints are implemented ONLY in `dashboard/src/pages/api/`.
2. Bug fixes go to the dashboard copy; mirror to `api/` only if the legacy
   deployment is still serving traffic (check hosting dashboard first).
3. `scripts/sync-api.sh` fails CI when a NEW `*.js` endpoint appears under
   `api/` without a manifest row. Add the row only with reviewer approval.

## Mirrored endpoints

| Legacy (`api/`) | Canonical (`dashboard/src/pages/api/`) | Status |
|---|---|---|
| `api/track-download-supabase.js` | `dashboard/src/pages/api/track-download-supabase.ts` | mirrored |
| `api/track-command-usage.js` | `dashboard/src/pages/api/track-command-usage.ts` | mirrored |
| `api/track-installation-outcome.js` | `dashboard/src/pages/api/track-installation-outcome.ts` | mirrored |
| `api/track-website-events.js` | `dashboard/src/pages/api/track-website-events.ts` | mirrored |
| `api/claude-code-check.js` | `dashboard/src/pages/api/claude-code-check.ts` | mirrored |
| `api/health-check.js` | `dashboard/src/pages/api/health-check.ts` | mirrored |
| `api/collections.js` | `dashboard/src/pages/api/collections/index.ts` | mirrored |
| `api/discord/interactions.js` | `dashboard/src/pages/api/discord/interactions.ts` | mirrored |

## Non-endpoint support files (not mirrored, not endpoints)

- `api/_lib/auth.js`, `api/_lib/neon.js` — legacy shared helpers.
- `api/_parser-claude.js` — legacy parser.
- `api/collections/[id].js`, `api/collections/items.js` — legacy sub-routes.
- `api/claude-code-monitor/` — monitor scripts (see `api/claude-code-monitor/README.md`).
```

- [ ] **Step 3: Rewrite sync-api.sh as the freeze-enforcer**

Replace the full content of `scripts/sync-api.sh` with:

```bash
#!/bin/bash
# check-api-parity.sh (kept at scripts/sync-api.sh so existing references hold)
#
# Legacy api/ is FROZEN. Fails when a NEW *.js endpoint appears under api/
# without a manifest row in api/PARITY.md.
#
# Usage: ./scripts/sync-api.sh   (exit 0 = frozen, exit 1 = drift)

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
manifest="$repo_root/api/PARITY.md"

# Backticked api/ paths listed in the manifest table + support-files list.
allowed=$(sed -n 's/^[-*] `\(api\/[^`]*\)`.*/\1/p; s/^| `\(api\/[^`]*\)` |.*/\1/p' "$manifest" | sort -u)

fail=0
while IFS= read -r file; do
  rel="${file#$repo_root/}"
  if ! printf '%s\n' "$allowed" | grep -qxF "$rel"; then
    echo "DRIFT: $rel is a legacy api/ file with no api/PARITY.md row."
    fail=1
  fi
done < <(cd "$repo_root" && ls api/*.js api/discord/*.js api/collections/*.js 2>/dev/null | sort -u)

if [ "$fail" -ne 0 ]; then
  echo ""
  echo "Legacy api/ grew without manifest approval. Implement the endpoint in"
  echo "dashboard/src/pages/api/ instead, or add a PARITY.md row with reviewer sign-off."
  exit 1
fi

echo "api/ parity OK: no unmanifested legacy files."
```

Verify the parser against the manifest before trusting it:

```bash
sed -n 's/^[-*] `\(api\/[^`]*\)`.*/\1/p; s/^| `\(api\/[^`]*\)` |.*/\1/p' api/PARITY.md | sort -u
```

Expected: prints the 8 table paths plus the 6 support-file paths (14 lines). If the count differs, fix the `sed` or the manifest until it matches — the enforcer is only as good as this extraction.

- [ ] **Step 4: Run the enforcer (expect PASS)**

Run: `bash scripts/sync-api.sh`

Expected: `api/ parity OK: no unmanifested legacy files.` and exit 0. If it reports DRIFT on a file that exists (e.g. an `api/collections/items.js` variant the manifest missed), add the exact row to `api/PARITY.md` and rerun — do not weaken the script.

Negative check (prove it bites): `touch api/fake-new-endpoint.js && bash scripts/sync-api.sh; echo "exit=$?"` must print a DRIFT line and `exit=1`; then `rm api/fake-new-endpoint.js` and rerun to green.

- [ ] **Step 5: Add the CI guard**

Create `.github/workflows/api-parity.yml` with this exact content:

```yaml
name: Legacy API Parity

on:
  push:
    branches: [main]
    paths:
      - 'api/**'
      - 'scripts/sync-api.sh'
  pull_request:
    paths:
      - 'api/**'
      - 'scripts/sync-api.sh'

permissions:
  contents: read

jobs:
  parity:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Enforce legacy api/ freeze
        run: bash scripts/sync-api.sh
```

- [ ] **Step 6: Commit**

```bash
git add api/PARITY.md scripts/sync-api.sh .github/workflows/api-parity.yml
git commit -m "feat: freeze legacy api with parity manifest and CI guard"
```

---

### Task 2: Remove superseded Vercel crons from dashboard/vercel.json

**Files:**
- Modify: `dashboard/vercel.json:2-5` (crons block only; all `headers` untouched)

**Interfaces:**
- Consumes: Plan 1 (CRON_SECRET gate — headerless Vercel cron GETs now 401, so keeping them only generates failing-cron noise).
- Produces: `dashboard/vercel.json` with no `crons` key; live schedule unchanged (Cloudflare `aitmpl-crons` worker).

- [ ] **Step 1: Prove the crons are dead weight**

Run:

```bash
node -e "const v=require('./dashboard/vercel.json');console.log('vercel crons:',JSON.stringify(v.crons));console.log('cf worker sends auth:',require('fs').readFileSync('cloudflare-workers/crons/index.js','utf8').includes('Authorization'))"
```

Expected: `vercel crons: [{"path":"/api/claude-code-check",...},{"path":"/api/health-check",...}]` and `cf worker sends auth: true`. The Vercel entries send no `Authorization` header (vercel.json cron syntax has no header support), so post-Plan-1 they 401; the CF worker is the authenticated scheduler.

- [ ] **Step 2: Delete the crons block**

Old (`dashboard/vercel.json` lines 1-6):

```json
{
  "crons": [
    { "path": "/api/claude-code-check", "schedule": "*/30 * * * *" },
    { "path": "/api/health-check", "schedule": "*/15 * * * *" }
  ],
  "headers": [
```

New:

```json
{
  "headers": [
```

- [ ] **Step 3: Validate JSON + confirm headers intact**

Run:

```bash
node -e "const v=require('./dashboard/vercel.json');console.log('crons key present:',Object.hasOwn(v,'crons'));console.log('header rules:',v.headers.length);console.log('has api rule:',v.headers.some(h=>h.source==='/api/(.*)'))"
```

Expected: `crons key present: false`, `header rules: 6`, `has api rule: true`. (The `/api/(.*)` wildcard header stays — code-level scoping from Plan 1 governs behavior; full vercel.json-vs-Pages ownership is a hosting decision, not this task.)

- [ ] **Step 4: Commit**

```bash
git add dashboard/vercel.json
git commit -m "chore: remove superseded Vercel crons (Cloudflare aitmpl-crons is the scheduler)"
```

---

### Task 3: Document the real database surface (DATABASE.md)

**Files:**
- Create: `DATABASE.md` (repo root)

**Interfaces:**
- Consumes: table names verified by direct reads this session (no new code).
- Produces: the first complete map of Supabase vs Neon tables with owning code pointers.

- [ ] **Step 1: Extract every table name mechanically**

Run:

```bash
node -e "const fs=require('fs'),path=require('path');const roots=['dashboard/src','api','database'];const pats=[/FROM\s+([a-z_]+)/g,/INSERT INTO\s+([a-z_]+)/g,/UPDATE\s+([a-z_]+)/g,/CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z_]+)/g];const found=new Set();function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory()){walk(p)}else if(/\.(ts|js|sql)$/.test(p)&&!p.includes('node_modules')&&!p.includes('.test.')){const s=fs.readFileSync(p,'utf8');for(const re of pats){let m;re.lastIndex=0;while((m=re.exec(s))){found.add(m[1])}}}}};roots.forEach(walk);console.log([...found].sort().join('\n'))"
```

Expected: a list including `collection_items`, `command_usage_logs`, `component_downloads`, `claude_code_changes`, `claude_code_versions`, `discord_notifications_log`, `download_stats`, `monitoring_metadata`, `user_collections` (plus any live-task tables — record extras verbatim).

- [ ] **Step 2: Read the two checked-in migrations**

Run: read `database/migrations/001_create_claude_code_versions.sql` and `database/migrations/002_create_command_usage_logs.sql` in full (Read tool, no offset tricks — they are small).

- [ ] **Step 3: Write DATABASE.md**

Create `DATABASE.md` with this exact skeleton, filling the column lists from the Step 2 reads and the owning-file pointers below (all verified by direct reads this session). If Step 1 revealed tables beyond these nine, append one subsection each in the same format:

```markdown
# Database Map

Two databases. No ORM. All access is raw SQL (Neon tagged templates,
Supabase query builder).

## Supabase (analytics)

Configured via `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
(see `dashboard/src/pages/api/track-download-supabase.ts:5-14`).

- `component_downloads` — one row per CLI install event. Written by
  `dashboard/src/pages/api/track-download-supabase.ts:53-66`
  (columns: component_type, component_name, component_path, category,
  user_agent, ip_address, country, cli_version, download_timestamp, created_at).
- `download_stats` — per-component counters, upserted on
  `component_type, component_name`
  (`dashboard/src/pages/api/track-download-supabase.ts:73-87`).

## Neon (app + monitoring)

Client factory: `dashboard/src/lib/api/neon.ts` (`getNeonClient`,
`NEON_DATABASE_URL`). Auth: Clerk (`dashboard/src/lib/api/auth.ts`).

- `claude_code_versions` — NPM versions seen by the monitor
  (`dashboard/src/pages/api/claude-code-check.ts:94-98,148-166`).
- `claude_code_changes` — one row per parsed changelog bullet
  (`dashboard/src/pages/api/claude-code-check.ts:170-184`).
- `discord_notifications_log` — notification receipts; `webhook_url` is
  stored as the literal `'redacted'` (Plan 1)
  (`dashboard/src/pages/api/claude-code-check.ts:191-205`).
- `monitoring_metadata` — singleton row (`id = 1`) with last-check/error
  counters (`dashboard/src/pages/api/claude-code-check.ts:103-107,213-220,243-250`).
- `command_usage_logs` — CLI command invocations
  (`dashboard/src/pages/api/track-command-usage.ts:58-...`; migration:
  `database/migrations/002_create_command_usage_logs.sql`).
- `user_collections` + `collection_items` — Clerk-user collections
  (`dashboard/src/pages/api/collections/index.ts:15-27,65-77`).

## Migrations

Checked in: `database/migrations/001_create_claude_code_versions.sql`,
`database/migrations/002_create_command_usage_logs.sql`.
Tables without a checked-in migration (list them here as found in Step 1)
are applied out-of-band — adding missing migrations is follow-up work.
```

- [ ] **Step 4: Commit**

```bash
git add DATABASE.md
git commit -m "docs: map Supabase and Neon tables to owning code"
```

---

### Task 4: Version-drift guard + align cli-tool to root

**Files:**
- Create: `scripts/check-versions.sh`
- Modify: `package.json` (root — add `version:check` script)
- Modify: `cli-tool/package.json:3` (version bump to root's)

**Interfaces:**
- Consumes: nothing.
- Produces: `scripts/check-versions.sh` (exit 0 iff versions match); both manifests at `1.28.16`.

- [ ] **Step 1: Add the check script reference and watch it fail**

Append to root `package.json` scripts (after line 18 `"discord:register"` line — keep trailing structure). Old:

```json
    "deploy": "./scripts/deploy.sh",
    "deploy:dashboard": "./scripts/deploy.sh",
    "discord:register": "node api/discord/register-commands.cjs"
```

New:

```json
    "deploy": "./scripts/deploy.sh",
    "deploy:dashboard": "./scripts/deploy.sh",
    "discord:register": "node api/discord/register-commands.cjs",
    "version:check": "./scripts/check-versions.sh"
```

Create `scripts/check-versions.sh` with this exact content:

```bash
#!/bin/bash
# check-versions.sh — root and cli-tool versions must match.
# The local package.json drifts from npm when published from CI (see CLAUDE.md).
set -euo pipefail

root=$(node -p "require('./package.json').version")
cli=$(node -p "require('./cli-tool/package.json').version")

if [ "$root" != "$cli" ]; then
  echo "version drift: root=$root cli-tool=$cli"
  exit 1
fi

echo "versions match: $root"
```

Run (Git Bash on Windows, bash on CI):

```bash
bash scripts/check-versions.sh; echo "exit=$?"
```

Expected: `version drift: root=1.28.16 cli-tool=1.28.13` and `exit=1` — the red state, confirmed. Windows-native alternative proving the same: `node -e "console.log(require('./package.json').version, require('./cli-tool/package.json').version)"` prints `1.28.16 1.28.13`.

- [ ] **Step 2: Align cli-tool to root (green)**

In `cli-tool/package.json` line 3. Old:

```json
  "version": "1.28.13",
```

New:

```json
  "version": "1.28.16",
```

Rerun: `bash scripts/check-versions.sh`

Expected: `versions match: 1.28.16` and exit 0.

- [ ] **Step 3: Regression-check the CLI suite (version strings surface in --version)**

Run: `npm --prefix cli-tool test -- --silent`

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/check-versions.sh package.json cli-tool/package.json
git commit -m "fix: align cli-tool version to root and add version-drift guard"
```

---

## Deferred (explicitly out of scope)

- Deleting legacy `api/` files or `docs/api/` copies — needs production-traffic evidence (which deployment serves what) gathered after the freeze guard ships.
- Backfilling missing SQL migrations for the out-of-band tables — schema dumps first, then one migration per table.
- Resolving full Vercel-vs-Cloudflare-Pages hosting ownership (only the provably-dead crons were removed here).
- `components.json` payload and `index.js` monolith splits — owned by Plan 5.
