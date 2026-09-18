# Deployment map (audited 2026-09-18)

## Audit

| Surface | URL / target | Status | Owner |
|---|---|---|---|
| Dashboard + APIs | https://www.aitmpl.com/ | 200 | TBD |
| Health endpoint | https://www.aitmpl.com/api/health-check | 200 | TBD |
| Static catalog | https://www.aitmpl.com/components.json | 200 | TBD |
| npm CLI | claude-code-templates@1.29.6 (upstream, 2026-09-17) | published | TBD |
| GitHub Actions | repo-level switch was `enabled: false` | re-enabled 2026-09-18 | TechTide |
| Scheduled dailies | last runs 2026-06-22, all 4 Discord jobs failing | webhooks dead (exit 3) | TBD |
| Crons worker | aitmpl-crons (Cloudflare) | unverified (no wrangler token locally) | TBD |
| Discord bot | interactions endpoint | prod returns 500 unsigned (legacy path) | TBD |

## Findings + fixes

1. DONE 2026-09-18: Re-enabled GitHub Actions (`enabled: false` → `true`).
   No push-triggered runs (Deploy, Security Audit) had fired since June.
   Validation rides on Day-4 pushes (dashboard/vercel.json triggers Deploy;
   package.json bumps trigger Security Audit).
2. TODO (maintainer, needs Discord server + GitHub Secrets access): rotate
   Discord webhook secrets. All 4 daily Discord workflows fail since
   2026-06-22 with webhook HTTP errors (exit 3). Secrets to rotate:
   `DISCORD_WEBHOOK_URL*` used by daily-blog/community/component/general jobs.
3. TODO (maintainer): set `CRON_SECRET` (dashboard hosting env) and matching
   `TRIGGER_SECRET` (`wrangler secret put`) for the aitmpl-crons worker,
   then verify a scheduled `/api/claude-code-check` returns 200 with the
   Bearer header and 401 without it.
4. TODO (maintainer): decide npm publishing for the hardened line (fork is
   1.28.16; npm latest is upstream 1.29.6). Do NOT publish over the
   upstream name without a scope/name decision.
5. TODO (maintainer, Cloudflare account access): add `CLOUDFLARE_API_TOKEN`
   + `CLOUDFLARE_ACCOUNT_ID` repo secrets. First post-reenable Deploy run
   (2026-09-18) passed Test + Build and failed only on the missing token —
   the pipeline itself is proven working.

## Decision
Targets confirmed for this week: dashboard + APIs (live, green), CI
pipelines (re-enabled, validation pending Day-4 pushes). Explicitly
deferred: npm publish (name decision), Discord webhook rotation (needs
server access), crons-worker end-to-end verify (needs wrangler access).
Each target re-verifies with the Day-1 audit commands
(curl status lines, `npm view`, `gh run list`, `gh workflow list`).
