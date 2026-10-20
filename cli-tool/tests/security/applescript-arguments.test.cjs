const assert = require('node:assert/strict');
const { test, mock } = require('node:test');
const childProcess = require('node:child_process');
const ClaudeAPIProxy = require('../../src/claude-api-proxy');

test('AppleScript notification passes one script argument without shell interpretation', () => {
  const exec = mock.method(childProcess, 'exec', () => { throw new Error('shell invocation'); });
  const execFile = mock.method(childProcess, 'execFile', (program, args, options, callback) => {
    assert.equal(program, 'osascript');
    assert.equal(args.length, 2);
    assert.equal(args[0], '-e');
    assert.match(args[1], /tell application "Terminal"/);
    assert.match(args[1], /tell application "iTerm"/);
    assert.notEqual(options.shell, true);
    assert.equal(options.timeout, 5000);
    assert.equal(options.maxBuffer, 65536);
    callback(null);
  });
  ClaudeAPIProxy.prototype.tryAppleScriptNotification();
  assert.equal(execFile.mock.callCount(), 1);
  assert.equal(exec.mock.callCount(), 0);
  mock.restoreAll();
});

test('missing osascript remains a nonfatal notification failure', () => {
  const execFile = mock.method(childProcess, 'execFile', (_program, _args, _options, callback) => callback(new Error('ENOENT')));
  assert.doesNotThrow(() => ClaudeAPIProxy.prototype.tryAppleScriptNotification());
  assert.equal(execFile.mock.callCount(), 1);
  mock.restoreAll();
});
