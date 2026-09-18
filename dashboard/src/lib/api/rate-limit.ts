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
