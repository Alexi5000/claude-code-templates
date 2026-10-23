const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {writeSandboxFile, validateComponentName} = require('../../components/sandbox/cloudflare/safe-output.cjs');

function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-output-'));
    t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
    const root = path.join(dir, 'output');
    fs.mkdirSync(root);
    const outside = path.join(dir, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'protected');
    return {dir, root, outside};
}

test('ordinary nested outputs can be created and updated', t => {
    const {root} = fixture(t);
    writeSandboxFile(root, 'src/report.md', 'long previous content');
    writeSandboxFile(root, 'src/report.md', 'new');
    assert.equal(fs.readFileSync(path.join(root, 'src/report.md'), 'utf8'), 'new');
});

test('absolute, parent, Windows and stream paths cannot leave the output root', t => {
    const {root, outside} = fixture(t);
    for (const name of ['../outside/keep.txt', '/tmp/escape', 'a/../../outside/keep.txt', 'a\\..\\escape', 'C:/escape', 'C:escape', 'file:stream', '//server/file', './file', 'a//file', 'bad\0name']) {
        assert.throws(() => writeSandboxFile(root, name, 'overwritten'));
    }
    assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'protected');
});

test('symlink parents and leaves and hardlinks never modify outside files', t => {
    const {root, outside} = fixture(t);
    fs.symlinkSync(outside, path.join(root, 'linked-dir'));
    fs.symlinkSync(path.join(outside, 'keep.txt'), path.join(root, 'linked-file'));
    fs.linkSync(path.join(outside, 'keep.txt'), path.join(root, 'hardlink'));
    for (const name of ['linked-dir/keep.txt', 'linked-file', 'hardlink']) {
        assert.throws(() => writeSandboxFile(root, name, 'overwritten'));
    }
    assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'protected');
});

test('FIFO targets reject without waiting for a reader', {skip: process.platform === 'win32'}, t => {
    const {root} = fixture(t);
    execFileSync('mkfifo', [path.join(root, 'pipe')]);
    assert.throws(() => writeSandboxFile(root, 'pipe', 'data'), /regular file/);
});

test('component identifiers keep category paths but reject URL and traversal syntax', () => {
    assert.equal(validateComponentName('development/my-agent.v2'), 'development/my-agent.v2');
    for (const name of ['../outside', 'category/../outside', 'https://evil.test/x', 'name?token=x', 'name#fragment', 'a\\b', 'a//b', '-flag']) {
        assert.throws(() => validateComponentName(name));
    }
});
