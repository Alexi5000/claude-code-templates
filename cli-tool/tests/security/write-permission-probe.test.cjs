const assert = require('node:assert/strict');
const { test, mock } = require('node:test');
const fs = require('fs-extra');
const os = require('node:os');
const path = require('node:path');
const { checkWritePermissions } = require('../../src/file-operations');

test('permission checking preserves existing files and removes its private probe', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-permissions-'));
  try {
    await fs.writeFile(path.join(root, '.claude-test-write'), 'existing project data');
    assert.equal(await checkWritePermissions(root), true);
    assert.equal(await fs.readFile(path.join(root, '.claude-test-write'), 'utf8'), 'existing project data');
    assert.deepEqual(await fs.readdir(root), ['.claude-test-write']);
  } finally { await fs.remove(root); }
});

test('a planted legacy symlink cannot overwrite another file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-permissions-'));
  try {
    const project = path.join(root, 'project');
    const external = path.join(root, 'external');
    await fs.mkdir(project);
    await fs.writeFile(external, 'private data');
    await fs.symlink(external, path.join(project, '.claude-test-write'));
    assert.equal(await checkWritePermissions(project), true);
    assert.equal(await fs.readFile(external, 'utf8'), 'private data');
    assert.ok((await fs.lstat(path.join(project, '.claude-test-write'))).isSymbolicLink());
  } finally { await fs.remove(root); }
});

test('failed writes clean the allocated directory and report failure', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-permissions-'));
  const write = mock.method(fs, 'writeFile', async () => { throw new Error('write denied'); });
  try {
    assert.equal(await checkWritePermissions(root), false);
    assert.deepEqual(await fs.readdir(root), []);
  } finally { write.mock.restore(); await fs.remove(root); }
});

test('a missing target reports failure without creating it', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-permissions-'));
  try {
    assert.equal(await checkWritePermissions(path.join(root, 'missing')), false);
    assert.deepEqual(await fs.readdir(root), []);
  } finally { await fs.remove(root); }
});
