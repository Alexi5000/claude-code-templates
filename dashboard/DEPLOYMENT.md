# Cloudflare Workers deployment

The dashboard uses Astro 7 and the Cloudflare Workers adapter. Cloudflare Pages
is no longer a supported target. Build with Node 22.22.2 or newer:

```sh
npm ci
npm test
npm run build
npx wrangler deploy --dry-run
```

The repository deployment workflow is opt-in with `ENABLE_DASHBOARD_DEPLOY=true`.
Configure `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the production
environment first. This fork has no verified production Cloudflare credentials.
Do not enable deployment until the target account, Worker, and bindings are verified.

Copy the existing application's runtime secrets to the Worker: `CRON_SECRET`,
`CLERK_SECRET_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`NEON_DATABASE_URL`, Discord credentials, and `GITHUB_CLIENT_SECRET`, as used by
the installed features. Never put secret values in this repository. Cron routes
reject requests when `CRON_SECRET` is missing.

`wrangler.toml` retains the existing public application identifiers. Replace
them with the fork owner's identifiers before operating an independent deployment.
Build and test the Worker at its preview destination, including real login and
database-backed paths, before transferring any existing domain from Pages.
No custom domain or Pages project is deleted or changed by this code migration.

Rollback: keep the existing Pages deployment and domain configuration until
the Worker has passed production acceptance. Restore the previous route if
the later domain cutover fails; retain the prior deployment for that purpose.
