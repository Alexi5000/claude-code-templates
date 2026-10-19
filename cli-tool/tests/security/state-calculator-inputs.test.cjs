const assert = require('node:assert/strict');
const test = require('node:test');
const StateCalculator = require('../../src/analytics/core/StateCalculator');
const calculator = new StateCalculator();
const oldFile = new Date(Date.now() - 3600000);

test('invalid message collections use existing empty-conversation behavior', () => {
  for (const messages of [null, undefined, {}, '', 42, [null, undefined, {}, [], {role: 'user'}]]) {
    assert.equal(calculator.determineConversationState(messages, oldFile), 'Idle');
    assert.equal(calculator.determineConversationStatus(messages, oldFile), 'inactive');
    assert.deepEqual(calculator.detectRealClaudeActivity(messages, oldFile), {
      isActive: false, status: 'No messages'
    });
  }
});

test('malformed records cannot hide an otherwise valid recent user message', () => {
  const valid = {role: 'user', timestamp: new Date(Date.now() - 60000), content: 'hello'};
  const mixed = [null, valid, {role: 'assistant', timestamp: 'invalid'}, {role: 'user', timestamp: null}, {}];
  assert.equal(calculator.determineConversationState(mixed, oldFile), 'Claude Code working...');
  assert.equal(calculator.determineConversationStatus(mixed, oldFile), 'active');
});

test('nullable content blocks preserve real tool activity', () => {
  const messages = [{
    role: 'assistant', timestamp: new Date(Date.now() - 180000),
    content: [null, undefined, {type: 'tool_use'}]
  }];
  assert.deepEqual(calculator.detectRealClaudeActivity(messages, new Date(Date.now() - 600000)), {
    isActive: true, status: 'Active session'
  });
});

test('state calculations preserve frozen caller-owned message ordering', () => {
  const messages = Object.freeze([
    Object.freeze({role: 'assistant', timestamp: new Date(Date.now() - 60000)}),
    Object.freeze({role: 'user', timestamp: new Date(Date.now() - 120000)})
  ]);
  assert.equal(calculator.determineConversationState(messages, oldFile), 'Awaiting user input...');
  assert.equal(calculator.determineConversationStatus(messages, oldFile), 'active');
  assert.deepEqual(calculator.detectRealClaudeActivity(messages, oldFile), {isActive: false, status: null});
  assert.equal(messages[0].role, 'assistant');
});

test('partial process metadata is safely matched against a real project', () => {
  const conversation = {project: '/work/project', lastModified: new Date(Date.now() - 60000)};
  assert.equal(calculator.quickStateCalculation(conversation, [null, {}, {command: 'run /work/project'}]), 'Awaiting user input...');
  assert.equal(calculator.quickStateCalculation(conversation, [{workingDir: '/work/project'}]), 'Awaiting user input...');
  assert.equal(calculator.quickStateCalculation(conversation, [null, {}, {command: 'unrelated'}]), null);
  assert.equal(calculator.quickStateCalculation(conversation, null), null);
  assert.equal(calculator.quickStateCalculation(null, [{}]), null);
  assert.equal(calculator.quickStateCalculation({project: ''}, [{command: 'anything'}]), null);
  assert.equal(calculator.quickStateCalculation({}, [{command: 'undefined'}]), null);
});

test('valid quick-state timing and cached process behavior remain unchanged', () => {
  for (const [seconds, expected] of [[10, 'Claude Code working...'], [60, 'Awaiting user input...'], [600, 'User typing...']]) {
    const conversation = {project: '/work/project', lastModified: new Date(Date.now() - seconds * 1000), runningProcess: {pid: 1}};
    assert.equal(calculator.quickStateCalculation(conversation, [{workingDir: '/elsewhere', command: 'other'}]), expected);
    assert.equal(calculator.quickStateCalculation(conversation, []), null);
  }
});

test('optional state labels do not crash rendering', () => {
  for (const value of [null, undefined, 42, {}, []]) assert.equal(calculator.getStateClass(value), '');
  assert.equal(calculator.getStateClass('Claude Code working...'), 'working');
  assert.equal(calculator.getStateClass('User typing...'), 'typing');
  assert.equal(calculator.getStateClass('Active session'), '');
});
