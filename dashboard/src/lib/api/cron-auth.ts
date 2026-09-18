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

export function maskWebhookUrl(_url: string | undefined): string {
  return 'redacted';
}
