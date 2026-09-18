# API Operational Lockdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five unauthenticated/abuseable API surfaces in `dashboard/src/pages/api/` (open cron trigger, unthrottled telemetry, wildcard CORS on authed routes, Discord verify-before-parse + missing `await`, webhook URL logged in cleartext).

**Architecture:** Add two small pure helpers (`cron-auth.ts`, `rate-limit.ts`) plus scoped-CORS helpers in the existing `lib/api/cors.ts`, all covered by vitest unit tests; then wire them into the existing Astro `APIRoute` handlers with minimal diffs. No new runtime dependencies; no schema changes.

**Tech Stack:** Astro 5 API routes, TypeScript, vitest 3 (new devDependency in `dashboard/` only), `@neondatabase/serverless` tagged-template queries (unchanged), `discord-interactions` v4 (`verifyKey` is `async` — must `await`).

## Global Constraints

- Dashboard builds with Node 22 (` .github/workflows/deploy.yml` pins `node-version: 22`).
- `discord-interactions` v4 requires Node >= 18.4 and `verifyKey` MUST be awaited (official v4.0.0 breaking change).
- The Cloudflare scheduler (`cloudflare-workers/crons/index.js:15-18`) calls `/api/claude-code-check` with header `Authorization: Bearer ${TRIGGER_SECRET}` — the dashboard must accept that exact scheme.
- Telemetry endpoints (`track-*`) stay public (the CLI posts without credentials) — throttle, do not authenticate.
- Commit style follows repo history: `fix:`, `feat:`, `chore:` prefixes.
- Do NOT commit secrets; new env var `CRON_SECRET` goes in `.env.example` with a placeholder only.

---

### Task 1: Cron-auth helper + vitest setup in dashboard

**Files:**
- Create: `dashboard/src/lib/api/cron-auth.ts`
- Create: `dashboard/src/lib/api/cron-auth.test.ts`
- Modify: `dashboard/package.json` (add `test` script + vitest devDependency)

**Interfaces:**
- Consumes: nothing (standalone pure module; reads `CRON_SECRET` from `import.meta.env` or `process.env`).
- Produces: `getCronSecret(): string | null`, `isCronAuthorized(request: Request, url?: URL): boolean` — used by Task 2.

- [ ] **Step 1: Add vitest and a test script to the dashboard**

In `dashboard/package.json`, replace the scripts block (lines 6-12):

Old:

```json
  "scripts": {
    "dev": "astro dev",
    "start": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "astro": "astro"
  },
```

New:

```json
  "scripts": {
    "dev": "astro dev",
    "start": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "astro": "astro",
    "test": "vitest run"
  },
```

Then run:

```bash
npm --prefix dashboard install -D vitest@^3
```

Expected: `added N packages`, and `dashboard/package.json` contains `"vitest": "^3...` under a new `devDependencies` key. No config file is needed — vitest picks up `**/*.test.ts` by default.

- [ ] **Step 2: Write the failing test**

Create `dashboard/src/lib/api/cron-auth.test.ts` with this exact content:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getCronSecret, isCronAuthorized } from './cron-auth';

function req(headers: Record<string, string> = {}): Request {
  return new Request('https://www.aitmpl.com/api/claude-code-check', { headers });
}

