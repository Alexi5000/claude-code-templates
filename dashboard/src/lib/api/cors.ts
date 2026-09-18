export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function corsResponse() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

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
