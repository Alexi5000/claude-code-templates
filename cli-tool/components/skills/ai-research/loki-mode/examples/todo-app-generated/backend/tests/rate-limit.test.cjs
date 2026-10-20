const assert = require('node:assert/strict');
const { test } = require('node:test');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('real todo server preserves CRUD and bounds all API methods before parsing or database work', async t => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-security-'));
  fs.cpSync(path.join(__dirname, '../dist'), path.join(fixture, 'dist'), { recursive: true });
  fs.symlinkSync(path.join(__dirname, '../node_modules'), path.join(fixture, 'node_modules'), 'dir');
  const previousPort = process.env.PORT;
  process.env.PORT = '0';
  const { server } = require(path.join(fixture, 'dist/index.js'));
  if (previousPort === undefined) delete process.env.PORT;
  else process.env.PORT = previousPort;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    require(path.join(fixture, 'dist/db/database.js')).closeDatabase();
    await new Promise(resolve => require(path.join(fixture, 'dist/db/db.js')).default.close(resolve));
    fs.rmSync(fixture, { recursive: true, force: true });
  });
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = { 'Content-Type': 'application/json' };
  let response = await fetch(base + '/api/todos', { method: 'POST', headers: json, body: JSON.stringify({ title: 'security fixture' }) });
  assert.equal(response.status, 201);
  const id = (await response.json()).data.id;
  response = await fetch(base + `/api/todos/${id}`, { method: 'PATCH', headers: json, body: JSON.stringify({ completed: true }) });
  assert.equal(response.status, 200);
  await response.json();
  response = await fetch(base + `/api/todos/${id}`, { method: 'DELETE' });
  assert.equal(response.status, 200);
  await response.json();
  for (let i = 0; i < 97; i++) {
    response = await fetch(base + '/api/todos');
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, []);
  }
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    const suffix = method === 'PATCH' || method === 'DELETE' ? '/1' : '';
    response = await fetch(base + '/api/todos' + suffix, {
      method,
      headers: { ...json, 'X-Forwarded-For': '203.0.113.9' },
      ...(method === 'POST' || method === 'PATCH' ? { body: '{broken-json' } : {}),
    });
    assert.equal(response.status, 429);
    assert.ok(Number(response.headers.get('retry-after')) > 0);
    assert.equal((await response.json()).success, false);
  }
  response = await fetch(base + '/health');
  assert.equal(response.status, 200);
  await response.json();
});
