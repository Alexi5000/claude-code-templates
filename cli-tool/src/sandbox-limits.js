const { spawn } = require('child_process');

const MAX_PROCESSES = 4;
const MAX_OUTPUT = 65536;
const children = new Set();

function spawnBounded(command, args, options) {
    if (children.size >= MAX_PROCESSES) {
        throw new Error('Sandbox is busy; retry when another operation finishes');
    }
    const useProcessGroup = process.platform !== 'win32';
    const child = spawn(command, args, { ...options, timeout: undefined, detached: useProcessGroup });
    children.add(child);
    let groupTerminated = false;
    const terminate = () => {
        if (groupTerminated) return true;
        if (!useProcessGroup || !child.pid) return child.kill('SIGKILL');
        try {
            process.kill(-child.pid, 'SIGKILL');
            groupTerminated = true;
            return true;
        } catch (error) {
            if (error.code === 'ESRCH') {
                groupTerminated = true;
                return true;
            }
            child.emit('error', error);
            return false;
        }
    };
    const requestedTimeout = options?.timeout;
    const timeout = Number.isFinite(requestedTimeout) && requestedTimeout > 0
        ? Math.min(requestedTimeout, 300000) : 300000;
    const timer = setTimeout(terminate, timeout);
    timer.unref();
    const release = () => {
        if (useProcessGroup && child.pid && !terminate()) return;
        clearTimeout(timer);
        children.delete(child);
    };
    if (useProcessGroup) child.once('exit', terminate);
    child.once('close', release);
    child.once('error', () => {
        if (!child.pid) release();
    });
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

function dashboardRequestBudget(limit) {
    const api = requestBudget(limit);
    const pages = requestBudget(limit);
    return (req, res, next) => (/^\/api(?:\/|$)/i.test(req.path) ? api : pages)(req, res, next);
}

module.exports = { spawnBounded, outputBuffer, requestBudget, dashboardRequestBudget, isBusy: () => children.size >= MAX_PROCESSES };
