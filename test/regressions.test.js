// Regression tests for bugs fixed during the Node 24 modernization
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatPdfTextToMarkdown } = require('../lib/pdfConverter');
const { optimizeMarkdown, splitFrontmatter } = require('../lib/tokenOptimizer');
const { processDocumentForKb } = require('../lib/knowledgeBaseService');
const { chunkMarkdownForRag, toJsonlRecord } = require('../lib/semanticChunker');
const { buildKnowledgeBase, recommendContextStrategy, FULL_CONTEXT_MAX_TOKENS } = require('../lib/knowledgeBaseService');
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

test('optimizer never stacks frontmatters when re-run on its own output', () => {
  const once = optimizeMarkdown('# Titre\n\nCorps.\n\n## Section\n\nTexte.', { injectFrontmatter: true });
  const twice = optimizeMarkdown(once.optimizedMarkdown, { injectFrontmatter: true });
  assert.equal(twice.optimizedMarkdown, once.optimizedMarkdown);
  assert.equal(twice.optimizedMarkdown.match(/^---$/gm).length, 2);
  assert.equal(splitFrontmatter(twice.optimizedMarkdown).body, twice.body);
});

test('optimizer keeps a hand-written frontmatter when not regenerating it', () => {
  const src = '---\nauthor: moi\n---\n\n# T\n\nCorps.';
  assert.equal(optimizeMarkdown(src).optimizedMarkdown, src);
  assert.equal(optimizeMarkdown(src, { level: 'raw' }).optimizedMarkdown, src);
});

test('KB processing chunks the body, not the YAML frontmatter', () => {
  const doc = processDocumentForKb('# Titre\n\nCorps du document.', 'a.md', { injectFrontmatter: true });
  assert.match(doc.markdown, /^---\ntitle: "Titre"/);
  assert.ok(doc.rag.chunks.every(c => !c.content.includes('title: "Titre"')));
});

// ---- RAG best practices (min chunk floor, contextual embedding text, tables, overlap, strategy) ----

const para = (topic, n = 40) => Array.from({ length: n }, (_, i) => `${topic} phrase ${i}.`).join(' ');

