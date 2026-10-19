const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { SkillDashboard } = require('../../src/skill-dashboard');

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-boundary-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'skill');
  const sibling = path.join(base, 'skill-private');
  await fs.mkdir(root);
  await fs.mkdir(sibling);
  await fs.writeFile(path.join(root, 'notes.md'), 'normal content');
  await fs.writeFile(path.join(sibling, 'secret.md'), 'private secret');
  const dashboard = new SkillDashboard();
  dashboard.skills = [{ name: 'test', path: root }];
  dashboard.loadSkillsData = async () => {};
  dashboard.setupWebServer();
  const server = dashboard.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  function request(target) {
    return new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: server.address().port, path: target }, response => {
        let body = '';
        response.on('data', chunk => body += chunk);
        response.on('end', () => resolve({ status: response.statusCode, body, headers: response.headers }));
      }).on('error', reject);
    });
  }
  return { root, sibling, request };
}

test('skill preview preserves normal files and missing-file status', async t => {
  const { request } = await fixture(t);
  const ok = await request('/api/skills/test/file/notes.md');
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse(ok.body).content, 'normal content');
  assert.equal((await request('/api/skills/test/file/missing.md')).status, 404);
});

test('encoded traversal cannot read a sibling whose name shares the skill prefix', async t => {
  const { request } = await fixture(t);
  const result = await request('/api/skills/test/file/%2e%2e%2fskill-private%2fsecret.md');
  assert.equal(result.status, 403);
  assert.ok(!result.body.includes('private secret'));
});

test('external file and directory symlinks cannot escape the skill', async t => {
  const { root, sibling, request } = await fixture(t);
  await fs.symlink(path.join(sibling, 'secret.md'), path.join(root, 'external.md'));
  await fs.symlink(sibling, path.join(root, 'external'));
  for (const file of ['external.md', 'external/secret.md']) {
    const result = await request('/api/skills/test/file/' + file);
    assert.equal(result.status, 403);
    assert.ok(!result.body.includes('private secret'));
  }
});

test('internal symlinks remain usable', async t => {
  const { root, request } = await fixture(t);
  await fs.symlink(path.join(root, 'notes.md'), path.join(root, 'alias.md'));
  assert.equal(JSON.parse((await request('/api/skills/test/file/alias.md')).body).content, 'normal content');
});

test('directories are rejected', async t => {
  const { root, request } = await fixture(t);
  await fs.mkdir(path.join(root, 'folder'));
  assert.equal((await request('/api/skills/test/file/folder')).status, 403);
});

test('FIFO reads fail without waiting for a writer', { skip: process.platform === 'win32', timeout: 3000 }, async t => {
  const { root, request } = await fixture(t);
  execFileSync('mkfifo', [path.join(root, 'pipe')]);
  assert.equal((await request('/api/skills/test/file/pipe')).status, 403);
});

test('API bursts are bounded before loading skill files', async t => {
  const { request } = await fixture(t);
  for (let i = 0; i < 600; i++) assert.equal((await request('/api/skills/test/file/notes.md')).status, 200);
  const limited = await request('/api/skills/test/file/notes.md');
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers['retry-after']) > 0);
});


test('a parent swapped after canonicalization cannot expose an outside file', async t => {
  const { root, sibling, request } = await fixture(t);
  const nested = path.join(root, 'nested');
  await fs.mkdir(nested);
  await fs.writeFile(path.join(nested, 'secret.md'), 'inside');
  const extra = require('fs-extra');
  const original = extra.lstat;
  let swapped = false;
  extra.lstat = async (...args) => {
    if (!swapped && args[0] === path.join(nested, 'secret.md')) {
      swapped = true;
      await fs.rename(nested, nested + '-original');
      await fs.symlink(sibling, nested);
    }
    return original(...args);
  };
  t.after(() => { extra.lstat = original; });
  const result = await request('/api/skills/test/file/nested/secret.md');
  assert.equal(result.status, 403);
  assert.ok(!result.body.includes('private secret'));
});
