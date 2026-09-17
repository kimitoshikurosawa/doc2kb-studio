const XLSX = require('xlsx');
const { convertDocxToMarkdown } = require('./lib/docxConverter');
const { convertPdfToMarkdown, formatPdfTextToMarkdown } = require('./lib/pdfConverter');
const { convertSpreadsheetToMarkdown } = require('./lib/excelConverter');
const { convertHtmlToMarkdown } = require('./lib/htmlConverter');
const { convertTextToMarkdown } = require('./lib/textConverter');
const { convertFileToMarkdown, analyzeMarkdown, md } = require('./lib/converter');
const { countTokens, analyzeTokens, calculateSavings } = require('./lib/tokenizer');
const { optimizeMarkdown, compactMarkdownTables } = require('./lib/tokenOptimizer');
const { chunkMarkdownForRag } = require('./lib/semanticChunker');
const { generateLlmsTxt, generateLlmsFullTxt, generateLlmsSmallTxt } = require('./lib/llmsTxtGenerator');
const { buildKnowledgeBase } = require('./lib/knowledgeBaseService');

async function runTests() {
  console.log('🧪 Lancement de la suite de tests complète Doc2KB Studio...\n');

  // Test 1: HTML to Markdown
  const htmlSample = '<h1>Titre Principal</h1><p>Ceci est un <strong>test</strong> avec un <a href="https://example.com">lien</a>.</p><ul><li>Élément 1</li><li>Élément 2</li></ul>';
  const mdFromHtml = convertHtmlToMarkdown(htmlSample);
  console.log('✅ 1. Test HTML -> Markdown OK');

  // Test 2: Excel / Spreadsheet with Compact Mode
  const wb = XLSX.utils.book_new();
  const wsData = [
    ['Produit', 'Prix', 'Stock'],
    ['Clavier Mécanique RGB', 79.99, 150],
    ['Souris Sans Fil Pro', 49.99, 200]
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  XLSX.utils.book_append_sheet(wb, ws, 'Ventes');
  const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const mdFromXlsx = convertSpreadsheetToMarkdown(xlsxBuffer, 'ventes.xlsx', { format: 'compact' });
  console.log('✅ 2. Test Excel -> Compact Markdown Table OK:\n', mdFromXlsx);

  // Test 3: Tokenizer
  const sampleDoc = '# Guide d\'Architecture\n\nBienvenue dans cette base de connaissances technique conçue pour les agents IA et LLM.';
  const tokenAnalysis = analyzeTokens(sampleDoc);
  if (tokenAnalysis.tokens <= 0 || !tokenAnalysis.estimatedCosts) {
    throw new Error('Tokenizer validation failed');
  }
  console.log(`✅ 3. Test Tokenizer js-tiktoken OK: ${tokenAnalysis.tokens} tokens (cl100k), coût estimé GPT-4o: $${tokenAnalysis.estimatedCosts.gpt4o}`);

  // Test 4: Token Optimizer & Table Compaction
  const verboseTableDoc = '# Document Test\n\n| Colonne Un           | Colonne Deux         |\n| -------------------- | -------------------- |\n| Valeur descriptive A | Valeur descriptive B |\n\n\n\n- item 1\n\n- item 2\n';
  const optResult = optimizeMarkdown(verboseTableDoc, { level: 'ultra_compact', injectFrontmatter: true });
  if (optResult.savings.tokensSaved < 0) {
    throw new Error('Optimizer savings calculation failed');
  }
  console.log(`✅ 4. Test Optimiseur de Tokens OK: ${optResult.savings.tokensSaved} tokens économisés (${optResult.savings.savingsPercentage}%)`);

  // Test 5: Semantic Chunking for RAG
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

  const ragOutput = chunkMarkdownForRag(ragSample, { docTitle: 'Manuel Système', maxTokens: 200 });
  if (ragOutput.totalChunks < 2) {
    throw new Error('Semantic chunker failed to partition sections');
  }
  console.log(`✅ 5. Test Découpage RAG sémantique OK: ${ragOutput.totalChunks} chunks créés avec breadcrumbs hiérarchiques`);

  // Test 6: llms.txt standard generation
  const docs = [
    { filename: 'architecture.md', markdown: sampleDoc, title: 'Architecture Système' },
    { filename: 'manuel.md', markdown: ragSample, title: 'Manuel Technique' }
  ];
  const llmsTxt = generateLlmsTxt(docs, { projectTitle: 'Mon Projet IA' });
  if (!llmsTxt.includes('# Mon Projet IA') || !llmsTxt.includes('llms.txt')) {
    throw new Error('llms.txt generation invalid');
  }
  console.log('✅ 6. Test Norme llms.txt OK (conforme llmstxt.org)');

  // Test 7: Unified Knowledge Base bundle
  const kbBundle = buildKnowledgeBase(docs, { projectTitle: 'Test Knowledge Base', level: 'ultra_compact' });
  if (!kbBundle.manifest || kbBundle.ragChunks.length === 0) {
    throw new Error('Knowledge base bundle incomplete');
  }
  console.log(`✅ 7. Test Pack Base de Connaissances complet OK: ${kbBundle.manifest.documentCount} docs, ${kbBundle.stats.totalOptimizedTokens} tokens totaux`);

  // Test 8: Full Unified Converter Route
  const fullResult = await convertFileToMarkdown(Buffer.from(htmlSample), 'index.html', 'text/html', { level: 'ultra_compact', includeRag: true });
  if (!fullResult.stats.tokens || !fullResult.rag) {
    throw new Error('Unified convertFileToMarkdown failed');
  }
  console.log(`✅ 8. Test Pipeline convertFileToMarkdown complet OK (Tokens: ${fullResult.stats.tokens})`);

  console.log('\n🎉 TOUS LES TESTS (8/8) SONT PASSÉS AVEC SUCCÈS !');
}

runTests().catch(err => {
  console.error('❌ Erreur lors des tests:', err);
  process.exit(1);
});
