const express = require('express');
const path = require('node:path');
const fs = require('node:fs/promises');

function createApp(docsRoot = path.resolve(__dirname, '..', 'docs')) {
    const app = express();
    const root = path.resolve(docsRoot);
    app.use((req, res, next) => {
        const authority = req.headers.host;
        if (typeof authority !== 'string' || !/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(authority)) {
            return res.status(403).send('Local requests only');
        }
        if (req.headers.origin !== undefined && req.headers.origin !== `http://${authority}`) {
            return res.status(403).send('Origin not allowed');
        }
        next();
    });
    app.get('/blog/*', async (req, res) => {
        const segments = req.params[0].replace(/\/$/, '').split('/');
        if (segments.some(segment => !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(segment))) {
            return res.status(404).send('Blog post not found');
        }
        try {
            const blogRoot = await fs.realpath(path.join(root, 'blog'));
            let candidate = path.join(blogRoot, ...segments);
            if ((await fs.stat(candidate)).isDirectory()) candidate = path.join(candidate, 'index.html');
            const target = await fs.realpath(candidate);
            const relative = path.relative(blogRoot, target);
            if (relative.startsWith('..') || path.isAbsolute(relative)) {
                return res.status(404).send('Blog post not found');
            }
            res.sendFile(relative, { root: blogRoot }, err => {
                if (err && !res.headersSent) res.status(404).send('Blog post not found');
            });
        } catch {
            res.status(404).send('Blog post not found');
        }
    });
    app.use(express.static(root));
    for (const filter of ['agents', 'commands', 'settings', 'hooks', 'mcps', 'templates']) {
        app.get(`/${filter}`, (req, res) => res.sendFile('index.html', { root }));
    }
    app.get('/component/:type/:name', (req, res) => res.sendFile('component.html', { root }));
    app.get('/', (req, res) => res.sendFile('index.html', { root }));
    return app;
}

if (require.main === module) {
    createApp().listen(3001, '127.0.0.1', () => {
        console.log('Development server running at http://localhost:3001');
    });
}

module.exports = { createApp };
