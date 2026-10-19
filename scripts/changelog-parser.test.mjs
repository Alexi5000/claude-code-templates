import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

for (const file of [
  '../api/_parser-claude.js',
  '../api/claude-code-monitor/parser.js',
  '../dashboard/src/lib/api/changelog-parser.ts',
]) {
  let source = await readFile(new URL(file, import.meta.url), 'utf8');
  if (file.endsWith('.ts')) source = stripTypeScriptTypes(source);
  const { parseVersionChangelog } = await import(`data:text/javascript,${encodeURIComponent(source)}`);

  test(`${file}: selects exact release and retains parsed changes`, () => {
    const content = '## 2.0.31\n- newer release\n\n## v2.0.3\n- Fixed a bug\n\n## 2.0.2\n- older release';
    const result = parseVersionChangelog(content, 'v2.0.3');
    assert.equal(result.version, '2.0.3');
    assert.equal(result.content, '## v2.0.3\n- Fixed a bug');
    assert.equal(result.changeCount, 1);
    assert.equal(result.changes[0].description, 'Fixed a bug');
  });

  test(`${file}: regex syntax is matched literally without compilation errors`, () => {
    for (const version of ['2.0.[', '2.0.(a+)+$', '2.0.3+meta', '2.0.*', '2.0.3|9', '2.0.\\', '2.0.{3}', '2.0.?']) {
      const result = parseVersionChangelog(`## ${version}\n- literal release\n\n## 1.0.0\n- older`, version);
      assert.equal(result.content, `## ${version}\n- literal release`);
    }
  });

  test(`${file}: regex operators cannot select an unrelated release`, () => {
    for (const version of ['2.0.*', '.*', '2.0.3|9.0.0', '(a+)+$']) {
      const result = parseVersionChangelog('## 2.0.31\n- newer\n\n## 9.0.0\n- other', version);
      assert.equal(result.content, null);
      assert.equal(result.error, 'Version not found in changelog');
    }
  });
}
