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
