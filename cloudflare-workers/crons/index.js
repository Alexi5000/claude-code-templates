const endpoints = new Map([
  ['*/30 * * * *', '/api/claude-code-check'],
  ['0 * * * *', '/api/health-check'],
]);

async function runScheduled(cron, env) {
  const endpoint = endpoints.get(cron);
  if (!endpoint) throw new Error('Unsupported cron schedule');
  if (!env.DASHBOARD_URL || !env.TRIGGER_SECRET?.trim()) {
    throw new Error('Dashboard URL and trigger secret must be configured');
  }
  const base = new URL(env.DASHBOARD_URL);
  if (base.protocol !== 'https:' || base.username || base.password ||
      base.search || base.hash || base.pathname !== '/') {
    throw new Error('Dashboard URL must be an HTTPS origin without credentials');
  }
  const response = await fetch(new URL(endpoint, base), {
    headers: {
      Authorization: `Bearer ${env.TRIGGER_SECRET}`,
      'User-Agent': 'aitmpl-crons/1.0',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Dashboard cron failed with status ${response.status}`);
  console.log(`${endpoint}: ${response.status}`);
}

export default {
  async scheduled(event, env) {
    await runScheduled(event.cron, env);
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/trigger') {
      return new Response('aitmpl-crons worker', { status: 200 });
    }
    const auth = request.headers.get('Authorization');
    if (!env.TRIGGER_SECRET?.trim() || auth !== `Bearer ${env.TRIGGER_SECRET}`) {
      return new Response('Unauthorized', { status: 401 });
    }
    const cron = url.searchParams.get('cron') || '*/30 * * * *';
    if (!endpoints.has(cron)) return new Response('Unsupported cron schedule', { status: 400 });
    try {
      await runScheduled(cron, env);
      return new Response(`Triggered: ${cron}`, { status: 200 });
    } catch {
      return new Response('Dashboard cron failed', { status: 502 });
    }
  },
};
