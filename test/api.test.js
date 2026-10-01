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
