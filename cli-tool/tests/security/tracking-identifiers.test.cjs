const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { TrackingService } = require('../../src/tracking-service');
const browserSource = fs.readFileSync(path.resolve(__dirname, '../../../docs/js/event-tracker.js'), 'utf8');

test('CLI payload identifiers use all 128 random bits without Math.random', t => {
    t.mock.method(Math, 'random', () => { throw new Error('predictable randomness'); });
    const entropy = t.mock.method(crypto, 'randomBytes', size => {
        assert.equal(size, 16);
        return Buffer.alloc(size, 0xab);
    });
    const service = new TrackingService();
    const payload = service.createTrackingPayload('agent', 'example', {});
    assert.equal(payload.session_id, 'ab'.repeat(16));
    assert.equal(entropy.mock.callCount(), 1);
});

test('CLI entropy failure sends neither download nor command telemetry', async t => {
    const service = new TrackingService();
    service.trackingEnabled = true;
    t.mock.method(crypto, 'randomBytes', () => { throw new Error('entropy unavailable'); });
    const download = t.mock.method(service, 'sendTrackingData', async () => {});
    const command = t.mock.method(service, 'sendCommandTracking', async () => {});
    await service.trackDownload('agent', 'example');
    await service.trackCommandExecution('example');
    assert.equal(download.mock.callCount(), 0);
    assert.equal(command.mock.callCount(), 0);
});

test('CLI opt-out skips entropy and network work', async t => {
    const service = new TrackingService();
    service.trackingEnabled = false;
    const entropy = t.mock.method(crypto, 'randomBytes');
    const fetch = t.mock.method(globalThis, 'fetch');
    await service.trackDownload('agent', 'example');
    await service.trackCommandExecution('example');
    assert.equal(entropy.mock.callCount(), 0);
    assert.equal(fetch.mock.callCount(), 0);
});

function storage(values = {}) {
    const data = new Map(Object.entries(values));
    return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
}

function browser(overrides = {}) {
    const context = {
        window: { screen: {}, location: { pathname: '/' }, addEventListener() {} },
        document: { addEventListener() {} },
        sessionStorage: storage(), localStorage: storage(),
        setInterval() {},
        Math: { random() { throw new Error('predictable randomness'); } },
        crypto: { getRandomValues(bytes) { return bytes.fill(0xab); } },
        ...overrides,
    };
    vm.runInNewContext(browserSource, context);
    return context;
}

test('browser creates secure identifiers and reuses persisted session and visitor IDs', () => {
    const context = browser();
    assert.equal(context.window.eventTracker.sessionId, 'ab'.repeat(16));
    assert.equal(context.window.eventTracker.visitorId, 'ab'.repeat(16));
    const reused = browser({
        sessionStorage: context.sessionStorage,
        localStorage: context.localStorage,
        crypto: { getRandomValues() { throw new Error('must reuse storage'); } },
    });
    assert.equal(reused.window.eventTracker.sessionId, context.window.eventTracker.sessionId);
    assert.equal(reused.window.eventTracker.visitorId, context.window.eventTracker.visitorId);
});

test('browser keeps legacy stored identifiers without regeneration', () => {
    const context = browser({
        sessionStorage: storage({ cct_session_id: 'old-session' }),
        localStorage: storage({ cct_visitor_id: 'old-visitor' }),
        crypto: { getRandomValues() { throw new Error('must reuse storage'); } },
    });
    assert.equal(context.window.eventTracker.sessionId, 'old-session');
    assert.equal(context.window.eventTracker.visitorId, 'old-visitor');
});

test('browser entropy failure does not persist a weak identifier', () => {
    const sessionStorage = storage();
    assert.throws(() => browser({
        sessionStorage,
        crypto: { getRandomValues() { throw new Error('entropy unavailable'); } },
    }), /entropy unavailable/);
    assert.equal(sessionStorage.getItem('cct_session_id'), null);
});
