const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const SessionSharing = require('../../src/session-sharing');

test('session curl arguments remain inert, temporary exports are private and cleaned', { skip: process.platform === 'win32' }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-transfer-test-'));
  const originalPath = process.env.PATH;
  const report = path.join(dir, 'report.json');
  t.after(async () => {
    process.env.PATH = originalPath;
    await fs.rm(dir, { recursive: true, force: true });
  });
  const executable = path.join(dir, 'curl');
  await fs.writeFile(executable, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const upload = args.includes('-F');
const file = upload ? args[args.indexOf('-F') + 1].slice(6) : null;
fs.writeFileSync(${JSON.stringify(report)}, JSON.stringify({ args, file,
  fileMode: file ? fs.statSync(file).mode & 0o777 : null,
  dirMode: file ? fs.statSync(path.dirname(file)).mode & 0o777 : null,
  data: file ? fs.readFileSync(file, 'utf8') : null
}));
console.log(upload ? 'https://x0.at/result' : JSON.stringify({ version: '1', messages: [] }));
`, { mode: 0o700 });
  process.env.PATH = `${dir}${path.delimiter}${originalPath}`;
  const sharing = new SessionSharing({});
  const marker = path.join(dir, 'shell-executed');
  const hostileUrl = `https://example.com/$(touch ${marker})`;
  assert.equal((await sharing.downloadSession(hostileUrl)).version, '1');
  let captured = JSON.parse(await fs.readFile(report, 'utf8'));
  assert.equal(captured.args.at(-1), hostileUrl);
  assert.equal(captured.args.at(-2), '--');
  assert.equal(captured.args[captured.args.indexOf('--proto-redir') + 1], '=http,https');
  await assert.rejects(fs.access(marker), { code: 'ENOENT' });
  for (const url of ['file:///etc/passwd', 'ftp://example.com/data', 'https://name:secret@example.com']) {
    await assert.rejects(sharing.downloadSession(url), /HTTP or HTTPS/);
  }
  const session = { private: 'conversation content' };
  assert.equal(await sharing.uploadToX0(session, `../../$(touch ${marker})`), 'https://x0.at/result');
  captured = JSON.parse(await fs.readFile(report, 'utf8'));
  assert.equal(captured.args.at(-1), 'https://x0.at');
  assert.equal(captured.fileMode, 0o600);
  assert.equal(captured.dirMode, 0o700);
  assert.deepEqual(JSON.parse(captured.data), session);
  assert.equal(path.basename(captured.file), 'session.json');
  await assert.rejects(fs.access(path.dirname(captured.file)), { code: 'ENOENT' });
  await assert.rejects(fs.access(marker), { code: 'ENOENT' });

  await fs.writeFile(executable, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(report)}, JSON.stringify({file: args[args.indexOf('-F') + 1].slice(6)}));
process.exit(1);
`, { mode: 0o700 });
  await assert.rejects(sharing.uploadToX0(session, 'normal-id'));
  captured = JSON.parse(await fs.readFile(report, 'utf8'));
  await assert.rejects(fs.access(path.dirname(captured.file)), { code: 'ENOENT' });
});

test('remote conversation identifiers cannot escape the import directory', async () => {
  const sharing = new SessionSharing({});
  for (const id of ['../../escape', '/tmp/escape', 'a\\b', {}, 'x'.repeat(201), '--flag']) {
    await assert.rejects(sharing.installSession({ conversation: { id }, messages: [] }), /Invalid session conversation ID/);
  }
});
