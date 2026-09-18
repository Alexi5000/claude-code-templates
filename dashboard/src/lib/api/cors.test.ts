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
