# Business case: TechTide Claude catalog (lead-gen & authority)

## Audience
Developers adopting Claude Code who need vetted agents/commands/MCPs;
engineering leaders evaluating AI-assisted delivery (TechTide's consulting buyers).

## Baseline (measured 2026-09-18, refresh monthly)
- npm `claude-code-templates` (upstream package): 12,392 downloads/last-30d
  (npm downloads API) — the demand pool is real and growing
- This fork on GitHub: 0 stars, 0 forks, 0 open issues (`gh api`) —
  authority starts at zero; every later number measures this plan working
- npm latest: 1.29.6 published 2026-09-17 (upstream); this fork: 1.28.16 —
  publishing our hardened line under TechTide (Day 3 decision) captures
  the demand the catalog already proves

## Funnel
Catalog browse (aitmpl.com) → one-line CLI install → repeat telemetry
(track-download/command-usage) → README + dashboard CTAs → newsletter /
audit offer → consulting conversation.

## Differentiation (why ours, not upstream)
Security-hardened distribution: authenticated cron triggers
(`dashboard/src/pages/api/claude-code-check.ts`), throttled telemetry
(`dashboard/src/lib/api/rate-limit.ts`), first-party CORS
(`dashboard/src/lib/api/cors.ts`), enforced Discord signatures
(`dashboard/src/pages/api/discord/interactions.ts`), weekly npm audit CI
(`.github/workflows/security-audit.yml`). Every claim links to a file or workflow.

## Metrics (refresh monthly, sources in parentheses)
- npm downloads/30d (npm API, Day-1 command)
- GitHub stars/forks/open issues (`gh api`, same)
- Telemetry installs/30d (Supabase `component_downloads` count query)
- Consulting inquiries attributed to catalog (manual tag in inbox)

## CTAs to add (feeds README work)
README header badge → audit offer; install-success message → newsletter;
dashboard footer → TechTide site. Copy drafted in README task.
