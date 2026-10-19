const assert = require('node:assert/strict');
const { test, mock } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const childProcess = require('node:child_process');
const originalSpawn = childProcess.spawn;
let launched;
const spawn = mock.method(childProcess, 'spawn', (...args) => {
  const child = originalSpawn(...args);
  launched = once(child, 'close');
  return child;
});
const inquirer = require('inquirer');
const prompt = mock.method(inquirer, 'prompt', async () => ({ optimize: true, runValidation: true }));
const { promptCommandOptimization } = require('../../src/command-stats');
const { runPostInstallationValidation } = require('../../src/file-operations');

for (const mode of ['optimization', 'validation']) {
  test(`${mode} passes hostile text unchanged to the CLI without shell execution`, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-prompt-'));
    const previousPath = process.env.PATH;
    const payload = '$(touch shell-expanded) `touch backtick-expanded` "$HOME" \\ literal\nsecond line';
    try {
      fs.writeFileSync(path.join(directory, 'claude'), `#!${process.execPath}\nrequire('node:fs').writeFileSync('arguments.json', JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o700 });
      process.env.PATH = `${directory}${path.delimiter}${previousPath}`;
      spawn.mock.resetCalls();
      if (mode === 'optimization') {
        await promptCommandOptimization({ exists: true, commands: [{ name: payload, lines: 1 }] }, directory);
      } else {
        await runPostInstallationValidation(directory, { language: payload, framework: 'fixture' });
      }
      const [code] = await launched;
      assert.equal(code, 0);
      assert.equal(spawn.mock.callCount(), 1);
      const [program, args, options] = spawn.mock.calls[0].arguments;
      assert.equal(program, 'claude');
      assert.equal(args.length, 1);
      assert.notEqual(options.shell, true);
      const received = JSON.parse(fs.readFileSync(path.join(directory, 'arguments.json'), 'utf8'));
      assert.deepEqual(received, args);
      assert.ok(received[0].includes(payload));
      assert.equal(fs.existsSync(path.join(directory, 'shell-expanded')), false);
      assert.equal(fs.existsSync(path.join(directory, 'backtick-expanded')), false);
    } finally {
      process.env.PATH = previousPath;
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('declining either prompt does not launch a process', async () => {
  prompt.mock.mockImplementation(async () => ({ optimize: false, runValidation: false }));
  spawn.mock.resetCalls();
  await promptCommandOptimization({ exists: true, commands: [{ name: 'fixture', lines: 1 }] }, process.cwd());
  await runPostInstallationValidation(process.cwd(), {});
  assert.equal(spawn.mock.callCount(), 0);
});
