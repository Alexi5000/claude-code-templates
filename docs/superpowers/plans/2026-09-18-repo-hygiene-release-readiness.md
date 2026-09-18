# Repo Hygiene + Release Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove committed dead files, harden `.gitignore` against generated artifacts, add the missing issue/PR templates, and cut the stale `[Unreleased]` changelog into a dated `1.29.0` release with aligned versions.

**Architecture:** Pure hygiene — deletions, appends, and new markdown only. No source behavior changes; the cli-tool jest suite is the regression signal after deletions. Prerequisite: Plan 4 Task 4 merged (root and cli-tool both at `1.28.16`).

**Tech Stack:** git, Markdown, Keep-a-Changelog format (existing `CHANGELOG.md`).

## Global Constraints

- Prerequisite check first: `bash scripts/check-versions.sh` must print `versions match: 1.28.16`. If Plan 4 is not merged, do it first — the version edits below assume that baseline.
- Delete ONLY the three paths verified in Task 1 Step 1. Anything else that "looks dead" (`test-console-bridge.js`, `api/` copies, `docs/` legacy pages) is explicitly out of scope.
- Never commit `.env`, secrets, or lockfile credentials (none exist).
- Commit style: `fix:`, `feat:`, `chore:` prefixes. `git tag` / `npm publish` are maintainer follow-ups, NOT part of this plan.

---

### Task 1: Delete verified dead files

**Files:**
- Delete (only if present): `cli-tool/src/analytics.log`, `cli-tool/src/analytics-web/index.html.original`, `cli-tool/src/analytics-web/assets/js/main.js.deprecated`

**Interfaces:**
- Consumes: nothing.
- Produces: a tree without committed logs, `.original` backups, or `.deprecated` sources.

- [ ] **Step 1: Verify each path exists before touching it**

Run:

```bash
node -e "const fs=require('fs');['cli-tool/src/analytics.log','cli-tool/src/analytics-web/index.html.original','cli-tool/src/analytics-web/assets/js/main.js.deprecated'].forEach(p=>console.log(fs.existsSync(p)?'PRESENT ':'ABSENT  '+p))"
```

Expected: three `PRESENT` lines (prior exploration found all three: a 0-byte committed log, a 72KB `index.html.original` duplicate, and a 9.5KB `main.js.deprecated`). For every `ABSENT` line, drop that path from the steps below and note it in the commit body — never delete by assumption.

- [ ] **Step 2: Confirm nothing imports the deprecated JS**

Run:

```bash
node -e "const fs=require('fs'),path=require('path');const hits=[];function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(/node_modules|\\.git/.test(p))continue;if(e.isDirectory())walk(p);else if(/\\.(js|html)$/.test(p)){const s=fs.readFileSync(p,'utf8');if(s.includes('main.js.deprecated')||s.includes('index.html.original'))hits.push(p)}}}walk('cli-tool/src');console.log(hits.length?hits.join('\n'):'no references found')"
```

Expected: `no references found`. If a reference prints, STOP this task and re-scope (the file is not dead) — do not delete it.

- [ ] **Step 3: Delete and prove the suite still passes**

Run:

```bash
git rm --cached cli-tool/src/analytics.log 2>$null; rm -f cli-tool/src/analytics.log cli-tool/src/analytics-web/index.html.original cli-tool/src/analytics-web/assets/js/main.js.deprecated
```

