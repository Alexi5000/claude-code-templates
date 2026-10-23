const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('fs-extra');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {writeSandboxFile, validateComponentName} = require('../../components/sandbox/cloudflare/safe-output.cjs');

function installer(name, extra = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../../src/index.js'), 'utf8');
  const start = source.indexOf(`async function ${name}(`);
  const next = source.indexOf('\nasync function ', start + 1);
  const end = next === -1 ? source.indexOf('\nmodule.exports', start) : next;
  return vm.runInNewContext(`(${source.slice(start, end)})`, {
    fs, path, process, writeSandboxFile, validateComponentName,
    downloadE2BComponent: async () => 'downloaded content',
    chalk: new Proxy({}, {get: () => x => x}),
    console: {log() {}},
    trackingService: {trackDownload() {}, trackInstallationOutcome() {}},
    fetch: async () => ({ok: true, text: async () => 'downloaded content'}),
    ...extra,
  });
}

for (const [name, directory] of [['installIndividualAgent', 'agents'], ['installIndividualCommand', 'commands']]) {
  test(`${directory} installer preserves normal installs and rejects linked parents and leaves`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'installer-boundary-'));
    t.after(() => fs.removeSync(root));
    const project = path.join(root, 'project');
    fs.ensureDirSync(project);
    const install = installer(name);
    assert.equal(await install('category/normal', project, {silent: true}), true);
    const output = path.join(project, '.claude', directory, 'normal.md');
    assert.equal(fs.readFileSync(output, 'utf8'), 'downloaded content');
    assert.equal(await install('category/normal', project, {silent: true}), true);
    const outside = path.join(root, 'outside');
    fs.ensureDirSync(outside);
    const protectedFile = path.join(outside, 'normal.md');
    fs.writeFileSync(protectedFile, 'protected');
    for (const link of ['symlink', 'hardlink']) {
      fs.removeSync(output);
      if (link === 'symlink') fs.symlinkSync(protectedFile, output);
      else fs.linkSync(protectedFile, output);
      assert.equal(await install('category/normal', project, {silent: true}), false);
      assert.equal(fs.readFileSync(protectedFile, 'utf8'), 'protected');
    }
    fs.removeSync(path.join(project, '.claude'));
    fs.symlinkSync(outside, path.join(project, '.claude'));
    assert.equal(await install('category/normal', project, {silent: true}), false);
    assert.equal(fs.readFileSync(protectedFile, 'utf8'), 'protected');
    await assert.rejects(install('../normal', project, {silent: true}), /Invalid component/);
  });
}

test('protected executable output sets mode on its validated descriptor', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'installer-mode-'));
  t.after(() => fs.removeSync(root));
  writeSandboxFile(root, '.claude/sandbox/e2b-launcher.py', 'launcher', 0o755);
  assert.equal(fs.readFileSync(path.join(root, '.claude/sandbox/e2b-launcher.py'), 'utf8'), 'launcher');
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(root, '.claude/sandbox/e2b-launcher.py')).mode & 0o777, 0o755);
});

test('E2B downloaded setup files reject linked targets before Python starts', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'installer-e2b-'));
  t.after(() => fs.removeSync(root));
  let started = false;
  const install = installer('executeE2BSandbox', {
    __dirname: path.join(root, 'missing-package', 'src'),
    ora: () => ({start() {return this;}, fail() {}, succeed() {}}),
    require: name => {
      if (name === 'inquirer') return {prompt: async () => ({shouldExecuteSandbox: true})};
      started = true;
      throw new Error('test stops before Python execution');
    },
  });
  for (const name of ['e2b-launcher.py', 'requirements.txt', '.env.example']) {
    const project = path.join(root, name.replaceAll('.', '-') + '-project');
    const sandbox = path.join(project, '.claude', 'sandbox');
    fs.ensureDirSync(sandbox);
    const outside = path.join(root, name + '-protected');
    fs.writeFileSync(outside, 'protected');
    fs.symlinkSync(outside, path.join(sandbox, name));
    started = false;
    await install({prompt: 'fixture'}, project);
    assert.equal(started, false);
    assert.equal(fs.readFileSync(outside, 'utf8'), 'protected');
  }
});

test('template regular file writes cannot follow an existing symlink', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'installer-template-'));
  t.after(() => fs.removeSync(root));
  const project = path.join(root, 'project');
  fs.ensureDirSync(project);
  const outside = path.join(root, 'protected.md');
  fs.writeFileSync(outside, 'protected');
  fs.symlinkSync(outside, path.join(project, 'CLAUDE.md'));
  t.mock.method(globalThis, 'fetch', async () => ({ok: true, text: async () => 'new instructions'}));
  const {copyTemplateFiles} = require('../../src/file-operations');
  await copyTemplateFiles({files: [{source: 'fixture-regular.md', destination: 'CLAUDE.md'}]}, project, {yes: true});
  assert.equal(fs.readFileSync(outside, 'utf8'), 'protected');
});

test('an explicitly selected root alias remains usable while descendant symlinks reject', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'installer-root-alias-'));
  t.after(() => fs.removeSync(root));
  const destination = path.join(root, 'actual');
  fs.ensureDirSync(destination);
  const alias = path.join(root, 'selected');
  fs.symlinkSync(destination, alias, 'dir');
  writeSandboxFile(alias, 'agent.md', 'normal');
  assert.equal(fs.readFileSync(path.join(destination, 'agent.md'), 'utf8'), 'normal');
  const outside = path.join(root, 'outside');
  fs.ensureDirSync(outside);
  fs.symlinkSync(outside, path.join(destination, 'child'), 'dir');
  assert.throws(() => writeSandboxFile(alias, 'child/agent.md', 'escaped'));
  assert.equal(fs.existsSync(path.join(outside, 'agent.md')), false);
});
