const { test } = require('node:test');
const assert = require('node:assert/strict');
const Proxy = require('../../src/claude-api-proxy');

test('proxy protects reads and writes, rejects foreign hosts and origins, and binds loopback', async t => {
  const proxy = new Proxy({ port: 0, allowedOrigins: ['http://localhost:3333'] });
  let writes = 0;
  proxy.getActiveSessions = async () => [{ sessionId: 'synthetic' }];
  proxy.getConversationHistory = async () => ['synthetic'];
  proxy.sendMessageToClaude = async () => { writes++; return { ok: true }; };
  await proxy.start();
  t.after(() => new Promise(resolve => proxy.server.close(resolve)));
  assert.equal(proxy.server.address().address, '127.0.0.1');
  const base = `http://127.0.0.1:${proxy.server.address().port}`;
  const auth = { Authorization: `Bearer ${proxy.authToken}` };
  for (const route of ['/api/sessions', '/api/conversation/synthetic']) {
    assert.equal((await fetch(base + route)).status, 401);
    assert.equal((await fetch(base + route, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await fetch(base + route, { headers: auth })).status, 200);
    assert.equal((await fetch(base + route, { headers: { ...auth, Origin: 'https://attacker.example' } })).status, 403);
    const hostStatus = await new Promise((resolve, reject) => {
      require('node:http').get(base + route, { headers: { ...auth, Host: 'attacker.example' } }, res => {
        res.resume();
        resolve(res.statusCode);
      }).on('error', reject);
    });
    assert.equal(hostStatus, 403);
  }
  const body = JSON.stringify({ sessionId: 'synthetic', message: 'hello' });
  assert.equal((await fetch(base + '/api/send-message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 401);
  assert.equal(writes, 0);
  assert.equal((await fetch(base + '/api/send-message', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body })).status, 200);
  assert.equal(writes, 1);
  const allowed = await fetch(base + '/api/sessions', { headers: { ...auth, Origin: 'http://localhost:3333' } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:3333');
  assert.equal((await fetch(base + '/api/sessions', { method: 'OPTIONS', headers: { Origin: 'null' } })).status, 403);
});

test('proxy generates independent unlogged capability tokens', () => {
  const a = new Proxy();
  const b = new Proxy();
  assert.match(a.authToken, /^[a-f0-9]{64}$/);
  assert.notEqual(a.authToken, b.authToken);
});
