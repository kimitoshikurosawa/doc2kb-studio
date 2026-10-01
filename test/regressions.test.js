// Regression tests for bugs fixed during the Node 24 modernization
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatPdfTextToMarkdown } = require('../lib/pdfConverter');
const { optimizeMarkdown } = require('../lib/tokenOptimizer');
const { chunkMarkdownForRag } = require('../lib/semanticChunker');
const { countTokens } = require('../lib/tokenizer');
const { anonymizeText } = require('../lib/anonymizer');
const { convertHtmlToMarkdown } = require('../lib/htmlConverter');
const { convertTextToMarkdown } = require('../lib/textConverter');
const { analyzeMarkdown } = require('../lib/converter');

test('PDF: lines starting with l/e/t/u are not turned into truncated bullets', () => {
  const md = formatPdfTextToMarkdown('Le contrat est signé.\ntexte important ici.\nunique ligne.');
  assert.ok(!md.includes('- exte'));
  assert.ok(!md.includes('- nique'));
  assert.match(md, /texte important ici\./);
});

test('PDF: decimals are not list items and list numbering is preserved', () => {
  const md = formatPdfTextToMarkdown('Croissance de 1.5 million.\n\n3) troisième étape');
  assert.match(md, /^Croissance de 1\.5 million\./);
  assert.match(md, /3\. troisième étape/);
});

test('PDF: pseudo-tables become valid GFM tables', () => {
  const md = formatPdfTextToMarkdown('Nom     Prix     Stock\nClavier     79     150\nSouris     49     200');
  assert.equal(md, '|Nom|Prix|Stock|\n|---|---|---|\n|Clavier|79|150|\n|Souris|49|200|');
});

test('optimizer never alters fenced code blocks', () => {
  const code = '```yaml\nkey: 1\n---\nlist:\n  -\n  - a\nPage 3\n|  a  |  b  |\n```';
  const res = optimizeMarkdown(`# Doc\n\n${code}\n\nTexte.`, { level: 'ultra_compact' });
  assert.ok(res.optimizedMarkdown.includes(code));
});

test('optimizer strips base64 data URI images', () => {
  const blob = 'A'.repeat(20000);
  const res = optimizeMarkdown(`# Doc\n\n![Logo société](data:image/png;base64,${blob})`, { level: 'clean' });
  assert.match(res.optimizedMarkdown, /\[Image: Logo société\]/);
  assert.ok(!res.optimizedMarkdown.includes(blob));
  assert.ok(res.savings.savingsPercentage > 90);
});

test('frontmatter values are valid escaped YAML strings', () => {
  const res = optimizeMarkdown('# Titre "cité" \\ backslash\n\nCorps.', { injectFrontmatter: true });
  assert.match(res.optimizedMarkdown, /^---\ntitle: "Titre \\"cité\\" \\\\ backslash"\n/);
});

test('chunker ignores headings inside code blocks', () => {
  const md = '# Guide\n\nInstallation :\n\n```bash\n# installer les dépendances\nnpm ci\n```';
  const rag = chunkMarkdownForRag(md, { docTitle: 'Guide' });
  assert.equal(rag.totalChunks, 1);
  assert.match(rag.chunks[0].content, /# installer les dépendances/);
});

test('chunker respects maxTokens even for a single giant paragraph', () => {
  const sentence = 'Le système vectoriel indexe chaque passage avec ses métadonnées hiérarchiques. ';
  const md = `# Section\n\n${sentence.repeat(200)}`;
  const rag = chunkMarkdownForRag(md, { maxTokens: 120 });
  assert.ok(rag.totalChunks > 5);
  for (const c of rag.chunks) assert.ok(c.tokenCount <= 125, `chunk of ${c.tokenCount} tokens`);
  assert.ok(rag.chunks[1].title.endsWith('(Partie 2)'));
});

test('chunker overlap repeats trailing context between consecutive chunks', () => {
  const paragraphs = Array.from({ length: 12 }, (_, i) => `Paragraphe ${i} : ${'contenu technique détaillé '.repeat(8)}`);
  const md = `# Doc\n\n${paragraphs.join('\n\n')}`;
  const rag = chunkMarkdownForRag(md, { maxTokens: 200, overlapTokens: 60 });
  assert.ok(rag.totalChunks >= 3);
  const lastParaOfFirst = rag.chunks[0].content.split('\n\n').pop();
  assert.ok(rag.chunks[1].content.startsWith(lastParaOfFirst));
});

test('chunk ids are deterministic (idempotent vector upserts)', () => {
  const a = chunkMarkdownForRag('# A\n\nTexte stable.');
  const b = chunkMarkdownForRag('# A\n\nTexte stable.');
  assert.equal(a.chunks[0].id, b.chunks[0].id);
});

test('anonymizer masks international phone numbers', () => {
  const res = anonymizeText('Call +44 20 7946 0958 or +1 555-123-4567.');
  assert.equal(res.anonymizedText, 'Call [TEL_1] or [TEL_2].');
});

test('anonymizer handles accented/hyphenated names and propagates them', () => {
  const res = anonymizeText('Signé par: Hélène Dupré. Plus tard, Hélène  Dupré a confirmé avec M. Jean-Pierre Martin.');
  // civility titles are resolved before document roles, hence the numbering
  assert.equal(res.anonymizedText, 'Signé par: [PERSONNE_2]. Plus tard, [PERSONNE_2] a confirmé avec M. [PERSONNE_1].');
  assert.equal(res.rehydrationMap['[PERSONNE_1]'], 'Jean-Pierre Martin');
  assert.equal(res.rehydrationMap['[PERSONNE_2]'], 'Hélène Dupré');
});

test('anonymizer: same phone in different formats gets one pseudonym', () => {
  const res = anonymizeText('06 12 34 56 78 / +33 6 12 34 56 78 / 06.12.34.56.78');
  assert.equal(res.anonymizedText, '[TEL_1] / [TEL_1] / [TEL_1]');
});

test('HTML converter drops script/style content', () => {
  const md = convertHtmlToMarkdown('<style>.a{color:red}</style><p>Texte</p><script>alert(1)</script>');
  assert.equal(md, 'Texte');
});

test('rendered preview never contains raw HTML from documents (XSS)', () => {
  const { renderedHtml } = analyzeMarkdown('Bonjour <img src=x onerror="alert(1)"> <script>alert(2)</script>');
  assert.ok(!renderedHtml.includes('<img'));
  assert.ok(!renderedHtml.includes('<script'));
});

test('code files with backticks get a longer fence', () => {
  const md = convertTextToMarkdown('const s = ```nested```;', 'demo.ts');
  assert.ok(md.startsWith('````ts\n'));
  assert.ok(md.endsWith('\n````'));
});

test('token counting is memoized and stable', () => {
  const text = 'Phrase de test pour le cache LRU. '.repeat(500);
  assert.equal(countTokens(text), countTokens(text));
});
