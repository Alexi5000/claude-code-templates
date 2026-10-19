import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./index.js', import.meta.url), 'utf8');
const worker = (await import(`data:text/javascript,${encodeURIComponent(source)}`)).default;
const env = { DASHBOARD_URL: 'https://dashboard.example.test', TRIGGER_SECRET: 'test-shared-secret' };

function request(query = '', token = env.TRIGGER_SECRET) {
  return new Request(`https://cron.example.test/trigger${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

test('both schedules call only their configured HTTPS dashboard endpoint', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push([url.toString(), options]);
    return new Response('ok');
  });
  await worker.scheduled({ cron: '*/30 * * * *' }, env);
  await worker.scheduled({ cron: '0 * * * *' }, env);
  assert.deepEqual(calls.map(([url]) => url), [
    'https://dashboard.example.test/api/claude-code-check',
    'https://dashboard.example.test/api/health-check',
  ]);
  for (const [, options] of calls) {
    assert.equal(options.headers.Authorization, 'Bearer test-shared-secret');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
  }
});

test('missing or unsafe configuration makes no network request', async t => {
  const fetch = t.mock.method(globalThis, 'fetch');
  for (const config of [
    {}, { ...env, DASHBOARD_URL: '' }, { ...env, TRIGGER_SECRET: '' },
    { ...env, TRIGGER_SECRET: '   ' },
    ...['http://dashboard.example.test', 'https://user:pass@dashboard.example.test',
      'https://dashboard.example.test/path', 'https://dashboard.example.test/?key=x',
      'https://dashboard.example.test/#fragment', 'not a URL'].map(DASHBOARD_URL => ({ ...env, DASHBOARD_URL })),
  ]) {
    await assert.rejects(worker.scheduled({ cron: '*/30 * * * *' }, config));
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('manual triggers reject unauthorized and unsupported requests', async t => {
  const fetch = t.mock.method(globalThis, 'fetch');
  assert.equal((await worker.fetch(request('', 'wrong'), env)).status, 401);
  assert.equal((await worker.fetch(request(), { ...env, TRIGGER_SECRET: '' })).status, 401);
  assert.equal((await worker.fetch(request('?cron=unknown'), env)).status, 400);
  await assert.rejects(worker.scheduled({ cron: 'unknown' }, env), /Unsupported/);
  assert.equal(fetch.mock.callCount(), 0);
});

test('dashboard failures fail scheduled runs and manual triggers', async t => {
  for (const status of [301, 401, 429, 500, 503]) {
    t.mock.method(globalThis, 'fetch', async () => new Response('private error body', { status }));
    await assert.rejects(worker.scheduled({ cron: '0 * * * *' }, env), new RegExp(`status ${status}`));
    const response = await worker.fetch(request(), env);
    assert.equal(response.status, 502);
    assert.equal(await response.text(), 'Dashboard cron failed');
    t.mock.restoreAll();
  }
});

test('transport failures propagate and manual responses do not leak details', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('private transport details'); });
  await assert.rejects(worker.scheduled({ cron: '0 * * * *' }, env));
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 502);
  assert.equal(await response.text(), 'Dashboard cron failed');
});

test('valid manual trigger returns success only after dashboard success', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('ok'));
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'Triggered: */30 * * * *');
});
