const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter, once } = require('node:events');
const childProcess = require('node:child_process');
const { spawnBounded, outputBuffer, requestBudget, isBusy } = require('../../src/sandbox-limits');

test('real subprocess slots reject overload and recover after exit and spawn errors', async () => {
  const children = Array.from({ length: 4 }, () => spawnBounded(process.execPath, ['-e', 'setTimeout(() => {}, 100)'], { stdio: 'ignore' }));
  await Promise.all(children.map(child => once(child, 'spawn')));
  try {
    assert.equal(isBusy(), true);
    assert.throws(() => spawnBounded(process.execPath, ['-e', 'process.exit()'], {}), /busy/);
  } finally {
    await Promise.all(children.map(async child => {
      const closed = once(child, 'close');
      await closed;
    }));
  }
  assert.equal(isBusy(), false);
  const missing = spawnBounded('/no-such-sandbox-executable', [], {});
  await new Promise(resolve => missing.once('error', resolve));
  assert.equal(isBusy(), false);
});

test('output retention bounds both giant chunks and many tiny lines', () => {
  const output = outputBuffer();
  output.push('x'.repeat(1000000));
  assert.equal(output.join('').length, 65536);
  for (let i = 0; i < 10000; i++) output.push('x');
  output.push('latest result');
  assert.ok(output.length <= 512);
  assert.ok(output.join('').length <= 65536);
  assert.equal(output.at(-1), 'latest result');
});

test('request budget rejects overload and restores service next minute', () => {
  const original = Date.now;
  let now = 1000;
  Date.now = () => now;
  try {
    const budget = requestBudget(2);
    let accepted = 0;
    let status;
    const res = { set: () => {}, status: value => { status = value; return res; }, json: () => {} };
    for (let i = 0; i < 3; i++) budget({}, res, () => accepted++);
    assert.equal(accepted, 2);
    assert.equal(status, 429);
    now += 60000;
    budget({}, res, () => accepted++);
    assert.equal(accepted, 3);
  } finally { Date.now = original; }
});

test('HTTP routes share subprocess admission, cap payloads, and retain status polling', async t => {
  const original = childProcess.spawn;
  const children = [];
  childProcess.spawn = (command, args, options) => {
    assert.equal(options.timeout, undefined);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    children.push(child);
    return child;
  };
  delete require.cache[require.resolve('../../src/sandbox-limits')];
  delete require.cache[require.resolve('../../src/sandbox-server')];
  const app = require('../../src/sandbox-server');
  childProcess.spawn = original;
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    for (const child of children) child.emit('close', 0);
    return new Promise(resolve => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post('/api/execute', { prompt: 'x'.repeat(16001) })).status, 400);
  assert.equal((await post('/api/execute', { prompt: 'x'.repeat(40000) })).status, 413);
  const ids = [];
  for (let i = 0; i < 4; i++) {
    const response = await post('/api/execute', { prompt: 'summarize this project' });
    assert.equal(response.status, 200);
    ids.push((await response.json()).taskId);
  }
  assert.equal((await post('/api/execute', { prompt: 'summarize this project' })).status, 429);
  assert.equal((await post('/api/install-agent', { agentName: 'valid-agent' })).status, 429);
  assert.equal(children.length, 4);
  children[0].stdout.emit('data', Buffer.from('x'.repeat(1000000)));
  const result = await (await fetch(`${base}/api/task/${ids[0]}`)).json();
  assert.ok(result.task.output.length <= 66560);
  children[0].emit('close', 0);
  const installation = post('/api/install-agent', { agentName: 'valid-agent' });
  while (children.length < 5) await new Promise(resolve => setTimeout(resolve, 5));
  children[4].emit('error', new Error('test spawn failure'));
  children[4].emit('close', -1);
  assert.equal((await installation).status, 500);
  assert.equal((await post('/api/execute', { prompt: 'summarize this project' })).status, 200);
});

test('deadline force-kills stuck child and keeps its slot until close', t => {
  const original = childProcess.spawn;
  const child = new EventEmitter();
  let signal;
  child.kill = value => { signal = value; };
  childProcess.spawn = () => child;
  delete require.cache[require.resolve('../../src/sandbox-limits')];
  const limits = require('../../src/sandbox-limits');
  childProcess.spawn = original;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  limits.spawnBounded('stuck-child', [], {});
  t.mock.timers.tick(300000);
  assert.equal(signal, 'SIGKILL');
  child.emit('close', null);
  t.mock.timers.reset();
});

test('spawned-child errors cannot release admission before close', t => {
  const originalSpawn = childProcess.spawn;
  const originalKill = process.kill;
  const children = [];
  const signals = [];
  childProcess.spawn = (command, args, options) => {
    assert.equal(options.detached, process.platform !== 'win32');
    const child = new EventEmitter();
    child.pid = 900000 + children.length;
    child.kill = signal => signals.push([child.pid, signal]);
    children.push(child);
    return child;
  };
  process.kill = (pid, signal) => { signals.push([pid, signal]); return true; };
  delete require.cache[require.resolve('../../src/sandbox-limits')];
  const limits = require('../../src/sandbox-limits');
  childProcess.spawn = originalSpawn;
  t.after(() => { process.kill = originalKill; });
  for (let i = 0; i < 4; i++) limits.spawnBounded('fake-child', [], {});
  children[0].emit('error', new Error('post-spawn operation failed'));
  assert.equal(limits.isBusy(), true);
  for (const child of children) {
    child.emit('exit', 1);
    child.emit('close', 1);
  }
  assert.equal(limits.isBusy(), false);
  if (process.platform !== 'win32') {
    assert.deepEqual(signals, children.map(child => [-child.pid, 'SIGKILL']));
  }
});
