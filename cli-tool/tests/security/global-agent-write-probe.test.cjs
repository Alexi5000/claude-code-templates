const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');

function loadProbe(directory) {
  const source = fs.readFileSync(path.join(__dirname, '../../src/sdk/global-agent-manager.js'), 'utf8');
  const start = source.indexOf('const isSystemWritable = ') + 'const isSystemWritable = '.length;
  const end = source.indexOf('\n};', start) + 2;
  return vm.runInNewContext('(' + source.slice(start, end) + ')', {fs, path, require, SYSTEM_BIN_DIR: directory});
}

test('write probe does not overwrite or remove a pre-existing fixed-name symlink', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'global-write-probe-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const directory = path.join(root, 'bin');
  fs.mkdirSync(directory);
  const protectedFile = path.join(root, 'protected');
  fs.writeFileSync(protectedFile, 'unchanged');
  const existing = path.join(directory, '.test-write');
  fs.symlinkSync(protectedFile, existing);
  assert.equal(loadProbe(directory)(), true);
  assert.equal(fs.readFileSync(protectedFile, 'utf8'), 'unchanged');
  assert.equal(fs.lstatSync(existing).isSymbolicLink(), true);
  assert.deepEqual(fs.readdirSync(directory), ['.test-write']);
});

test('write probe fails cleanly for a directory that cannot be created', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'global-write-probe-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const file = path.join(root, 'file');
  fs.writeFileSync(file, 'unchanged');
  assert.equal(loadProbe(file)(), false);
  assert.equal(fs.readFileSync(file, 'utf8'), 'unchanged');
});
