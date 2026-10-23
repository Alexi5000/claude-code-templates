const assert = require('node:assert/strict');
const {test} = require('node:test');
const ConsoleBridge = require('../../src/console-bridge');
const SessionSharing = require('../../src/session-sharing');
const chalk = require('chalk');
chalk.level = 0;
const hostile = 'normal\r\nFORGED\x00\x1b[31m\u2028\u2029';

test('console bridge escapes diagnostics while preserving authorized terminal input', t => {
    const records = [];
    t.mock.method(console, 'log', (...args) => records.push(args.join(' ')));
    const bridge = new ConsoleBridge();
    bridge.attachedPid = 123;
    bridge.terminalDevice = '/dev/pts/1';
    const writes = [];
    bridge.writeToTerminal = text => writes.push(text);
    bridge.sendResponseToClaudeCode({type: 'text', value: hostile});
    assert.deepEqual(writes, [hostile + '\n']);
    const record = records.find(x => x.includes('Text input'));
    assert.ok(record.includes('FORGED'));
    assert.ok(record.includes('\\r\\n'));
    assert.doesNotMatch(record, /[\r\n\x00\x1b\u2028\u2029]/);
});

test('session export keeps markdown content and escapes only diagnostic session identifier', async t => {
    const records = [];
    t.mock.method(console, 'log', (...args) => records.push(args.join(' ')));
    const sharing = new SessionSharing({getParsedConversation: async () => []});
    sharing.convertToMarkdown = () => '# unchanged content\n';
    const result = await sharing.exportSessionAsMarkdown(hostile, {filePath: 'fixture', project: 'normal'});
    assert.equal(result.markdown, '# unchanged content\n');
    assert.equal(result.success, true);
    const record = records.find(x => x.includes('Preparing session'));
    assert.ok(record.includes('FORGED'));
    assert.doesNotMatch(record, /[\r\n\x00\x1b\u2028\u2029]/);
});
