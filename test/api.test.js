const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('../server');

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise(resolve => server.close(resolve)));

test('GET /api/status exposes version, runtime and pricing catalogue', async () => {
  const res = await fetch(`${baseUrl}/api/status`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  const body = await res.json();
  assert.equal(body.version, require('../package.json').version);
  assert.ok(body.pricing.models.length > 0);
});

test('POST /api/convert handles UTF-8 filenames', async () => {
  const form = new FormData();
  form.append('file', new Blob(['# Résumé\n\nContenu du document.'], { type: 'text/markdown' }), 'Élodie résumé.md');
  form.append('level', 'clean');
  const res = await fetch(`${baseUrl}/api/convert`, { method: 'POST', body: form });
  assert.equal(res.status, 200);
  const { result } = await res.json();
  assert.equal(result.originalFilename, 'Élodie résumé.md');
  assert.equal(result.outputFilename, 'Élodie résumé.md');
});

test('POST /api/convert-batch keeps input order and isolates failures', async () => {
  const form = new FormData();
  form.append('files', new Blob(['# Un\n\nA']), 'un.md');
  form.append('files', new Blob(['ancien format']), 'legacy.doc');
  form.append('files', new Blob(['# Trois\n\nC']), 'trois.md');
  const res = await fetch(`${baseUrl}/api/convert-batch`, { method: 'POST', body: form });
  const body = await res.json();
  assert.deepEqual(body.results.map(r => [r.originalFilename, r.success]), [
    ['un.md', true], ['legacy.doc', false], ['trois.md', true]
  ]);
});

test('POST /api/optimize-text validates and clamps options', async () => {
  const res = await fetch(`${baseUrl}/api/optimize-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '# T\n\nCorps.', level: 'nope', chunkMaxTokens: 1 })
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.rag.totalChunks, 1);
});

const PII_DOC = '# Fiche\n\nSalarié: Marie Martin\n\nEmail: marie.martin@example.com\n\n| A  |  B |\n|---|---|\n|  1 |  2 |';

test('POST /api/convert without anonymization keeps content intact', async () => {
  const form = new FormData();
  form.append('file', new Blob([PII_DOC], { type: 'text/markdown' }), 'fiche.md');
  form.append('anonymize', 'false');
  form.append('anonymizeMode', 'pseudonymize');
  form.append('compactTables', 'false');
  const res = await fetch(`${baseUrl}/api/convert`, { method: 'POST', body: form });
  assert.equal(res.status, 200);
  const { result } = await res.json();
  assert.equal(result.anonymization, null);
  assert.match(result.markdown, /Marie Martin/);
  assert.match(result.markdown, /marie\.martin@example\.com/);
  assert.match(result.markdown, /\|  1 \|  2 \|/, 'compactTables=false must leave tables untouched');
});

test('POST /api/optimize-text without anonymization, on an already processed document', async () => {
  const post = (body) => fetch(`${baseUrl}/api/optimize-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(r => r.json());

  const first = await post({ text: PII_DOC, filename: 'fiche.md', anonymize: false, injectFrontmatter: true });
  const second = await post({ text: first.optimizedMarkdown, filename: 'fiche.md', anonymize: false, injectFrontmatter: true });
  assert.equal(second.anonymization, null);
  assert.equal(second.optimizedMarkdown, first.optimizedMarkdown, 're-optimizing must be idempotent');
  assert.equal(second.rag.chunks[0].id, first.rag.chunks[0].id);
  assert.equal(second.savings.tokensSaved, 0, 'nothing left to save on an optimized document');
  assert.ok(!second.rag.chunks[0].content.startsWith('---'), 'frontmatter must not be chunked');
});

test('POST /api/convert-batch recommends a context strategy', async () => {
  const form = new FormData();
  form.append('files', new Blob(['# Un\n\nA']), 'un.md');
  const body = await fetch(`${baseUrl}/api/convert-batch`, { method: 'POST', body: form }).then(r => r.json());
  assert.equal(body.tokenEconomy.contextStrategy.strategy, 'full_context');
});

test('chunking options: explicit 0 is honoured, absent means defaults', async () => {
  const text = `## S\n\n${Array.from({ length: 30 }, (_, i) => `Paragraphe ${i} avec un peu de contenu utile.`).join('\n\n')}`;
  const post = (extra) => fetch(`${baseUrl}/api/optimize-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, chunkMaxTokens: 100, ...extra })
  }).then(r => r.json());
  const [withDefaults, noOverlap] = await Promise.all([post({}), post({ chunkOverlapTokens: 0 })]);
  assert.ok(withDefaults.rag.totalTokens > noOverlap.rag.totalTokens, 'default overlap adds repeated context');
});

test('POST /api/generate-knowledge-base streams a zip', async () => {
  const res = await fetch(`${baseUrl}/api/generate-knowledge-base`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectTitle: 'Demo', documents: [{ filename: 'a.md', markdown: '# A\n\nTexte.' }] })
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/zip');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 2).toString(), 'PK');
  assert.ok(buf.includes(Buffer.from('docs/a.md')));
  assert.ok(buf.includes(Buffer.from('llms.txt')));
});

test('malformed JSON and unknown routes return JSON errors', async () => {
  const bad = await fetch(`${baseUrl}/api/optimize-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{oops'
  });
  assert.equal(bad.status, 400);
  assert.ok((await bad.json()).error);

  const missing = await fetch(`${baseUrl}/api/nope`);
  assert.equal(missing.status, 404);
});

test('client markdown-it bundle is served from node_modules', async () => {
  const res = await fetch(`${baseUrl}/vendor/markdown-it.min.js`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /markdownit/);
});
