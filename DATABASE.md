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
- `command_usage_stats` — aggregated counters maintained by the
  `trigger_update_command_stats` trigger (same migration).
- `user_collections` + `collection_items` — Clerk-user collections
  (`dashboard/src/pages/api/collections/index.ts:15-27,65-77`).

## Additional tables found by code scan (pointers unverified)

Found via the FROM/INSERT/UPDATE scan in Day-4 work; owning files not yet
pinned — locate with the scan command before editing:

- `installation_outcomes` — likely `track-installation-outcome` handler.
- `website_events` — likely `track-website-events` handler.
- `api_health_logs` — likely health-check handler.
- `cycle_control`, `review_cycles`, `tool_executions` — likely
  `dashboard/src/pages/api/live-task/*` handlers.

## Migrations

Checked in: `database/migrations/001_create_claude_code_versions.sql`
(covers the four monitor tables),
`database/migrations/002_create_command_usage_logs.sql`
(covers command logs + stats + views).
Tables without a checked-in migration (Supabase pair, collections pair,
and all of "Additional tables" above) are applied out-of-band — adding
missing migrations is follow-up work.
