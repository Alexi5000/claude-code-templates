const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

test('local sandbox rejects foreign callers and keeps prompts out of the shell', { skip: process.platform === 'win32' }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-boundary-'));
  const originalCwd = process.cwd();
  const originalPath = process.env.PATH;
  t.after(async () => {
    process.chdir(originalCwd);
    process.env.PATH = originalPath;
    await fs.rm(dir, { recursive: true, force: true });
  });
  process.chdir(dir);
  process.env.PATH = `${dir}${path.delimiter}${originalPath}`;
  const received = path.join(dir, 'received.json');
  const marker = path.join(dir, 'shell-executed');
  const install = path.join(dir, 'install.json');
  for (const [name, target] of [['claude', received], ['npx', install]]) {
    await fs.writeFile(path.join(dir, name), `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(target)}, JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o700 });
  }
  const app = require('../../src/sandbox-server');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (endpoint, body, headers = {}) => fetch(base + endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const prompt = `Write a clear summary; touch ${marker}; $(touch ${marker})`;
  assert.equal((await post('/api/execute', { prompt }, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await post('/api/execute', { prompt }, { Origin: 'null' })).status, 403);
  const rebindingStatus = await new Promise((resolve, reject) => {
    const req = http.get(base + '/api/tasks', { headers: { Host: 'attacker.example' } }, res => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
  });
  assert.equal(rebindingStatus, 403);
  for (const agentName of ['../escape', 'name;touch bad', 'x$(id)', '--help', {}, 'a\\b']) {
    assert.equal((await post('/api/install-agent', { agentName })).status, 400);
    assert.equal((await post('/api/execute', { prompt, agent: agentName })).status, 400);
  }
  assert.equal((await post('/api/execute', { prompt: {}, agent: 'valid' })).status, 400);
  assert.equal((await post('/api/execute', { prompt, mode: 'unexpected' })).status, 400);
  const accepted = await post('/api/execute', { prompt }, { Origin: base });
  assert.equal(accepted.status, 200);
  const { taskId } = await accepted.json();
  for (let count = 0; count < 100; count++) {
    const state = await (await fetch(`${base}/api/task/${taskId}`)).json();
    if (state.task.status === 'completed') break;
    assert.notEqual(state.task.status, 'failed');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.deepEqual(JSON.parse(await fs.readFile(received, 'utf8')), ['--', prompt]);
  await assert.rejects(fs.access(marker), { code: 'ENOENT' });
  const installed = await post('/api/install-agent', { agentName: 'development-team/frontend-developer' });
  assert.equal(installed.status, 200);
  assert.deepEqual(JSON.parse(await fs.readFile(install, 'utf8')), ['claude-code-templates@latest', '--agent', 'development-team/frontend-developer', '--yes']);
});
