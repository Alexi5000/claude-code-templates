/**
 * CLI smoke test: the published binary must start and print help.
 * Run: npm run test:e2e (from cli-tool/)
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'create-claude-config.js');

function runCli(...args) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 60000,
  });
}

describe('CLI smoke', () => {
  test('--help exits 0 and names the tool', () => {
    const result = runCli('--help');
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/create-claude-config/i);
  });

  test('--version exits 0 and prints a semver', () => {
    const result = runCli('--version');
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
  });
});
