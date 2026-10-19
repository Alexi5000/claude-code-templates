const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnBounded, isBusy } = require('../../src/sandbox-limits');

for (const finishNormally of [false, true]) {
  test(`POSIX process group stops grandchildren on ${finishNormally ? 'parent exit' : 'deadline'}`, { skip: process.platform === 'win32', timeout: 10000 }, async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-tree-'));
    const heartbeat = path.join(dir, 'heartbeat');
    const pidFile = path.join(dir, 'grandchild');
    const grandchild = `const fs = require('node:fs');
      fs.appendFileSync(${JSON.stringify(heartbeat)}, 'x');
      process.send('ready');
      setInterval(() => fs.appendFileSync(${JSON.stringify(heartbeat)}, 'x'), 20);`;
    const parent = `const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], {stdio: ['ignore', 'inherit', 'inherit', 'ipc']});
      child.on('message', () => {
        require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
        ${finishNormally ? 'process.exit(0);' : 'setInterval(() => {}, 1000);'}
      });`;
    const child = spawnBounded(process.execPath, ['-e', parent], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 1200 });
    t.after(async () => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      await fs.rm(dir, { recursive: true, force: true });
    });
    const closed = once(child, 'close');
    await closed;
    const pid = Number(await fs.readFile(pidFile, 'utf8'));
    assert.ok(pid > 0);
    const stopped = await fs.readFile(heartbeat, 'utf8');
    assert.ok(stopped.length > 0);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(await fs.readFile(heartbeat, 'utf8'), stopped);
    if (process.platform === 'linux') {
      try {
        const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
        assert.equal(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0], 'Z');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    assert.equal(isBusy(), false);
  });
}
