const test = require('node:test');
const assert = require('node:assert/strict');
const ReferenceValidator = require('../../src/validation/validators/ReferenceValidator');

test('markdown destinations are counted once without consuming closing punctuation', async () => {
  const validator = new ReferenceValidator();
  const report = await validator.generateReferenceReport({
    path: 'references.md',
    content: '[Guide](https://example.com/guide) [Other](https://other.example) and http://docs.example'
  });
  assert.equal(report.totalUrls, 3);
  assert.equal(report.httpsCount, 2);
  assert.equal(report.httpCount, 1);
  assert.equal(report.httpsPercentage, '66.7');
  assert.deepEqual(report.urls.map(item => item.url), ['https://example.com/guide', 'https://other.example', 'http://docs.example']);
});

test('link labels and independent plain URLs retain reference validation', async () => {
  const validator = new ReferenceValidator();
  const content = '[https://label.example](https://target.example) https://plain.example [Private](http://127.0.0.1/admin)';
  const urls = validator.extractUrls(content);
  assert.deepEqual(urls.filter(info => info.type === 'plain').map(info => info.url), ['https://label.example', 'https://plain.example']);
  const result = await validator.validate({ path: 'references.md', content });
  const blocked = result.errors.filter(error => error.code === 'REF_E004');
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].metadata.url, 'http://127.0.0.1/admin');
});

test('deduplication preserves repeated markdown occurrences and a unique plain URL', () => {
  const validator = new ReferenceValidator();
  const urls = validator.extractUrls('[One](https://example.com) [Two](https://example.com) https://example.com https://other.example');
  assert.deepEqual(urls.map(info => info.url), ['https://example.com', 'https://example.com', 'https://other.example']);
});

test('raw dangerous schemes are blocked outside markdown links', async () => {
  for (const source of ['data:text/html,<script>alert(1)</script>', 'javascript:alert(1)', 'FILE:///etc/passwd', 'vbscript:msgbox(1)']) {
    const result = await new ReferenceValidator().validate({ path: 'dangerous.md', content: `Read ${source}` });
    assert.equal(result.valid, false, source);
    assert.ok(result.errors.some(error => error.code === 'REF_E002'), source);
  }
});

test('only raster data image destinations receive the image exception', async () => {
  const image = 'data:image/png;base64,iVBORw0KGgo=';
  const validator = new ReferenceValidator();
  assert.equal((await validator.validate({ path: 'image.md', content: `![pixel](${image})` })).valid, true);
  for (const source of [`[link](${image})`, `Plain ${image}`, '![x](data:text/html;base64,PHNjcmlwdD4=)', '![x](data:image/svg+xml;base64,PHN2Zz4=)', '![x](javascript:alert(1))']) {
    const result = await validator.validate({ path: 'image.md', content: source });
    assert.equal(result.valid, false, source);
    assert.ok(result.errors.some(error => error.code === 'REF_E002'), source);
  }
  const large = await validator.validate({ path: 'image.md', content: `![large](data:image/png;base64,${'A'.repeat(15000)})` });
  assert.ok(large.warnings.some(warning => warning.code === 'REF_W006'));
});
