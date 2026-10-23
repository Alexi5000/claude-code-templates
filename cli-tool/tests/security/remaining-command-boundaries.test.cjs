const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {once} = require('node:events');
const childProcess = require('node:child_process');
const index = fs.readFileSync(path.join(__dirname, '../../src/index.js'), 'utf8');
const docker = fs.readFileSync(path.join(__dirname, '../../components/sandbox/docker/execute.js'), 'utf8');
const quiet = {log() {}, error() {}};

test('confirmed prompt reaches native CLI literally after option terminator', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-boundary-'));
    let completed;
    const payload = '--dangerous $(touch forged) `touch forged2` "quoted"\nnext';
    fs.writeFileSync(path.join(dir, 'claude'), `#!${process.execPath}\nrequire('node:fs').writeFileSync('argv.json', JSON.stringify(process.argv.slice(2)));\n`, {mode: 0o700});
    const spawn = (program, args, options) => {
        const child = childProcess.spawn(path.join(dir, program), args, options);
        completed = once(child, 'close');
        return child;
    };
    const context = vm.createContext({console: quiet, chalk: new Proxy({}, {get: () => x => x}),
        inquirer: {prompt: async () => ({shouldExecute: true})},
        require: name => name === 'child_process' ? {spawn} : () => {throw Error('unexpected browser');}});
    const start = index.indexOf('async function handlePromptExecution(');
    const end = index.indexOf('async function launchClaudeCodeStudio(', start);
    vm.runInContext(index.slice(start, end), context);
    try {
        await context.handlePromptExecution(payload, dir);
        assert.deepEqual(await completed, [0, null]);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'argv.json'), 'utf8')), ['--', payload]);
        assert.equal(fs.existsSync(path.join(dir, 'forged')), false);
        assert.equal(fs.existsSync(path.join(dir, 'forged2')), false);
    } finally {fs.rmSync(dir, {recursive: true, force: true});}
});

test('Docker installer passes approved component arguments without invoking a shell', async () => {
    const start = docker.indexOf('async function installComponents()');
    const end = docker.indexOf('async function executeQuery()', start);
    for (const input of ['--agent category/name --hook git/pre-commit', '--agent x;touch-forged', '--agent x $(id)', '--package attacker', '--agent ../outside', '--agent']) {
        const calls = [];
        const context = vm.createContext({componentsToInstall: input, console: quiet, process: {env: {}},
            spawn: (program, args, options) => {
                calls.push({program, args: Array.from(args), options});
                return {on(event, fn) {if (event === 'close') queueMicrotask(() => fn(0)); return this;}};
            }});
        vm.runInContext(docker.slice(start, end), context);
        const result = await context.installComponents();
        if (input === '--agent category/name --hook git/pre-commit') {
            assert.equal(result, true);
            assert.equal(calls[0].program, 'npx');
            assert.deepEqual(calls[0].args, ['claude-code-templates@latest', '--agent', 'category/name', '--hook', 'git/pre-commit', '--yes']);
            assert.equal(calls[0].options.shell, false);
        } else {
            assert.equal(result, false);
            assert.equal(calls.length, 0);
        }
    }
});