describe('getCronSecret', () => {
  const OLD = process.env.CRON_SECRET;

  afterEach(() => {
    if (OLD === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = OLD;
  });

  it('returns null when CRON_SECRET is unset', () => {
    delete process.env.CRON_SECRET;
    expect(getCronSecret()).toBeNull();
  });

  it('returns the secret when CRON_SECRET is set', () => {
    process.env.CRON_SECRET = 's3cret-value';
    expect(getCronSecret()).toBe('s3cret-value');
  });
});

describe('isCronAuthorized', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 's3cret-value';
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it('allows the Cloudflare worker Bearer scheme', () => {
    expect(isCronAuthorized(req({ authorization: 'Bearer s3cret-value' }))).toBe(true);
  });

  it('allows the secret as a ?secret= query param', () => {
    const r = new Request('https://www.aitmpl.com/api/claude-code-check?secret=s3cret-value');
    expect(isCronAuthorized(r, new URL(r.url))).toBe(true);
  });

  it('rejects a wrong bearer token', () => {
    expect(isCronAuthorized(req({ authorization: 'Bearer wrong' }))).toBe(false);
  });

  it('rejects a request with no credentials', () => {
    expect(isCronAuthorized(req())).toBe(false);
  });

  it('allows everything when no secret is configured (local dev)', () => {
    delete process.env.CRON_SECRET;
    expect(isCronAuthorized(req())).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm --prefix dashboard test -- src/lib/api/cron-auth.test.ts`

Expected: FAIL with `Error: Cannot find module './cron-auth'` (the helper does not exist yet).

- [ ] **Step 4: Write the minimal implementation**

Create `dashboard/src/lib/api/cron-auth.ts` with this exact content:

```ts
function readEnv(name: string): string | undefined {
  try {
    const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    if (viteEnv?.[name]) return viteEnv[name];
  } catch {
    // import.meta.env is unavailable outside Vite/Astro — fall through to process.env
  }
  return process.env[name];
}

export function getCronSecret(): string | null {
  return readEnv('CRON_SECRET') || null;
}

export function isCronAuthorized(request: Request, url?: URL): boolean {
  const secret = getCronSecret();
  if (!secret) return true;
  if (request.headers.get('authorization') === `Bearer ${secret}`) return true;
  const querySecret = url?.searchParams.get('secret');
  if (querySecret && querySecret === secret) return true;
  return false;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm --prefix dashboard test -- src/lib/api/cron-auth.test.ts`

Expected: `Test Files  1 passed`, `Tests  7 passed`.

- [ ] **Step 6: Commit**

```bash
git add dashboard/package.json dashboard/src/lib/api/cron-auth.ts dashboard/src/lib/api/cron-auth.test.ts
git commit -m "feat: add CRON_SECRET auth helper with tests"
```

---

### Task 2: Gate claude-code-check on CRON_SECRET + redact webhook URL from DB log

**Files:**
- Modify: `dashboard/src/pages/api/claude-code-check.ts:1-4` (import), `:191-205` (log insert), `:269-275` (GET/POST exports)
- Modify: `.env.example` (append `CRON_SECRET` placeholder)

**Interfaces:**
- Consumes: `isCronAuthorized(request, url)` from Task 1.
- Produces: nothing new (same JSON shapes; 401 on unauthorized; `webhook_url` column now stores the literal string `'redacted'`).

- [ ] **Step 1: Write the failing test**

Append to `dashboard/src/lib/api/cron-auth.test.ts` (created in Task 1):

```ts
import { maskWebhookUrl } from './cron-auth';

describe('maskWebhookUrl', () => {
  it('redacts a discord webhook URL to a constant', () => {
    expect(maskWebhookUrl('https://discord.com/api/webhooks/123/abc-token')).toBe('redacted');
  });

  it('handles undefined', () => {
    expect(maskWebhookUrl(undefined)).toBe('redacted');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix dashboard test -- src/lib/api/cron-auth.test.ts`

Expected: FAIL with `SyntaxError: The requested module './cron-auth' does not provide an export named 'maskWebhookUrl'`.

- [ ] **Step 3: Implement `maskWebhookUrl`**

Append to `dashboard/src/lib/api/cron-auth.ts`:

```ts
export function maskWebhookUrl(_url: string | undefined): string {
  return 'redacted';
}
```

Rerun: `npm --prefix dashboard test -- src/lib/api/cron-auth.test.ts`. Expected: all tests pass (9 passed).

- [ ] **Step 4: Wire auth + redaction into claude-code-check.ts**

Edit 1 — line 4, extend the import. Old:

```ts
import { parseVersionChangelog, formatForDiscord, generateSummary } from '../../lib/api/changelog-parser';
```

New:

```ts
import { parseVersionChangelog, formatForDiscord, generateSummary } from '../../lib/api/changelog-parser';
import { isCronAuthorized, maskWebhookUrl } from '../../lib/api/cron-auth';
```

Edit 2 — lines 191-205, replace the webhook URL value with the redacted constant. Old:

```ts
    await sql`
      INSERT INTO discord_notifications_log (
        version_id,
        webhook_url,
        payload,
        response_status,
        response_body
      ) VALUES (
        ${versionId},
        ${import.meta.env.DISCORD_WEBHOOK_URL_CHANGELOG || process.env.DISCORD_WEBHOOK_URL_CHANGELOG || import.meta.env.DISCORD_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL},
        ${JSON.stringify(discordResult.payload)},
        ${discordResult.status},
        ${'Success'}
      )
    `;
```

New:

```ts
    await sql`
      INSERT INTO discord_notifications_log (
        version_id,
        webhook_url,
        payload,
        response_status,
        response_body
      ) VALUES (
        ${versionId},
        ${maskWebhookUrl(import.meta.env.DISCORD_WEBHOOK_URL_CHANGELOG || process.env.DISCORD_WEBHOOK_URL_CHANGELOG || import.meta.env.DISCORD_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL)},
        ${JSON.stringify(discordResult.payload)},
        ${discordResult.status},
        ${'Success'}
      )
    `;
```

Edit 3 — lines 269-275, gate both methods. Old:

```ts
export const GET: APIRoute = async () => {
  return handleCheck();
};

export const POST: APIRoute = async () => {
  return handleCheck();
};
```

New:

```ts
export const GET: APIRoute = async ({ request, url }) => {
  if (!isCronAuthorized(request, url)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  return handleCheck();
};

export const POST: APIRoute = async ({ request, url }) => {
  if (!isCronAuthorized(request, url)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  return handleCheck();
};
```

(`url: URL` is part of the Astro `APIRoute` context; `jsonResponse` is already imported on line 3.)

- [ ] **Step 5: Document the new env var**

Append to `.env.example`:

```bash
# Cron trigger auth (dashboard + cloudflare-workers/crons TRIGGER_SECRET must match)
CRON_SECRET=your_cron_trigger_secret_here
```

- [ ] **Step 6: Verify the dashboard still builds**

Run: `npm --prefix dashboard run build`

Expected: build completes (`✓ built` / `Build complete`). A TS-syntax error in the edited route fails here.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/pages/api/claude-code-check.ts dashboard/src/lib/api/cron-auth.ts dashboard/src/lib/api/cron-auth.test.ts .env.example
git commit -m "fix: require CRON_SECRET on claude-code-check and redact webhook URL in logs"
```

Operator note (not code): set `CRON_SECRET` in the dashboard hosting env AND as `TRIGGER_SECRET` (`wrangler secret put`) for the `aitmpl-crons` worker, using the same random value. Vercel cron entries for this path (`dashboard/vercel.json`) are dead config on Cloudflare Pages — removal is Plan 4, Task 2.

---

### Task 3: Per-IP rate limiting on public telemetry endpoints

**Files:**
- Create: `dashboard/src/lib/api/rate-limit.ts`
- Create: `dashboard/src/lib/api/rate-limit.test.ts`
- Modify: `dashboard/src/pages/api/track-download-supabase.ts:35-42` (POST entry)
- Modify: `dashboard/src/pages/api/track-command-usage.ts:39-40` (POST entry)
- Modify: `dashboard/src/pages/api/track-installation-outcome.ts` (same insert at POST entry)
- Modify: `dashboard/src/pages/api/track-website-events.ts` (same insert at POST entry)

**Interfaces:**
- Consumes: nothing.
- Produces: `getClientIp(request: Request): string`, `checkRateLimit(key: string, limit?: number, windowMs?: number, now?: number): { allowed: boolean; remaining: number }`, `clearRateLimitBuckets(): void` (test helper). Per-isolate in-memory sliding window — best-effort on serverless, documented in code comment.

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/lib/api/rate-limit.test.ts` with this exact content:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, clearRateLimitBuckets, getClientIp } from './rate-limit';

describe('checkRateLimit', () => {
  beforeEach(() => clearRateLimitBuckets());

  it('allows requests under the limit', () => {
    expect(checkRateLimit('k1', 3, 60_000, 1000).allowed).toBe(true);
    expect(checkRateLimit('k1', 3, 60_000, 1001).allowed).toBe(true);
    const third = checkRateLimit('k1', 3, 60_000, 1002);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
  });

  it('blocks the request over the limit with 429 semantics', () => {
    checkRateLimit('k2', 2, 60_000, 1000);
    checkRateLimit('k2', 2, 60_000, 1001);
    const blocked = checkRateLimit('k2', 2, 60_000, 1002);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('refills after the window passes', () => {
    checkRateLimit('k3', 1, 60_000, 1000);
    expect(checkRateLimit('k3', 1, 60_000, 1001).allowed).toBe(false);
    expect(checkRateLimit('k3', 1, 60_000, 61_001).allowed).toBe(true);
  });

  it('tracks keys independently', () => {
    checkRateLimit('a', 1, 60_000, 1000);
    expect(checkRateLimit('b', 1, 60_000, 1001).allowed).toBe(true);
  });
});

describe('getClientIp', () => {
  it('prefers x-forwarded-for first entry', () => {
    const r = new Request('https://x.test/', {
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8', 'x-real-ip': '9.9.9.9' },
    });
    expect(getClientIp(r)).toBe('1.2.3.4');
  });

  it('falls back to x-real-ip then 127.0.0.1', () => {
    expect(getClientIp(new Request('https://x.test/', { headers: { 'x-real-ip': '9.9.9.9' } }))).toBe(
      '9.9.9.9',
    );
    expect(getClientIp(new Request('https://x.test/'))).toBe('127.0.0.1');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix dashboard test -- src/lib/api/rate-limit.test.ts`

Expected: FAIL with `Error: Cannot find module './rate-limit'`.

- [ ] **Step 3: Write the minimal implementation**

Create `dashboard/src/lib/api/rate-limit.ts` with this exact content:

```ts
// Best-effort per-isolate in-memory sliding-window limiter.
// Serverless isolates do not share state, so this throttles casual abuse
// and accidents, not a determined distributed flood. Limits are intentionally
// generous: the CLI fires one telemetry POST per install/command.
const buckets = new Map<string, number[]>();
const MAX_BUCKETS = 10_000;

export function checkRateLimit(
  key: string,
  limit = 60,
  windowMs = 60_000,
  now = Date.now(),
): { allowed: boolean; remaining: number } {
  const cutoff = now - windowMs;
  const recent = (buckets.get(key) ?? []).filter((t) => t > cutoff);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return { allowed: false, remaining: 0 };
  }
  recent.push(now);
  if (!buckets.has(key) && buckets.size >= MAX_BUCKETS) {
    const oldest = buckets.keys().next().value;
    if (oldest !== undefined) buckets.delete(oldest);
  }
  buckets.set(key, recent);
  return { allowed: true, remaining: limit - recent.length };
}

export function clearRateLimitBuckets(): void {
  buckets.clear();
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    '127.0.0.1'
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix dashboard test -- src/lib/api/rate-limit.test.ts`

Expected: `Test Files  1 passed`, `Tests  6 passed`.

- [ ] **Step 5: Apply the limiter to all four telemetry POST handlers**

In `dashboard/src/pages/api/track-download-supabase.ts`, extend the line-3 import. Old:

```ts
import { corsResponse, jsonResponse } from '../../lib/api/cors';
```

New:

```ts
import { corsResponse, jsonResponse } from '../../lib/api/cors';
import { checkRateLimit, getClientIp } from '../../lib/api/rate-limit';
```

Then insert as the first statement of the `try` block in `POST` (line 36-37). Old:

```ts
export const POST: APIRoute = async ({ request }) => {
  try {
    const { type, name, path, category, cliVersion } = await request.json();
```

New:

```ts
export const POST: APIRoute = async ({ request }) => {
  try {
    const rateLimitKey = `track-download:${getClientIp(request)}`;
    if (!checkRateLimit(rateLimitKey).allowed) {
      return jsonResponse({ error: 'Rate limit exceeded. Try again in a minute.' }, 429);
    }
    const { type, name, path, category, cliVersion } = await request.json();
```

Apply the identical two edits to `dashboard/src/pages/api/track-command-usage.ts` (import line 2, POST at line 39, key prefix `track-command:`), `dashboard/src/pages/api/track-installation-outcome.ts` (key prefix `track-outcome:`), and `dashboard/src/pages/api/track-website-events.ts` (key prefix `track-events:`) — same relative import path `../../lib/api/rate-limit`, same insert as the first statement inside each `POST` try block.

- [ ] **Step 6: Run all dashboard tests + build**

Run: `npm --prefix dashboard test`

Expected: all test files pass. Then run: `npm --prefix dashboard run build`

Expected: build completes.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/lib/api/rate-limit.ts dashboard/src/lib/api/rate-limit.test.ts dashboard/src/pages/api/track-download-supabase.ts dashboard/src/pages/api/track-command-usage.ts dashboard/src/pages/api/track-installation-outcome.ts dashboard/src/pages/api/track-website-events.ts
git commit -m "feat: throttle public telemetry endpoints per IP (60/min, 429)"
```

---

### Task 4: Scope CORS to first-party origins on authenticated routes

**Files:**
- Modify: `dashboard/src/lib/api/cors.ts` (append helpers)
- Create: `dashboard/src/lib/api/cors.test.ts`
- Modify: `dashboard/src/pages/api/collections/index.ts` (GET/POST/OPTIONS)
- Modify: `dashboard/src/pages/api/collections/[id].ts`, `dashboard/src/pages/api/collections/items.ts`, `dashboard/src/pages/api/collections/share.ts`, `dashboard/src/pages/api/github/token.ts` (identical swap pattern)

**Interfaces:**
- Consumes: existing `corsHeaders`, `corsResponse`, `jsonResponse` (unchanged — public endpoints keep wildcard).
- Produces: `ALLOWED_ORIGINS`, `corsHeadersFor(request?)`, `authJsonResponse(request, data, status?)`, `authCorsResponse(request)`.

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/lib/api/cors.test.ts` with this exact content:

```ts
import { describe, it, expect } from 'vitest';
import { ALLOWED_ORIGINS, authJsonResponse, corsHeadersFor } from './cors';

function reqWithOrigin(origin?: string): Request {
  const headers: Record<string, string> = {};
  if (origin) headers['origin'] = origin;
  return new Request('https://www.aitmpl.com/api/collections', { headers });
}

describe('corsHeadersFor', () => {
  it('echoes a first-party origin', () => {
    expect(corsHeadersFor(reqWithOrigin('https://app.aitmpl.com'))['Access-Control-Allow-Origin']).toBe(
      'https://app.aitmpl.com',
    );
  });

  it('does not echo an unknown origin', () => {
    const origin = corsHeadersFor(reqWithOrigin('https://evil.example'))['Access-Control-Allow-Origin'];
    expect(ALLOWED_ORIGINS).toContain(origin);
    expect(origin).not.toBe('https://evil.example');
  });

  it('defaults to the canonical origin with no Origin header', () => {
    expect(corsHeadersFor(reqWithOrigin())['Access-Control-Allow-Origin']).toBe(ALLOWED_ORIGINS[0]);
  });

  it('sets Vary: Origin', () => {
    expect(corsHeadersFor(reqWithOrigin('https://www.aitmpl.com'))['Vary']).toBe('Origin');
  });
});

describe('authJsonResponse', () => {
  it('returns scoped CORS headers and JSON body', async () => {
    const res = authJsonResponse(reqWithOrigin('https://www.aitmpl.com'), { ok: true }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://www.aitmpl.com');
    expect(await res.json()).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix dashboard test -- src/lib/api/cors.test.ts`

Expected: FAIL with `does not provide an export named 'ALLOWED_ORIGINS'`.

- [ ] **Step 3: Implement the helpers**

Append to `dashboard/src/lib/api/cors.ts`:

```ts
export const ALLOWED_ORIGINS = [
  'https://www.aitmpl.com',
  'https://app.aitmpl.com',
  'https://aitmpl.com',
];

export function corsHeadersFor(request?: Request): Record<string, string> {
  const origin = request?.headers.get('origin');
  const allowOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return { ...corsHeaders, 'Access-Control-Allow-Origin': allowOrigin, Vary: 'Origin' };
}

export function authJsonResponse(request: Request, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeadersFor(request) },
  });
}

export function authCorsResponse(request: Request) {
  return new Response(null, { status: 204, headers: corsHeadersFor(request) });
}
```

Rerun: `npm --prefix dashboard test -- src/lib/api/cors.test.ts`. Expected: `Tests  5 passed`.

- [ ] **Step 4: Apply to the authenticated collection routes**

In `dashboard/src/pages/api/collections/index.ts`, replace line 2. Old:

```ts
import { corsResponse, jsonResponse } from '../../../lib/api/cors';
```

New:

```ts
import { authCorsResponse, authJsonResponse, jsonResponse } from '../../../lib/api/cors';
```

(`jsonResponse` stays for the unauthenticated 401 branches — do not change those.) Then update the three authenticated returns:

1. Line 6: `export const OPTIONS: APIRoute = async () => corsResponse();` → `export const OPTIONS: APIRoute = async ({ request }) => authCorsResponse(request);`
2. Line 42 `return jsonResponse({ collections: result });` → `return authJsonResponse(request, { collections: result });`
3. Line 80 `return jsonResponse({ collection }, 201);` → `return authJsonResponse(request, { collection }, 201);`

(The `request` variable is already in scope in both GET and POST handlers. Error branches `jsonResponse({ error: 'Internal server error' }, 500)` stay as-is — error-shape change is out of scope.)

Apply the identical swap to `dashboard/src/pages/api/collections/[id].ts`, `dashboard/src/pages/api/collections/items.ts`, `dashboard/src/pages/api/collections/share.ts` (same `../../../lib/api/cors` depth): import `authCorsResponse, authJsonResponse`, use them for every 2xx return inside an authenticated handler, leave 401/400/500 returns untouched. Apply to `dashboard/src/pages/api/github/token.ts` with import depth `../../lib/api/cors` (sibling of the `track-*` files).

- [ ] **Step 5: Run tests + build**

Run: `npm --prefix dashboard test`

Expected: all pass. Run: `npm --prefix dashboard run build`

Expected: build completes.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/lib/api/cors.ts dashboard/src/lib/api/cors.test.ts dashboard/src/pages/api/collections/ dashboard/src/pages/api/github/token.ts
git commit -m "fix: scope CORS to first-party origins on authenticated routes"
```

---

### Task 5: Harden Discord interactions (await verifyKey, verify-before-parse, input caps)

**Files:**
- Modify: `dashboard/src/pages/api/discord/interactions.ts:132-147` (POST entry), `:49-56` (`searchComponents` signature), `:162-165` (search branch), `:200-203` (info/install branch)

**Interfaces:**
- Consumes: nothing new.
- Produces: same Discord response shapes; new 400s for malformed JSON / bad input; 401 now actually enforced (previously the missing `await` made the Promise object truthy so `!isValidRequest` was always false — every request passed verification).

- [ ] **Step 1: Reorder verification before parsing and await verifyKey**

Old (lines 132-149):

```ts
export const POST: APIRoute = async ({ request }) => {
  const rawBody = await request.text();
  const body = JSON.parse(rawBody);

  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');

  const publicKey = import.meta.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500);
  }

  const isValidRequest = verifyKey(rawBody, signature as string, timestamp as string, publicKey);
  if (!isValidRequest) {
    return jsonResponse({ error: 'Invalid request signature' }, 401);
  }

  const interaction = body;
```

New:

```ts
const MAX_OPTION_LENGTH = 200;

function getOptionString(
  options: Array<{ name: string; value?: unknown }>,
  name: string,
): string | null {
  const value = options.find((o) => o.name === name)?.value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_OPTION_LENGTH) return null;
  return trimmed;
}

export const POST: APIRoute = async ({ request }) => {
  const rawBody = await request.text();

  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');

  const publicKey = import.meta.env.DISCORD_PUBLIC_KEY || process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500);
  }
  if (!signature || !timestamp) {
    return jsonResponse({ error: 'Missing signature headers' }, 401);
  }

  const isValidRequest = await verifyKey(rawBody, signature, timestamp, publicKey);
  if (!isValidRequest) {
    return jsonResponse({ error: 'Invalid request signature' }, 401);
  }

  let interaction: { type: number; data: { name: string; options?: Array<{ name: string; value?: unknown }> } };
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: 'Malformed JSON body' }, 400);
  }
```

- [ ] **Step 2: Cap search input**

Old (lines 162-165):

```ts
      if (commandName === 'search') {
        const query = options.find((o: { name: string }) => o.name === 'query')?.value;
        const type = options.find((o: { name: string }) => o.name === 'type')?.value;
        const results = searchComponents(components, query, type);
```

New:

```ts
      if (commandName === 'search') {
        const query = getOptionString(options, 'query');
        const type = getOptionString(options, 'type');
        if (!query) {
          return jsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: 'Provide a search query up to 200 characters.', flags: 64 },
          });
        }
        const results = searchComponents(components, query, type);
```

- [ ] **Step 3: Cap info/install input**

Old (lines 200-202):

```ts
      } else if (commandName === 'info' || commandName === 'install') {
        const name = options.find((o: { name: string }) => o.name === 'name')?.value;
        const type = options.find((o: { name: string }) => o.name === 'type')?.value;
```

New:

```ts
      } else if (commandName === 'info' || commandName === 'install') {
        const name = getOptionString(options, 'name');
        const type = getOptionString(options, 'type');
        if (!name) {
          return jsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: 'Provide a component name up to 200 characters.', flags: 64 },
          });
        }
```

(`searchComponents` already slices to 10 results; with capped string input its loop is bounded. `type` is now `string | null`, matching its `type: string | null = null` parameter.)

- [ ] **Step 4: Verify with tests + build**

Run: `npm --prefix dashboard test`

Expected: all pass (no new test file — changes are verified by build + the existing `api/__tests__` Discord coverage after Plan 3 retargets it; the `await` fix is behavior-critical and reviewed by diff).

Run: `npm --prefix dashboard run build`

Expected: build completes. (`data` is typed required because every branch that touches it runs after the PING early-return; Astro's build does not typecheck, so any residual type niggle cannot fail this step — do not loosen the annotation to `any`.)

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/pages/api/discord/interactions.ts
git commit -m "fix: enforce Discord signature verification (await verifyKey), validate inputs"
```

---

## Deferred (explicitly out of scope)

- Removing the dead `dashboard/vercel.json` cron + `/api/(.*)` wildcard CORS header → Plan 4, Task 2.
- `api/discord/interactions.js` (legacy JS copy) likely has the same missing-`await` bug if it runs on `discord-interactions@3` (sync) it is safe; if upgraded to v4 it needs the same fix → handled in Plan 2 (dependency alignment) which inspects that file.
- Per-user (Clerk) rate limits and Redis/KV-backed global throttling — future work; per-IP in-memory is the documented stopgap.
