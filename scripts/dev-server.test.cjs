const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createApp } = require('./dev-server');

test('catalog navigation works while traversal, symlinks, and foreign callers are rejected', async t => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'catalog-boundary-'));
    t.after(() => fs.rm(temp, { recursive: true, force: true }));
    const docs = path.join(temp, 'docs');
    await fs.mkdir(path.join(docs, 'blog', 'article'), { recursive: true });
    await fs.mkdir(path.join(temp, 'private'));
    await fs.writeFile(path.join(temp, 'private', 'index.html'), 'PRIVATE');
    await fs.writeFile(path.join(docs, 'index.html'), 'CATALOG');
    await fs.writeFile(path.join(docs, 'component.html'), 'COMPONENT');
    await fs.writeFile(path.join(docs, 'blog', 'article', 'index.html'), 'ARTICLE');
    await fs.writeFile(path.join(docs, 'blog', 'article', 'style.css'), 'body{}');
    await fs.symlink(path.join(temp, 'private'), path.join(docs, 'blog', 'escape'));
    await fs.symlink(path.join(temp, 'private'), path.join(docs, 'escape'));
    const server = createApp(docs).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const port = server.address().port;
    const request = (url, headers = {}) => new Promise((resolve, reject) => {
        http.get({ hostname: '127.0.0.1', port, path: url, headers }, res => {
            let body = '';
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, body }));
        }).on('error', reject);
    });
    for (const url of ['/', '/agents', '/commands', '/settings', '/hooks', '/mcps', '/templates']) {
        assert.deepEqual(await request(url), { status: 200, body: 'CATALOG' });
    }
    assert.deepEqual(await request('/component/agents/test'), { status: 200, body: 'COMPONENT' });
    assert.deepEqual(await request('/blog/article'), { status: 200, body: 'ARTICLE' });
    assert.deepEqual(await request('/blog/article/'), { status: 200, body: 'ARTICLE' });
    assert.deepEqual(await request('/blog/article/style.css'), { status: 200, body: 'body{}' });
    for (const url of ['/blog/../../private', '/blog/%2e%2e/%2e%2e/private', '/blog/%2e%2e%2f%2e%2e%2fprivate', '/blog/escape', '/blog/missing', '/%62log/escape/index.html', '/escape/index.html', '/%65scape/index.html']) {
        const result = await request(url);
        assert.equal(result.status, 404, url);
        assert.ok(!result.body.includes('PRIVATE'), url);
    }
    assert.equal((await request('/', { host: 'attacker.example' })).status, 403);
    assert.equal((await request('/', { origin: 'https://attacker.example' })).status, 403);
    assert.equal((await request('/', { origin: `http://127.0.0.1:${port}` })).status, 200);
});
