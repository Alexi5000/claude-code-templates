import { describe, it, expect } from 'vitest';
import { formatForDiscord, generateSummary, parseVersionChangelog } from './changelog-parser';

const SAMPLE = `# Changelog

## 1.2.3

### Features

- Add new login flow
- Fix crash on startup

## 1.2.2

- Old change
`;

describe('parseVersionChangelog', () => {
  it('extracts the requested version section', () => {
    const parsed = parseVersionChangelog(SAMPLE, '1.2.3');
    expect(parsed.version).toBe('1.2.3');
    expect(parsed.content).toContain('Add new login flow');
    expect(parsed.changeCount).toBe(2);
  });

  it('classifies feature vs fix (see category note below)', () => {
    const parsed = parseVersionChangelog(SAMPLE, '1.2.3');
    const byDescription = Object.fromEntries(parsed.changes.map((c) => [c.description, c]));
    expect(byDescription['Add new login flow'].type).toBe('feature');
    expect(byDescription['Fix crash on startup'].type).toBe('fix');
    // NOTE: '### Features' does NOT become the category — parseChanges
    // skips '##'-prefixed lines before checking '###' (changelog-parser.ts),
    // so the '###' branch is unreachable and category falls back to
    // detectCategory(). Neither sample description matches a keyword, hence null.
    // If the parser is fixed to honor '###' headers, update this expectation.
    expect(byDescription['Add new login flow'].category).toBeNull();
  });

  it('stops at the next version boundary', () => {
    const parsed = parseVersionChangelog(SAMPLE, '1.2.3');
    expect(parsed.content).not.toContain('Old change');
  });

  it('returns an error shape for unknown versions', () => {
    const parsed = parseVersionChangelog(SAMPLE, '9.9.9');
    expect(parsed.content).toBeNull();
    expect(parsed.changes).toEqual([]);
    expect(parsed.error).toBe('Version not found in changelog');
  });
});

describe('generateSummary', () => {
  it('counts by type and highlights breaking + feature', () => {
    const summary = generateSummary([
      { type: 'feature', description: 'Add x', category: 'CLI', raw: '- Add x' },
      { type: 'fix', description: 'Fix y', category: 'CLI', raw: '- Fix y' },
      { type: 'breaking', description: 'Breaking z', category: null, raw: '- Breaking z' },
    ]);
    expect(summary.total).toBe(3);
    expect(summary.byType).toEqual({ feature: 1, fix: 1, breaking: 1 });
    expect(summary.byCategory).toEqual({ CLI: 2 });
    expect(summary.highlights.map((h) => h.description)).toEqual(['Add x', 'Breaking z']);
  });
});

describe('formatForDiscord', () => {
  it('groups descriptions with bullet prefixes', () => {
    const formatted = formatForDiscord([
      { type: 'feature', description: 'Add x', category: null, raw: '- Add x' },
      { type: 'fix', description: 'Fix y', category: null, raw: '- Fix y' },
    ]);
    expect(formatted.features).toContain('• Add x');
    expect(formatted.fixes).toContain('• Fix y');
    expect(formatted.breaking).toBe('');
  });

  it('truncates long groups with a read-more marker', () => {
    const formatted = formatForDiscord(
      [{ type: 'feature', description: 'A'.repeat(200), category: null, raw: '- big' }],
      40,
    );
    expect(formatted.features.length).toBeLessThanOrEqual(60);
    expect(formatted.features).toContain('... [Read more in changelog]');
  });

  it('buckets performance into improvements', () => {
    const formatted = formatForDiscord([
      { type: 'performance', description: 'Faster cache', category: null, raw: '- Faster cache' },
    ]);
    expect(formatted.improvements).toContain('Faster cache');
  });
});
