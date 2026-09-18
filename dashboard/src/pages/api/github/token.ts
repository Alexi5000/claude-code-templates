import type { APIRoute } from 'astro';
import { corsHeadersFor } from '../../../lib/api/cors';

export const OPTIONS: APIRoute = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeadersFor(request) });
};

export const POST: APIRoute = async ({ request }) => {
  const headers = { 'Content-Type': 'application/json', ...corsHeadersFor(request) };
  const { code } = await request.json();

  if (!code) {
    return new Response(JSON.stringify({ error: 'Missing code' }), {
      status: 400,
      headers,
    });
  }

  const clientId = (import.meta.env.GITHUB_CLIENT_ID || process.env.GITHUB_CLIENT_ID);
  const clientSecret = (import.meta.env.GITHUB_CLIENT_SECRET || process.env.GITHUB_CLIENT_SECRET);

  if (!clientId || !clientSecret) {
    return new Response(JSON.stringify({ error: 'GitHub OAuth not configured' }), {
      status: 500,
      headers,
    });
  }

  try {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    const data = await res.json();

    if (data.error) {
      return new Response(JSON.stringify({ error: data.error_description || data.error }), {
        status: 400,
        headers,
      });
    }

    return new Response(JSON.stringify({ access_token: data.access_token }), {
      status: 200,
      headers,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Token exchange failed' }), {
      status: 500,
      headers,
    });
  }
};
