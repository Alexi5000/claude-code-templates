const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const WebSocket = require('ws');
const DashboardAuth = require('../../src/dashboard-auth');
const { ClaudeAnalytics } = require('../../src/analytics');
const { ChatsMobile } = require('../../src/chats-mobile');

for (const [name, Dashboard] of [['analytics', ClaudeAnalytics], ['mobile', ChatsMobile]]) {
  test(`${name} authenticates actual transcript routes before disclosing fixture data`, async t => {
    const dashboard = Object.create(Dashboard.prototype);
    dashboard.app = express();
    dashboard.dashboardAuth = new DashboardAuth();
    dashboard.data = { conversations: [{ id: 'fixture', filePath: 'fixture-only.jsonl' }] };
    dashboard.performanceMonitor = { createExpressMiddleware: () => (req, res, next) => next() };
    let reads = 0;
    dashboard.conversationAnalyzer = { getParsedConversation: async () => { reads++; return [{ role: 'user', content: 'fixture-secret' }]; } };
    if (name === 'mobile') { dashboard.setupMiddleware(); dashboard.setupRoutes(); }
    else dashboard.setupWebServer();
    const server = dashboard.app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    const route = '/api/conversations/fixture/messages';
    assert.equal((await fetch(base + route)).status, 401);
    assert.equal(reads, 0);
    const headers = { Authorization: `Bearer ${dashboard.dashboardAuth.token}` };
    assert.equal((await fetch(base + route, { headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
    const foreignHost = await new Promise((resolve, reject) => {
      require('node:http').get(base + route, { headers: { ...headers, Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
    });
    assert.equal(foreignHost, 403);
    const login = await fetch(dashboard.dashboardAuth.accessUrl(base), { redirect: 'manual' });
    assert.equal(login.status, 303);
    assert.equal(login.headers.get('location'), '/');
    assert.equal(login.headers.get('referrer-policy'), 'no-referrer');
    const cookie = login.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly; SameSite=Strict/);
    const response = await fetch(base + route, { headers: { Cookie: cookie.split(';')[0] } });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /fixture-secret/);
    assert.equal(reads, 1);
    const other = new DashboardAuth();
    assert.equal((await fetch(base + route, { headers: { Authorization: `Bearer ${other.token}` } })).status, 401);
  });
}

test('WebSocket upgrades enforce the same session and origin boundary', async t => {
  const auth = new DashboardAuth();
  const server = express() .listen(0, '127.0.0.1');
  await once(server, 'listening');
  const DashboardSocket = require('../../src/analytics/notifications/WebSocketServer');
  const socket = new DashboardSocket(server, { verifyClient: info => auth.authorized(info.req) });
  await socket.initialize();
  t.after(async () => { clearInterval(socket.heartbeatInterval); for (const ws of socket.wss.clients) ws.terminate(); await new Promise(resolve => socket.wss.close(resolve)); await new Promise(resolve => server.close(resolve)); });
  const url = `ws://127.0.0.1:${server.address().port}/ws`;
  const connect = headers => new Promise(resolve => {
    const ws = new WebSocket(url, { headers });
    ws.on('open', () => { ws.close(); resolve(101); });
    ws.on('unexpected-response', (req, res) => { res.resume(); ws.terminate(); resolve(res.statusCode); });
    ws.on('error', () => {});
  });
  assert.equal(await connect({}), 401);
  assert.equal(await connect({ Authorization: `Bearer ${auth.token}`, Origin: 'https://evil.example' }), 401);
  assert.equal(await connect({ Authorization: `Bearer ${auth.token}` }), 101);
});

for (const [name, Dashboard] of [['analytics', ClaudeAnalytics], ['mobile', ChatsMobile]]) {
  test(`${name} throttles repeated unauthorized access without blocking authenticated traffic`, async t => {
    const dashboard = Object.create(Dashboard.prototype);
    dashboard.app = express();
    dashboard.dashboardAuth = new DashboardAuth();
    dashboard.performanceMonitor = { createExpressMiddleware: () => (req, res, next) => next() };
    if (name === 'mobile') dashboard.setupMiddleware();
    else dashboard.setupWebServer();
    dashboard.app.get('/auth-test', (req, res) => res.json({ ok: true }));
    const server = dashboard.app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    for (let i = 0; i < 120; i++) assert.equal((await fetch(base + '/auth-test')).status, 401);
    assert.equal((await fetch(base + '/auth-test')).status, 429);
    assert.equal((await fetch(base + '/auth-test', { headers: { Authorization: `Bearer ${dashboard.dashboardAuth.token}` } })).status, 200);
  });
}
