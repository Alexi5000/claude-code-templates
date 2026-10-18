import { defineMiddleware } from 'astro:middleware';

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

  return next();
});
