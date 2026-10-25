import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const worker = (await import(new URL('./index.js', import.meta.url))).default;

function request(token, method = 'POST') {
  return new Request('https://monitor.example.test/trigger', {
    method,
    headers: token === undefined ? {} : { Authorization: token },
  });
}

test('missing or invalid trigger configuration cannot authorize work', async t => {
  const scheduled = t.mock.method(worker, 'scheduled', async () => {});
  for (const secret of [undefined, null, '', '   ', 123, false]) {
    for (const token of [undefined, `Bearer ${secret}`, 'Bearer undefined', 'Bearer null']) {
      const response = await worker.fetch(request(token), { TRIGGER_SECRET: secret });
      assert.equal(response.status, 401);
      assert.equal(await response.text(), 'Unauthorized');
    }
  }
  assert.equal(scheduled.mock.callCount(), 0);
});

test('configured trigger requires the exact bearer credential', async t => {
  const scheduled = t.mock.method(worker, 'scheduled', async () => {});
  for (const token of [undefined, 'Bearer wrong', 'test-secret', 'Basic test-secret', 'bearer test-secret']) {
    assert.equal((await worker.fetch(request(token), { TRIGGER_SECRET: 'test-secret' })).status, 401);
  }
  assert.equal(scheduled.mock.callCount(), 0);
});

test('authorized POST invokes monitoring exactly once with its original environment', async t => {
  const scheduled = t.mock.method(worker, 'scheduled', async () => {});
  const env = { TRIGGER_SECRET: 'test-secret', DOCS_MONITOR_KV: {} };
  const ctx = {};
  const response = await worker.fetch(request('Bearer test-secret'), env, ctx);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
  assert.equal(scheduled.mock.callCount(), 1);
  assert.deepEqual(scheduled.mock.calls[0].arguments, [null, env, ctx]);
});

test('GET cannot trigger monitoring even with a valid credential', async t => {
  const scheduled = t.mock.method(worker, 'scheduled', async () => {});
  await worker.fetch(request('Bearer test-secret', 'GET'), { TRIGGER_SECRET: 'test-secret' });
  assert.equal(scheduled.mock.callCount(), 0);
});

test('public status remains readable without a trigger credential', async () => {
  const response = await worker.fetch(new Request('https://monitor.example.test/status'), {
    DOCS_MONITOR_KV: { get: async () => null },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'running');
});