test('chunker merges tiny adjacent sections up to the minTokens floor', () => {
  const md = '# Guide\n\n## Contact\n\nsupport@x.io\n\n## Horaires\n\n9h-18h\n\n## Adresse\n\n1 rue de Paris';
  const merged = chunkMarkdownForRag(md, { docTitle: 'Guide', maxTokens: 600 });
  assert.equal(merged.totalChunks, 1);
  const c = merged.chunks[0];
  assert.match(c.content, /## Contact[\s\S]*## Horaires[\s\S]*## Adresse/, 'inner headings are kept as structure');
  assert.deepEqual(c.breadcrumbs, ['Guide'], 'merged chunk is filed under the common parent');

  assert.equal(chunkMarkdownForRag(md, { docTitle: 'Guide', minTokens: 0 }).totalChunks, 3);
});

test('chunker never merges past maxTokens and folds a trailing fragment into its predecessor', () => {
  const md = `## A\n\n${para('alpha')}\n\n## B\n\n${para('beta')}\n\n## Fin\n\nOK.`;
  const rag = chunkMarkdownForRag(md, { maxTokens: 300, minTokens: 150 });
  for (const c of rag.chunks) assert.ok(c.tokenCount <= 300, `chunk of ${c.tokenCount} tokens`);
  assert.ok(rag.chunks.every(c => c.tokenCount >= 150 || rag.totalChunks === 1), 'no fragment under the floor');
  assert.match(rag.chunks.at(-1).content, /## Fin\n\nOK\./);
});

test('chunks carry a contextual embedding_text (breadcrumbs + content)', () => {
  const md = '# Manuel\n\n## Configuration\n\n### Port\n\nMettre la valeur à 3000 en production.';
  const [chunk] = chunkMarkdownForRag(md, { docTitle: 'Manuel', minTokens: 0 }).chunks;
  assert.equal(chunk.embeddingText, `Manuel > Configuration > Port\n\n${chunk.content}`);
  const record = JSON.parse(toJsonlRecord(chunk));
  assert.equal(record.text, chunk.content, 'text stays clean for prompt injection');
  assert.equal(record.embedding_text, chunk.embeddingText);

  // records coming back from the client (snake_case, breadcrumbs as a string) still get one
  const legacy = JSON.parse(toJsonlRecord({ id: 'x', breadcrumbs: 'Doc > S', text: 'corps' }));
  assert.equal(legacy.embedding_text, 'Doc > S\n\ncorps');
});

test('oversized tables are split by rows with the header repeated in every chunk', () => {
  const header = '| Produit | Prix | Stock |\n|---|---|---|';
  const rows = Array.from({ length: 120 }, (_, i) => `| Article numéro ${i} | ${i}.99 | ${i * 3} |`);
  const md = `## Catalogue\n\n${header}\n${rows.join('\n')}`;
  const rag = chunkMarkdownForRag(md, { maxTokens: 200, overlapTokens: 0 });
  assert.ok(rag.totalChunks > 2);
  for (const c of rag.chunks) {
    assert.ok(c.content.includes(header), `chunk ${c.chunkIndex} lost the table header`);
    assert.ok(c.tokenCount <= 205, `chunk of ${c.tokenCount} tokens`);
  }
  const allRows = rag.chunks.flatMap(c => c.content.split('\n').filter(l => l.startsWith('| Article')));
  assert.equal(new Set(allRows).size, 120, 'every row is kept');
});

test('overlap defaults to 15 % of maxTokens and 0 disables it', () => {
  const md = `## S\n\n${Array.from({ length: 12 }, (_, i) => para(`p${i}`, 6)).join('\n\n')}`;
  const withDefault = chunkMarkdownForRag(md, { maxTokens: 200 });
  // paragraphs (~30 tokens) exceed the 30-token budget: the last sentences are carried instead
  const lastSentence = withDefault.chunks[0].content.split('\n\n').pop().split(' ').slice(-3).join(' ');
  assert.ok(withDefault.chunks[1].content.split('\n\n')[0].endsWith(lastSentence), 'default overlap repeats trailing context');
  for (const c of withDefault.chunks) assert.ok(c.tokenCount <= 200, `chunk of ${c.tokenCount} tokens`);

  const none = chunkMarkdownForRag(md, { maxTokens: 200, overlapTokens: 0 });
  const lastOfFirst = none.chunks[0].content.split('\n\n').pop();
  assert.ok(!none.chunks[1].content.startsWith(lastOfFirst));
});

test('context strategy: full corpus under 200k tokens, RAG above', () => {
  assert.equal(recommendContextStrategy(1_000).strategy, 'full_context');
  assert.equal(recommendContextStrategy(1_000).file, 'llms-full.txt');
  assert.equal(recommendContextStrategy(FULL_CONTEXT_MAX_TOKENS + 1).strategy, 'rag');

  const kb = buildKnowledgeBase([{ filename: 'a.md', markdown: '# A\n\nTexte.' }]);
  assert.equal(kb.manifest.contextStrategy.strategy, 'full_context');
  assert.match(kb.llmsTxt, /load `llms-full\.txt` entirely/);
});

test('a tiny section before an oversized one is packed with it, not left as a fragment', () => {
  const header = '| Produit | Prix |\n|---|---|';
  const rows = Array.from({ length: 80 }, (_, i) => `| Article ${i} | ${i}.99 |`).join('\n');
  const md = `# Catalogue\n\n## Contact\n\nsupport@x.io\n\n## Produits\n\n${header}\n${rows}`;
  const rag = chunkMarkdownForRag(md, { docTitle: 'Catalogue', maxTokens: 200 });
  assert.match(rag.chunks[0].content, /^## Contact\n\nsupport@x\.io\n\n## Produits\n\n\| Produit/);
  assert.ok(rag.chunks.every(c => c.content.includes(header)));
  assert.ok(rag.chunks.every(c => c.tokenCount <= 205));
});
