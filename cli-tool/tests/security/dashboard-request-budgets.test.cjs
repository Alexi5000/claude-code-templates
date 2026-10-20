const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const { ClaudeAnalytics } = require('../../src/analytics');
const { ChatsMobile } = require('../../src/chats-mobile');
const { TeamsDashboard } = require('../../src/teams-dashboard');
const { PluginDashboard } = require('../../src/plugin-dashboard');

function dashboard(kind, recordWork) {
  const classes = { analytics: ClaudeAnalytics, mobile: ChatsMobile, teams: TeamsDashboard, plugins: PluginDashboard };
  const app = Object.create(classes[kind].prototype);
  app.app = express();
  app.data = { conversations: [{ id: 'test-session', filePath: 'fixture.jsonl' }] };
  app.sessions = [];
  app.performanceMonitor = { createExpressMiddleware: () => (req, res, next) => next() };
  app.loadInitialData = async () => recordWork();
  app.discoverTeamSessions = async () => { recordWork(); return []; };
  app.loadPluginData = async () => recordWork();
  app.conversationAnalyzer = { getParsedConversation: async () => { recordWork(); return []; } };
  if (kind === 'mobile') {
    app.setupMiddleware();
    app.setupRoutes();
  } else {
    app.setupWebServer();
  }
  return app;
}

async function serve(t, app) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

for (const [kind, route] of Object.entries({
  analytics: '/api/refresh', mobile: '/api/conversations/test-session/messages',
  teams: '/api/sessions', plugins: '/api/plugins',
})) {
  test(`${kind} bounds real API work, keeps static UI available, and resets next minute`, async t => {
    let now = 100000;
    t.mock.method(Date, 'now', () => now);
    let work = 0;
    const instance = dashboard(kind, () => work++);
    const base = await serve(t, instance.app);
    for (let i = 0; i < 600; i++) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200);
      await response.json();
    }
    assert.equal(work, 600);
    const blocked = await fetch(base + route, { headers: { 'X-Forwarded-For': '203.0.113.5' } });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('retry-after'), '60');
    assert.equal((await blocked.json()).success, false);
    const alternate = await fetch(base + '/api/not-a-route');
    assert.equal(alternate.status, 429);
    await alternate.json();
    assert.equal(work, 600);
    const page = await fetch(base + '/');
    assert.equal(page.status, 200);
    await page.text();
    if (kind === 'mobile') {
      const malformed = await fetch(base + '/api/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid',
      });
      assert.equal(malformed.status, 429);
      await malformed.json();
    }
    now += 60000;
    const recovered = await fetch(base + route);
    assert.equal(recovered.status, 200);
    await recovered.json();
    assert.equal(work, 601);
  });
}

test('mobile search logs only aggregate metadata while preserving search results', async t => {
  const logs = [];
  t.mock.method(console, 'log', (...args) => logs.push(args));
  const instance = dashboard('mobile', () => {});
  const id = 'private-conversation-%s';
  const query = 'private-search-term';
  instance.data.conversations = [{ id, filePath: 'fixture.jsonl' }];
  instance.conversationAnalyzer.getParsedConversation = async () => [{ content: query, id: 'message', role: 'user' }];
  const base = await serve(t, instance.app);
  const response = await fetch(base + '/api/conversations/' + encodeURIComponent(id) + '/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.totalMatches, 1);
  assert.equal(result.query, query);
  assert.equal(result.conversationId, id);
  assert.equal(logs.length, 1);
  assert.equal(logs[0][0], 'Conversation search completed:');
  assert.equal(logs[0][1].messagesWithMatches, 1);
  assert.equal(JSON.stringify(logs).includes(query), false);
  assert.equal(JSON.stringify(logs).includes(id), false);
});
