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

- `api/_lib/auth.js` — legacy shared helper.
- `api/_lib/neon.js` — legacy shared helper.
- `api/_parser-claude.js` — legacy parser.
- `api/collections/[id].js` — legacy sub-route.
- `api/collections/items.js` — legacy sub-route.
- `api/claude-code-monitor/` — monitor scripts (see `api/claude-code-monitor/README.md`).
