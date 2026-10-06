const { test } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { convertHtmlToMarkdown } = require('../lib/htmlConverter');
const { convertSpreadsheetToMarkdown } = require('../lib/excelConverter');
const { convertFileToMarkdown } = require('../lib/converter');
const { analyzeTokens } = require('../lib/tokenizer');
const { optimizeMarkdown } = require('../lib/tokenOptimizer');
const { chunkMarkdownForRag } = require('../lib/semanticChunker');
const { generateLlmsTxt } = require('../lib/llmsTxtGenerator');
const { buildKnowledgeBase } = require('../lib/knowledgeBaseService');
const { anonymizeText, isValidLuhn, isValidIban, isValidFrenchNir } = require('../lib/anonymizer');
const { buildPdf } = require('./helpers');

const htmlSample = '<h1>Titre Principal</h1><p>Ceci est un <strong>test</strong> avec un <a href="https://example.com">lien</a>.</p><ul><li>Élément 1</li><li>Élément 2</li></ul>';
const sampleDoc = '# Guide d\'Architecture\n\nBienvenue dans cette base de connaissances technique conçue pour les agents IA et LLM.';
const ragSample = `# Manuel Système

## 1. Introduction
Ce module gère l'ingestion de documents pour les bases de données vectorielles.

## 2. Configuration
Pour configurer la clé d'API et les paramètres de rétention, éditez le fichier de configuration.

### 2.1 Variables d'environnement
PORT=3000
NODE_ENV=production

## 3. Sécurité
Toutes les données sont traitées en mémoire tampon sans persistance sur disque.`;

test('HTML -> Markdown', () => {
  const md = convertHtmlToMarkdown(htmlSample);
  assert.match(md, /^# Titre Principal/);
  assert.match(md, /\*\*test\*\*/);
  assert.match(md, /- Élément 1/);
});

test('Excel -> compact Markdown table', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Produit', 'Prix', 'Stock'],
    ['Clavier Mécanique RGB', 79.99, 150],
    ['Souris Sans Fil Pro', 49.99, 200]
  ]), 'Ventes');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const md = convertSpreadsheetToMarkdown(buffer, 'ventes.xlsx', { format: 'compact' });
  assert.equal(md, '|Produit|Prix|Stock|\n|---|---|---|\n|Clavier Mécanique RGB|79.99|150|\n|Souris Sans Fil Pro|49.99|200|');
});

test('PDF -> Markdown with pdf-parse v2', async () => {
  const pdf = buildPdf(['RAPPORT ANNUEL', 'Le texte du rapport commence ici.', '- premier point', '- second point']);
  const result = await convertFileToMarkdown(pdf, 'rapport.pdf', 'application/pdf', { includeRag: false });
  assert.match(result.markdown, /## RAPPORT ANNUEL/);
  assert.match(result.markdown, /Le texte du rapport commence ici\./);
  assert.match(result.markdown, /- premier point\n- second point/);
  assert.equal(result.meta.pages, 1);
});

test('tokenizer: o200k primary count + per-model cost estimates', () => {
  const analysis = analyzeTokens(sampleDoc);
  assert.ok(analysis.tokens > 0);
  assert.equal(analysis.tokens, analysis.o200kTokens);
  assert.ok(analysis.cl100kTokens > 0);
  assert.ok(Object.keys(analysis.estimatedCosts).length > 0);
  for (const cost of Object.values(analysis.estimatedCosts)) assert.ok(cost >= 0);
});

test('token optimizer compacts tables and lists', () => {
  const verbose = '# Document Test\n\n| Colonne Un           | Colonne Deux         |\n| -------------------- | -------------------- |\n| Valeur descriptive A | Valeur descriptive B |\n\n\n\n- item 1\n\n- item 2\n';
  const res = optimizeMarkdown(verbose, { level: 'ultra_compact', injectFrontmatter: true });
  assert.ok(res.savings.tokensSaved > 0);
  assert.match(res.optimizedMarkdown, /\|Colonne Un\|Colonne Deux\|/);
  assert.match(res.optimizedMarkdown, /^---\ntitle: "Document Test"/);
});

test('semantic chunker partitions sections with breadcrumbs', () => {
  // minTokens: 0 = one chunk per heading (the default merges these tiny sections)
  const rag = chunkMarkdownForRag(ragSample, { docTitle: 'Manuel Système', maxTokens: 200, minTokens: 0 });
  assert.equal(rag.totalChunks, 4); // the title-only "# Manuel Système" section is not a chunk
  const envChunk = rag.chunks.find(c => c.title === '2.1 Variables d\'environnement');
  assert.ok(envChunk);
  // the H1 repeating the document title is not duplicated in the path
  assert.equal(envChunk.breadcrumbsStr, 'Manuel Système > 2. Configuration > 2.1 Variables d\'environnement');
  assert.equal(rag.jsonl.split('\n').length, 4);
});

test('llms.txt generation follows llmstxt.org layout', () => {
  const llmsTxt = generateLlmsTxt([
    { filename: 'architecture.md', markdown: sampleDoc, title: 'Architecture Système' },
    { filename: 'manuel.md', markdown: ragSample, title: 'Manuel Technique' }
  ], { projectTitle: 'Mon Projet IA' });
  assert.match(llmsTxt, /^# Mon Projet IA\n\n> /);
  assert.match(llmsTxt, /- \[Architecture Système\]\(architecture\.md\): /);
});

test('knowledge base bundle: links point into docs/ and names are unique', () => {
  const kb = buildKnowledgeBase([
    { filename: 'readme.docx', markdown: sampleDoc },
    { filename: 'readme.pdf', markdown: ragSample }
  ], { projectTitle: 'Test Knowledge Base', level: 'ultra_compact' });
  assert.equal(kb.manifest.documentCount, 2);
  assert.ok(kb.ragChunks.length > 0);
  assert.deepEqual(kb.documents.map(d => d.filename), ['readme.md', 'readme-2.md']);
  assert.match(kb.llmsTxt, /\]\(docs\/readme\.md\)/);
  assert.match(kb.llmsTxt, /\]\(docs\/readme-2\.md\)/);
});

