const assert = require('node:assert/strict');
const { test, mock } = require('node:test');
const childProcess = require('node:child_process');
mock.method(childProcess, 'execFile', () => {});
mock.method(childProcess, 'exec', () => { throw new Error('Shell execution is forbidden'); });
const WebSocket = require('ws');
const ConsoleBridge = require('../../src/console-bridge');

async function startBridge(options = {}) {
  const bridge = new ConsoleBridge({ port: 0, ...options });
  await bridge.setupWebSocketServer();
  return bridge;
}

function connect(url, headers = {}) {
  return new Promise(resolve => {
    const ws = new WebSocket(url, { headers });
    const messages = [];
    ws.on('message', m => messages.push(JSON.parse(m)));
    ws.on('open', () => resolve({ ok: true, ws, messages }));
    ws.on('unexpected-response', (req, res) => resolve({ ok: false, status: res.statusCode }));
    ws.on('error', () => resolve({ ok: false }));
  });
}

const baseUrl = bridge => `ws://127.0.0.1:${bridge.getPort()}/`;
const wait = ms => new Promise(r => setTimeout(r, ms));

test('per-session token is random and the listener binds loopback only', async () => {
  const a = new ConsoleBridge();
  const b = new ConsoleBridge();
  assert.match(a.authToken, /^[0-9a-f]{64}$/);
  assert.notEqual(a.authToken, b.authToken);
  assert.throws(() => new ConsoleBridge({ host: '0.0.0.0' }), /loopback/);
  const bridge = await startBridge();
  try {
    assert.equal(bridge.wss.address().address, '127.0.0.1');
  } finally {
    await bridge.shutdown();
  }
});

test('connections without the session token are rejected before disclosure', async () => {
  const bridge = await startBridge();
  bridge.currentInteraction = { id: 'pending-1', type: 'text' };
  try {
    const missing = await connect(baseUrl(bridge));
    assert.equal(missing.ok, false);
    assert.equal(missing.status, 401);
    const wrong = await connect(`${baseUrl(bridge)}?token=${'0'.repeat(64)}`);
    assert.equal(wrong.ok, false);
    const short = await connect(`${baseUrl(bridge)}?token=x`);
    assert.equal(short.ok, false);
    assert.equal(bridge.clients.size, 0);
  } finally {
    await bridge.shutdown();
  }
});

test('foreign browser origins are rejected even with the token', async () => {
  const bridge = await startBridge();
  try {
    const foreign = await connect(bridge.getConnectionUrl(), { Origin: 'https://evil.example' });
    assert.equal(foreign.ok, false);
    const local = await connect(bridge.getConnectionUrl(), { Origin: 'http://localhost:3333' });
    assert.equal(local.ok, true);
    local.ws.close();
  } finally {
    await bridge.shutdown();
  }
});

test('authenticated clients may answer only the pending interaction', async () => {
  const bridge = await startBridge();
  const sent = [];
  bridge.sendResponseToClaudeCode = response => sent.push(response);
  bridge.currentInteraction = { id: 'pending-1', type: 'text' };
  try {
    const viaHeader = await connect(baseUrl(bridge), { 'x-console-bridge-token': bridge.authToken });
    assert.equal(viaHeader.ok, true);
    viaHeader.ws.close();

    const client = await connect(bridge.getConnectionUrl());
    assert.equal(client.ok, true);
    await wait(50);
    assert.equal(client.messages[0].type, 'console_interaction');

    client.ws.send(JSON.stringify({ type: 'console_response', data: { type: 'text', value: 'no id' } }));
    client.ws.send(JSON.stringify({ type: 'console_response', interactionId: 'other', data: { type: 'text', value: 'x' } }));
    await wait(50);
    assert.equal(sent.length, 0);
    assert.ok(bridge.currentInteraction);

    client.ws.send(JSON.stringify({ type: 'console_response', interactionId: 'pending-1', data: { type: 'text', value: 'ok' } }));
    await wait(50);
    assert.deepEqual(sent, [{ type: 'text', value: 'ok' }]);
    assert.equal(bridge.currentInteraction, null);
    client.ws.close();
  } finally {
    await bridge.shutdown();
  }
});

test('in-process dashboard responses keep working without an interaction id', () => {
  const bridge = new ConsoleBridge();
  const sent = [];
  bridge.sendResponseToClaudeCode = response => sent.push(response);
  bridge.currentInteraction = { id: 'pending-2', type: 'choice' };
  bridge.handleWebMessage({ type: 'console_response', data: { type: 'choice', value: 0, interactionId: 'stale' } });
  assert.equal(sent.length, 0);
  bridge.handleWebMessage({ type: 'console_response', data: { type: 'choice', value: 0 } });
  assert.equal(sent.length, 1);
  assert.equal(bridge.currentInteraction, null);
});
