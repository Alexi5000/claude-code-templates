const assert = require('node:assert/strict');
const { test, mock } = require('node:test');
const childProcess = require('node:child_process');
const execFile = mock.method(childProcess, 'execFile', () => {});
const exec = mock.method(childProcess, 'exec', () => { throw new Error('Shell execution is forbidden'); });
const ConsoleBridge = require('../../src/console-bridge');

const payload = `'; touch /tmp/not-executed; $(id) \`id\` [exec id] $env(HOME) "\\\n`;

function bridge() {
  execFile.mock.resetCalls();
  const result = new ConsoleBridge();
  result.terminalDevice = '/dev/ttys001';
  return result;
}

test('Expect input stays data instead of shell or Tcl source', () => {
  const instance = bridge();
  instance.writeToTerminal(payload);
  const [program, args, options] = execFile.mock.calls[0].arguments;
  assert.equal(program, 'expect');
  assert.equal(options.shell, false);
  assert.equal(options.env.CLAUDE_BRIDGE_INPUT, payload);
  assert.equal(options.env.CLAUDE_BRIDGE_DEVICE, '/dev/ttys001');
  assert.ok(!args[1].includes(payload));
  assert.match(args[1], /send -- \$env\(CLAUDE_BRIDGE_INPUT\)/);
  assert.equal(exec.mock.callCount(), 0);
});

test('Expect failure preserves fallback input without reinterpretation', () => {
  const instance = bridge();
  let fallback;
  instance.tryAlternativeInput = text => { fallback = text; };
  instance.writeToTerminal(payload);
  execFile.mock.calls[0].arguments[3](new Error('expect unavailable'));
  assert.equal(fallback, payload);
});

test('AppleScript uses constant source and targets the attached terminal tab', () => {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  try {
    const instance = bridge();
    instance.tryAlternativeInput(payload);
    const [program, args, options] = execFile.mock.calls[0].arguments;
    assert.equal(program, 'osascript');
    assert.equal(options.shell, false);
    assert.deepEqual(args.slice(2), ['--', payload, '/dev/ttys001']);
    assert.ok(!args[1].includes(payload));
    assert.match(args[1], /tty of terminalTab is devicePath/);
    assert.match(args[1], /do script inputText in terminalTab/);
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
});

test('unattached terminals do not launch a subprocess', () => {
  const instance = bridge();
  instance.terminalDevice = null;
  instance.writeToTerminal(payload);
  assert.equal(execFile.mock.callCount(), 0);
});
