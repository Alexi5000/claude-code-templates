const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {downloadE2BComponent} = require('../../src/e2b-components');

test('fallback accepts only the packaged component bytes from the pinned fork revision', async t => {
  const requested = [];
  t.mock.method(globalThis, 'fetch', async url => {
    requested.push(url);
    const name = url.split('/').at(-1);
    return {ok: true, text: async () => fs.readFileSync(path.join(__dirname, '../../components/sandbox/e2b', name), 'utf8')};
  });
  for (const name of ['e2b-launcher.py', 'requirements.txt', '.env.example']) {
    const content = await downloadE2BComponent(name);
    assert.equal(content, fs.readFileSync(path.join(__dirname, '../../components/sandbox/e2b', name), 'utf8'));
  }
  assert.ok(requested.every(url => /^https:\/\/raw\.githubusercontent\.com\/Alexi5000\/claude-code-templates\/[a-f0-9]{40}\//.test(url)));
});

test('fallback rejects modified executable bytes and unknown paths', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return {ok: true, text: async () => 'unexpected executable'};
  });
  await assert.rejects(downloadE2BComponent('e2b-launcher.py'), /integrity check failed/);
  await assert.rejects(downloadE2BComponent('../other.py'), /Unknown E2B component/);
  assert.equal(requests, 1);
});
