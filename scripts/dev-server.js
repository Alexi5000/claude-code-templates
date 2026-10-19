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
    async function sendDocument(res, segments) {
        if (segments.some(segment => segment.startsWith('.') || segment.includes('\\') || segment.includes('\0'))) {
            return res.status(404).send('Document not found');
        }
        try {
            const documentRoot = await fs.realpath(root);
            let candidate = path.join(documentRoot, ...segments);
            if ((await fs.stat(candidate)).isDirectory()) candidate = path.join(candidate, 'index.html');
            const target = await fs.realpath(candidate);
            const relative = path.relative(documentRoot, target);
            if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
                return res.status(404).send('Document not found');
            }
            res.sendFile(relative, { root: documentRoot }, err => {
                if (err && !res.headersSent) res.status(404).send('Document not found');
            });
        } catch {
            res.status(404).send('Document not found');
        }
    }
    for (const filter of ['agents', 'commands', 'settings', 'hooks', 'mcps', 'templates']) {
        app.get(`/${filter}`, (req, res) => sendDocument(res, ['index.html']));
    }
    app.get('/component/:type/:name', (req, res) => sendDocument(res, ['component.html']));
    app.get('*', (req, res) => {
        let decoded;
        try {
            decoded = decodeURIComponent(req.path);
        } catch {
            return res.status(400).send('Invalid URL');
        }
        return sendDocument(res, decoded.split('/').filter(Boolean));
    });
    return app;
}

if (require.main === module) {
    createApp().listen(3001, '127.0.0.1', () => {
        console.log('Development server running at http://localhost:3001');
    });
}

module.exports = { createApp };
