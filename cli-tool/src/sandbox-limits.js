const { spawn } = require('child_process');

const MAX_PROCESSES = 4;
const MAX_OUTPUT = 65536;
const children = new Set();

function spawnBounded(command, args, options) {
    if (children.size >= MAX_PROCESSES) {
        throw new Error('Sandbox is busy; retry when another operation finishes');
    }
    const child = spawn(command, args, { ...options, timeout: undefined });
    children.add(child);
    const timer = setTimeout(() => child.kill('SIGKILL'), 300000);
    timer.unref();
    const release = () => {
        clearTimeout(timer);
        children.delete(child);
    };
    child.once('close', release);
    child.once('error', release);
    return child;
}

function outputBuffer() {
    const output = [];
    let size = 0;
    output.push = (...lines) => {
        for (const value of lines) {
            const line = String(value).slice(-MAX_OUTPUT);
            Array.prototype.push.call(output, line);
            size += line.length;
            while (size > MAX_OUTPUT || output.length > 512) size -= output.shift().length;
        }
        return output.length;
    };
    return output;
}

function requestBudget(limit) {
    let start = Date.now();
    let used = 0;
    return (req, res, next) => {
        const now = Date.now();
        if (now - start >= 60000) {
            start = now;
            used = 0;
        }
        if (++used > limit) {
            res.set('Retry-After', String(Math.max(1, Math.ceil((60000 - now + start) / 1000))));
            return res.status(429).json({ success: false, error: 'Too many requests; retry shortly' });
        }
        next();
    };
}

module.exports = { spawnBounded, outputBuffer, requestBudget, isBusy: () => children.size >= MAX_PROCESSES };
