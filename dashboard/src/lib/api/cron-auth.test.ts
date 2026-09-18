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
