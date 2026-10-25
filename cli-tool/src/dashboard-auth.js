const { randomBytes, timingSafeEqual } = require('node:crypto');

class DashboardAuth {
  constructor() {
    this.token = randomBytes(32).toString('hex');
    this.cookieName = `claude_dashboard_${randomBytes(8).toString('hex')}`;
    this.origins = new Set();
  }

  accessUrl(baseUrl) {
    const url = new URL(baseUrl);
    this.origins.add(url.origin);
    url.searchParams.set('dashboard_token', this.token);
    return url.href;
  }

  matches(value) {
    if (typeof value !== 'string') return false;
    const supplied = Buffer.from(value);
    const expected = Buffer.from(this.token);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }

  trustedRequest(req) {
    const port = req.socket.localPort;
    const local = [`http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://[::1]:${port}`];
    const allowed = new Set([...local, ...this.origins]);
    const host = req.headers.host;
    if (![...allowed].some(origin => new URL(origin).host === host)) return false;
    const origin = req.headers.origin;
    return origin === undefined || allowed.has(origin);
  }

  authorized(req) {
    if (!this.trustedRequest(req)) return false;
    const bearer = req.headers.authorization;
    if (typeof bearer === 'string' && bearer.startsWith('Bearer ') && this.matches(bearer.slice(7))) return true;
    const cookie = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${this.cookieName}=`));
    return !!cookie && this.matches(cookie.slice(this.cookieName.length + 1));
  }

  middleware() {
    return (req, res, next) => {
      res.set('Cache-Control', 'no-store');
      res.set('Referrer-Policy', 'no-referrer');
      if (!this.trustedRequest(req)) return res.status(403).json({ error: 'Untrusted dashboard origin' });
      const url = new URL(req.originalUrl, 'http://localhost');
      const token = url.searchParams.get('dashboard_token');
      if (req.method === 'GET' && this.matches(token)) {
        const secure = [...this.origins].some(origin => origin.startsWith('https:') && new URL(origin).host === req.headers.host);
        res.set('Set-Cookie', `${this.cookieName}=${this.token}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`);
        url.searchParams.delete('dashboard_token');
        return res.redirect(303, url.pathname + url.search + url.hash);
      }
      if (!this.authorized(req)) return res.status(401).json({ error: 'Open the dashboard access link printed by the CLI' });
      next();
    };
  }
}

module.exports = DashboardAuth;
