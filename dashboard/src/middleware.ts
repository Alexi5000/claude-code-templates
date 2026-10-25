import { defineMiddleware } from 'astro:middleware';
import { MARKDOWN_CONTENT_TYPE, notFoundMarkdown, prefersMarkdown } from './lib/agent-readiness';

/**
 * Injects Cloudflare Workers env bindings into process.env so that
 * API routes and libs can use `import.meta.env.X || process.env.X` as a
 * unified pattern with runtime secrets.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  if (!context.isPrerendered) {
    const { env } = await import('cloudflare:workers');
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === 'string' && !process.env[key]) {
        process.env[key] = value;
      }
    }
  }

  const response = await next();

  if (response.status !== 404 || context.url.pathname.startsWith('/api/')) {
    return response;
  }

  if (prefersMarkdown(context.request.headers.get('accept'))) {
    return new Response(notFoundMarkdown(context.url.pathname), {
      status: 404,
      headers: { 'Content-Type': MARKDOWN_CONTENT_TYPE, Vary: 'Accept' },
    });
  }

  const vary = response.headers.get('Vary') ?? '';
  if (!/(^|,)\s*accept\s*(,|$)/i.test(vary)) response.headers.append('Vary', 'Accept');
  return response;
});
