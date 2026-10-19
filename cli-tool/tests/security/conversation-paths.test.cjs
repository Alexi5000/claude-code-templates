const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const ClaudeAPIProxy = require('../../src/claude-api-proxy');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'conversation-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const proxy = new ClaudeAPIProxy();
  proxy.claudeDir = path.join(root, '.claude');
  const project = path.join(proxy.claudeDir, 'projects', 'home-project');
  await fs.mkdir(project, { recursive: true });
  const conversation = path.join(project, 'session-1.jsonl');
  await fs.writeFile(conversation, JSON.stringify({ type: 'user', message: { content: 'hello' } }) + '\n');
  const outside = path.join(root, 'private.jsonl');
  await fs.writeFile(outside, 'private-content\n');
  return { root, proxy, project, conversation, outside };
}

test('normal project lookup, history and append retain conversation contents', async t => {
  const { proxy, conversation } = await fixture(t);
  assert.equal(await proxy.findConversationFile('session-1', '/home/project'), conversation);
  assert.equal(await proxy.findConversationFile('session-1'), conversation);
  assert.equal(proxy.encodeProjectPath('C:\\home\\project'), 'C:-home-project');
  await proxy.appendToConversation(conversation, { type: 'user', message: { content: 'second' } });
  assert.equal((await proxy.getConversationHistory('session-1')).length, 2);
  assert.equal((await proxy.getActiveSessions())[0].messageCount, 2);
});

test('session IDs reject traversal, separators, controls and nonstrings', async t => {
  const { proxy, outside } = await fixture(t);
  for (const id of ['../private', '..\\private', '/private', 'a/b', 'a\0b', '', {}, ['session-1'], 'x'.repeat(129)]) {
    await assert.rejects(proxy.findConversationFile(id), { status: 400 });
  }
  await assert.rejects(proxy.findConversationFile('session-1', {}), { status: 400 });
  assert.equal(await fs.readFile(outside, 'utf8'), 'private-content\n');
});

test('symlinked conversation and project cannot read or append outside the root', async t => {
  const { proxy, project, outside, root } = await fixture(t);
  await fs.symlink(outside, path.join(project, 'escape.jsonl'));
  await fs.symlink(root, path.join(proxy.claudeDir, 'projects', 'external'));
  await assert.rejects(proxy.getConversationHistory('escape'), { status: 400 });
  assert.equal(await proxy.findConversationFile('private', '/external'), null);
  await assert.rejects(proxy.appendToConversation(path.join(project, 'escape.jsonl'), { attack: true }), { status: 400 });
  assert.equal((await proxy.getActiveSessions()).length, 1);
  assert.equal(await fs.readFile(outside, 'utf8'), 'private-content\n');
});

test('a conversation replaced with an external symlink after lookup is rejected', async t => {
  const { proxy, conversation, outside } = await fixture(t);
  const found = await proxy.findConversationFile('session-1');
  await fs.unlink(conversation);
  await fs.symlink(outside, conversation);
  await assert.rejects(proxy.appendToConversation(found, { attack: true }), { status: 400 });
  assert.equal(await fs.readFile(outside, 'utf8'), 'private-content\n');
});

test('nonregular conversations fail without waiting for a FIFO writer', { skip: process.platform === 'win32', timeout: 3000 }, async t => {
  const { proxy, project } = await fixture(t);
  const fifo = path.join(project, 'pipe.jsonl');
  execFileSync('mkfifo', [fifo]);
  await assert.rejects(proxy.getConversationHistory('pipe'), { status: 400 });
});

test('HTTP requests reject encoded traversal and preserve valid history', async t => {
  const { proxy } = await fixture(t);
  const server = proxy.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const valid = await fetch(`${base}/api/conversation/session-1`);
  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).conversation.length, 1);
  const invalid = await fetch(`${base}/api/conversation/..%2Fprivate`);
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: 'Invalid conversation path' });
  const write = await fetch(`${base}/api/send-message`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: '../private', message: 'attack' }),
  });
  assert.equal(write.status, 400);
});