test('full convertFileToMarkdown pipeline', async () => {
  const res = await convertFileToMarkdown(Buffer.from(htmlSample), 'index.html', 'text/html', { level: 'ultra_compact', includeRag: true });
  assert.ok(res.stats.tokens > 0);
  assert.ok(res.rag.totalChunks > 0);
  assert.equal(res.outputFilename, 'index.md');
});

test('anonymizer checksums', () => {
  assert.ok(isValidLuhn('4532015000000007'));
  assert.ok(!isValidLuhn('4532015000000004'));
  assert.ok(isValidIban('FR7630006000011234567890189'));
  assert.ok(!isValidIban('FR7630006000011234567890180'));
  assert.ok(isValidFrenchNir('185127510804279'));
  assert.ok(!isValidFrenchNir('185127510804299'));
});

test('anonymizer: consistent pseudonymization + rehydration map', () => {
  const pii = `
Document confidentiel approuvé par Dr. Alice Martin et M. Thomas Dubois.
Contact: Dr. Alice Martin (alice.martin@example.corp / +33 6 12 34 56 78).
Facturation IBAN: FR76 3000 6000 0112 3456 7890 189
Carte test: 4532 0150 0000 0007
NIR: 1 85 12 75 108 042 79
Clé secrète: sk-proj-abcdef1234567890abcdef1234567890abcdef123456
IP: 192.168.1.100`;
  const res = anonymizeText(pii, { mode: 'pseudonymize' });
  assert.ok(res.entities.length >= 8);
  assert.equal((res.anonymizedText.match(/\[PERSONNE_1\]/g) || []).length, 2);
  assert.equal(res.rehydrationMap['[PERSONNE_1]'], 'Alice Martin');
  for (const secret of ['alice.martin@example.corp', 'FR76 3000', '4532 0150', 'sk-proj-', '192.168.1.100']) {
    assert.ok(!res.anonymizedText.includes(secret), `leaked: ${secret}`);
  }
});

test('pipeline with anonymization never leaks PII', async () => {
  const text = 'Projet Alpha - Validation par Dr. Alice Martin. Contrat signé par: Thomas Dubois. Email: thomas.dubois@test.com. IBAN: FR76 3000 6000 0112 3456 7890 189.';
  const res = await convertFileToMarkdown(Buffer.from(text), 'contrat.txt', 'text/plain', {
    level: 'clean',
    anonymize: true,
    anonymizeOptions: { mode: 'pseudonymize' }
  });
  assert.ok(res.anonymization.entitiesCount >= 4);
  assert.ok(!res.markdown.includes('thomas.dubois@test.com'));
  assert.ok(!res.markdown.includes('FR76 3000 6000 0112 3456 7890 189'));
  assert.ok(!res.rag.jsonl.includes('Thomas Dubois'));
});