(`git rm --cached` first in case the log is already tracked-but-shouldn't-be; `rm -f` covers untracked leftovers. `2>$null`/`-f` keep the command green when a Step-1-ABSENT path was dropped.)

Then run: `npm --prefix cli-tool test -- --silent`

Expected: exit 0 — nothing referenced the deleted files.

- [ ] **Step 4: Commit**

```bash
git add -A cli-tool/src
git commit -m "chore: remove committed dead files (log, .original backup, .deprecated js)"
```

Verify the commit contains only the intended deletions: `git show --stat HEAD` must list at most the three paths.

---

### Task 2: Harden .gitignore (append-only)

**Files:**
- Modify: `.gitignore` (append block at end; existing content untouched)

**Interfaces:**
- Consumes: Task 1 (the log must not come back).
- Produces: ignore rules for logs, generated security reports, coverage output, and wrangler local vars.

- [ ] **Step 1: Demonstrate the gap (failing check)**

Run:

```bash
git check-ignore -v foo.log security-report.json coverage .dev.vars; echo "exit=$?"
```

Expected: `exit=1` and no output — none of these generated artifacts are ignored today (`security-report.json` is written into `cli-tool/` by `npm run security-audit:json` during catalog generation; `coverage/` by every jest run).

- [ ] **Step 2: Append the block**

Append this exact block to the end of `.gitignore`:

```gitignore
# generated / local artifacts (never commit)
*.log
security-report.json
coverage/
.dev.vars
```

- [ ] **Step 3: Prove the rules bite**

Rerun: `git check-ignore -v foo.log security-report.json coverage .dev.vars; echo "exit=$?"`

Expected: four lines each naming `.gitignore` with the matching pattern, and `exit=0`.

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore logs, security reports, coverage, and wrangler local vars"
```

---

### Task 3: Add issue + PR templates

**Files:**
- Create: `.github/ISSUE_TEMPLATE/bug_report.md`
- Create: `.github/ISSUE_TEMPLATE/feature_request.md`
- Create: `.github/ISSUE_TEMPLATE/config.yml`
- Create: `.github/pull_request_template.md`

**Interfaces:**
- Consumes: nothing.
- Produces: GitHub's new-issue chooser and default PR body. (Verified missing this session: both `Test-Path` checks returned `False`.)

- [ ] **Step 1: Write the four templates**

Create `.github/ISSUE_TEMPLATE/bug_report.md`:

```markdown
---
name: Bug report
about: Something in the CLI, dashboard, or API is broken
labels: bug
---

## What happened

<!-- One paragraph: what you ran, what you expected, what you got. -->

## Repro

```bash
# exact commands, e.g.
npx claude-code-templates@latest --agent development-tools/code-reviewer --yes
```

## Environment

- CLI version (`npx claude-code-templates@latest --version`):
- Node version (`node --version`):
- OS:

## Logs

<!-- Paste the terminal output, including the ❌ line if there is one. -->
```

Create `.github/ISSUE_TEMPLATE/feature_request.md`:

```markdown
---
name: Component or feature request
about: Propose a new agent, command, MCP, setting, hook, or tool improvement
labels: enhancement
---

## Component type

<!-- Delete all but one: agent / command / mcp / setting / hook / template / tooling -->

## What should it do

<!-- 2-3 sentences. What workflow does this unblock? -->

## Example

<!-- A concrete usage example: sample invocation, sample output, or sample workflow. -->

## Checklist

- [ ] I browsed https://www.aitmpl.com and this does not already exist
- [ ] I read CONTRIBUTING.md for the component file structure
```

Create `.github/ISSUE_TEMPLATE/config.yml`:

```yaml
blank_issues_enabled: false
contact_links:
  - name: Security report
    url: https://github.com/davila7/claude-code-templates/security/advisories/new
    about: Report vulnerabilities privately (see SECURITY.md, do not open public issues)
  - name: Component catalog
    url: https://www.aitmpl.com
    about: Browse existing components before requesting new ones
```

Create `.github/pull_request_template.md`:

```markdown
## What

<!-- One paragraph: what this PR changes and why. -->

## Component checklist (delete if not a component PR)

- [ ] File lives in `cli-tool/components/<type>/<category>/<kebab-case-name>.(md|json)`
- [ ] Ran `python scripts/generate_components_json.py`
- [ ] Ran the `component-reviewer` check (see CLAUDE.md) and addressed findings
- [ ] No secrets, absolute paths, or machine-specific values

## Verification

<!-- Exact commands run + results, e.g. `npm --prefix cli-tool test` → exit 0. -->

## Deploy notes

<!-- Anything the deployer agent must know (env vars, migrations, cron changes)? `None` is a valid answer. -->
```

- [ ] **Step 2: Validate frontmatter parses**

Run:

```bash
node -e "const y=require('js-yaml'),fs=require('fs');for(const f of ['.github/ISSUE_TEMPLATE/bug_report.md','.github/ISSUE_TEMPLATE/feature_request.md','.github/ISSUE_TEMPLATE/config.yml']){const s=fs.readFileSync(f,'utf8');const m=s.match(/^---\n([\s\S]*?)\n---/);if(!m)throw new Error('no frontmatter in '+f);y.load(m[1]);console.log('ok',f)}"
```

Expected: three `ok` lines. (The PR template has no frontmatter by design — GitHub reads its whole body.)

- [ ] **Step 3: Commit**

```bash
git add .github/ISSUE_TEMPLATE .github/pull_request_template.md
git commit -m "feat: add issue chooser and PR template"
```

---

### Task 4: Cut the 1.29.0 release (changelog + aligned versions)

**Files:**
- Modify: `CHANGELOG.md` (heading lines only)
- Modify: `package.json:3` (root version)
- Modify: `cli-tool/package.json:3` (version)

**Interfaces:**
- Consumes: Plan 4 Task 4 (both manifests at `1.28.16` — verified by `bash scripts/check-versions.sh` in Step 1).
- Produces: `## [1.29.0] - 2026-09-18` section; both manifests at `1.29.0`; tags/publish explicitly left to the maintainer.

- [ ] **Step 1: Confirm the baseline (red/green preconditions)**

Run:

```bash
bash scripts/check-versions.sh && head -12 CHANGELOG.md
```

Expected: `versions match: 1.28.16`, then the changelog head showing `## [Unreleased]` at the top and `## [1.28.16] - 2026-02-08` as the last tagged section (stale since February — seven months of shipped work sitting under no version).

- [ ] **Step 2: Promote [Unreleased] to 1.29.0**

In `CHANGELOG.md`, find the first-line heading. Old:

```markdown
## [Unreleased]
```

New:

```markdown
## [Unreleased]

## [1.29.0] - 2026-09-18
```

(That is: insert one new heading line plus blanks directly below the existing `## [Unreleased]` line, leaving every entry in place. Minor — not patch — because the unreleased section holds ~40 `Added` entries: dashboard, deploy scripts, Discord bots, Neon statusline.)

- [ ] **Step 3: Bump both manifests**

In root `package.json` line 3. Old:

```json
  "version": "1.28.16",
```

New:

```json
  "version": "1.29.0",
```

In `cli-tool/package.json` line 3. Old:

```json
  "version": "1.28.13",
```

New (Plan 4 set this to `1.28.16`; if Step 1 showed anything else, match-then-bump — the rule is both files end at `1.29.0`):

```json
  "version": "1.29.0",
```

- [ ] **Step 4: Verify guard + suite**

Run:

```bash
bash scripts/check-versions.sh && npm --prefix cli-tool test -- --silent
```

Expected: `versions match: 1.29.0` and jest exit 0.

- [ ] **Step 5: Commit (no tag, no publish)**

```bash
git add CHANGELOG.md package.json cli-tool/package.json
git commit -m "chore: cut 1.29.0 release notes and align versions"
```

Maintainer follow-ups (NOT this task — aiming them here would need the npm granular token flow from CLAUDE.md): `git tag v1.29.0 && git push origin v1.29.0`, `npm publish`, `vercel --prod` via the deployer agent.

---

## Deferred (explicitly out of scope, with reasons)

- Splitting the 14.8MB `components.json` payload (index-without-content, pagination, content-on-demand) — needs dashboard data-layer redesign (`dashboard/src/lib/data.ts`) plus a migration for existing consumers; propose as a follow-up brainstorm, not a hygiene task. Incremental generation (`generate_components_json.py` hash-based skip) belongs to that same follow-up.
- Splitting the 3,247-line `cli-tool/src/index.js` monolith — high regression risk with the current coverage scope (only `analytics/` is measured); do after Plan 3's coverage work extends to it.
- Moving `cli-tool/src/test-console-bridge.js` into `tests/` — needs import-graph proof first (same technique as Task 1 Step 2).
- Deleting legacy `api/` or `docs/` copies — gated on Plan 4's traffic evidence.
