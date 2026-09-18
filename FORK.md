# Why this fork exists

## Relationship
This repo (`Alexi5000/claude-code-templates`) is a friendly fork of
`davila7/claude-code-templates`. Upstream is the community catalog, moving
fast on breadth (hundreds of contributors and bot-assisted catalog updates);
this fork is TechTide's hardened, lead-generating distribution — same
catalog, stricter security posture, owned deployment story.

## Evidence of divergence (measured 2026-09-18)
- Commits ahead of upstream: 36 (`git rev-list --left-right --count main...upstream/main` → `36 411`)
- Commits behind upstream: 411 (upstream shipped to v1.29.6 while this fork sat at v1.28.16)
- Our 36 ahead = 5 security-hardening commits (Sep 2026, Plan 1) + 31 daily
  catalog-sync bot commits
- Upstream activity since our last sync (2026-06-22): ~400 commits from
  50+ authors (Daniel Avila, community contributors, Claude, bots) — mostly
  catalog breadth (new skills, commands, plugins), not hardening
- TechTide-only branches: `origin/techtide/build-out` (+ ~25 upstream
  `claude/*` experiment branches inherited at fork time)
- Key differentiators: CRON-secret cron auth, per-IP telemetry throttling,
  first-party-scoped CORS, enforced Discord signatures, redacted webhook
  logs (commits `d30ab60b..164b138c`, pushed to `origin/main` 2026-09-18)

## Upstream policy
- `upstream` remote is fetch-only; CI never pushes there.
- Sync cadence: monthly `git fetch upstream` + cherry-pick catalog additions;
  never merge upstream `main` wholesale (protects the security fixes above
  and avoids re-absorbing 400+ unrelated commits at once).
- Divergent files owned by TechTide: `dashboard/src/lib/api/*`,
  `dashboard/src/pages/api/*`, `.github/workflows/security-audit.yml`
  (added under Plans 1–2).
- Re-audit divergence quarterly with the Day-1 Step-1 commands; if `behind`
  grows past ~500 with catalog-only changes, schedule a dedicated sync week.
