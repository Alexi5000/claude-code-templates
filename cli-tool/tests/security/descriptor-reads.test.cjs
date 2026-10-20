const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');
const { analyzeCommands } = require('../../src/command-stats');
const { TeamsDashboard } = require('../../src/teams-dashboard');
const DataCache = require('../../src/analytics/data/DataCache');

async function fixture(t) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'descriptor-reads-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const commands = path.join(root, '.claude', 'commands');
  await fs.promises.mkdir(commands, { recursive: true });
  const file = path.join(commands, 'test.md');
  await fs.promises.writeFile(file, '# Normal\nlast line\n');
  const cache = new DataCache();
  t.after(() => cache.cleanup());
  return { root, file, cache, dashboard: new TeamsDashboard() };
}

test('commands, analytics cache and tail preserve regular-file results', async t => {
  const { root, file, cache, dashboard } = await fixture(t);
  const result = await analyzeCommands(root);
  assert.equal(result.commands[0].title, 'Normal');
  assert.equal(result.totalSize, Buffer.byteLength('# Normal\nlast line\n'));
  assert.equal(await dashboard.readLastLine(file), 'last line');
  assert.equal(await cache.getFileContent(file), '# Normal\nlast line\n');
  assert.equal(await cache.getFileContent(file), '# Normal\nlast line\n');
  assert.equal(cache.metrics.hits, 1);
  await fs.promises.writeFile(file, '');
  assert.equal(await dashboard.readLastLine(file), null);
  assert.equal(await cache.getFileContent(file), '');
});

test('a replacement inode with preserved mtime cannot reuse cached contents', async t => {
  const { file, cache } = await fixture(t);
  await cache.getFileContent(file);
  const stats = await fs.promises.stat(file);
  const replacement = file + '.replacement';
  await fs.promises.writeFile(replacement, '# Change\nlast line\n');
  await fs.promises.utimes(replacement, stats.atime, stats.mtime);
  await fs.promises.rename(replacement, file);
  assert.equal(await cache.getFileContent(file), '# Change\nlast line\n');
});

for (const reader of ['commands', 'cache', 'tail']) {
  test(`${reader} rejects symlinks without reading their target`, { skip: process.platform === 'win32' }, async t => {
    const { root, file, cache, dashboard } = await fixture(t);
    const secret = path.join(root, 'secret');
    await fs.promises.writeFile(secret, 'private contents');
    await fs.promises.unlink(file);
    await fs.promises.symlink(secret, file);
    if (reader === 'commands') assert.match((await analyzeCommands(root)).error, /ELOOP/);
    if (reader === 'cache') await assert.rejects(cache.getFileContent(file), { code: 'ELOOP' });
    if (reader === 'tail') assert.equal(await dashboard.readLastLine(file), null);
  });
}

test('path replacement after open cannot redirect any reader', async t => {
  const { root, file, cache, dashboard } = await fixture(t);
  const fsExtra = require('fs-extra');
  const originalOpen = fs.promises.open;
  const originalStat = fsExtra.stat;
  async function replace() {
    const replacement = file + '.replacement';
    await fs.promises.writeFile(replacement, 'private replacement');
    await fs.promises.rename(replacement, file);
  }
  fsExtra.stat = async function (filename, ...args) {
    const stats = await originalStat.call(this, filename, ...args);
    if (filename === file) await replace();
    return stats;
  };
  fs.promises.open = async function (filename, ...args) {
    const handle = await originalOpen.call(this, filename, ...args);
    const stat = handle.stat.bind(handle);
    handle.stat = async () => {
      const stats = await stat();
      if (filename === file) await replace();
      return stats;
    };
    return handle;
  };
  t.after(() => {
    fs.promises.open = originalOpen;
    fsExtra.stat = originalStat;
  });
  assert.equal(await dashboard.readLastLine(file), 'last line');
  await fs.promises.writeFile(file, '# Normal\nlast line\n');
  assert.equal(await cache.getFileContent(file), '# Normal\nlast line\n');
  await fs.promises.writeFile(file, '# Normal\nlast line\n');
  assert.equal((await analyzeCommands(root)).commands[0].title, 'Normal');
});

test('nonregular files fail without blocking the caller', { skip: process.platform === 'win32' }, async t => {
  const { root, file } = await fixture(t);
  await fs.promises.unlink(file);
  execFileSync('mkfifo', [file]);
  const script = `
    const { analyzeCommands } = require('./src/command-stats');
    const { TeamsDashboard } = require('./src/teams-dashboard');
    const DataCache = require('./src/analytics/data/DataCache');
    (async () => {
      const cache = new DataCache();
      try {
        if (!(await analyzeCommands(process.argv[1])).error) throw Error('commands accepted FIFO');
        if (await new TeamsDashboard().readLastLine(process.argv[2]) !== null) throw Error('tail accepted FIFO');
        let rejected = false;
        try { await cache.getFileContent(process.argv[2]); } catch { rejected = true; }
        if (!rejected) throw Error('cache accepted FIFO');
      } finally { cache.cleanup(); }
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ['-e', script, root, file], {
    cwd: path.resolve(__dirname, '../..'), timeout: 3000, encoding: 'utf8'
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

test('opened descriptors close when reading fails', async t => {
  const { cache, file } = await fixture(t);
  const originalOpen = fs.promises.open;
  let closed = false;
  fs.promises.open = async function (...args) {
    const handle = await originalOpen.apply(this, args);
    const close = handle.close.bind(handle);
    handle.readFile = async () => { throw new Error('read failure'); };
    handle.close = async () => { closed = true; return close(); };
    return handle;
  };
  t.after(() => { fs.promises.open = originalOpen; });
  await assert.rejects(cache.getFileContent(file), /read failure/);
  assert.equal(closed, true);
  assert.equal(cache.caches.fileContent.has(file), false);
});
