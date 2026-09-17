const path = require('path');
const archiver = require('archiver');
const { countTokens, analyzeTokens, calculateSavings } = require('./tokenizer');
const { optimizeMarkdown, extractDocumentMetadata } = require('./tokenOptimizer');
const { chunkMarkdownForRag } = require('./semanticChunker');
const { generateLlmsTxt, generateLlmsFullTxt, generateLlmsSmallTxt } = require('./llmsTxtGenerator');

/**
 * Processes a single converted document with token optimization and optional RAG chunking
 * @param {string} rawMarkdown 
 * @param {string} filename 
 * @param {object} [options]
 * @param {'raw'|'clean'|'ultra_compact'} [options.level='clean']
 * @param {boolean} [options.injectFrontmatter=false]
 * @param {boolean} [options.includeRagChunks=true]
 * @param {number} [options.chunkMaxTokens=600]
 * @returns {object}
 */
function processDocumentForKb(rawMarkdown, filename, options = {}) {
  const {
    level = 'clean',
    injectFrontmatter = false,
    includeRagChunks = true,
    chunkMaxTokens = 600
  } = options;

  const baseName = path.basename(filename, path.extname(filename));
  const outputFilename = `${baseName}.md`;

  // Run token optimization
  const optimization = optimizeMarkdown(rawMarkdown, {
    level,
    injectFrontmatter,
    filename: outputFilename
  });

  const finalMarkdown = optimization.optimizedMarkdown;
  const tokenStats = analyzeTokens(finalMarkdown);
  const savings = optimization.savings;

  let ragData = null;
  if (includeRagChunks) {
    ragData = chunkMarkdownForRag(finalMarkdown, {
      maxTokens: chunkMaxTokens,
      docId: baseName.replace(/[^\w-]/g, '_'),
      docTitle: optimization.meta.title || baseName
    });
  }

  return {
    filename: outputFilename,
    originalFilename: filename,
    markdown: finalMarkdown,
    rawMarkdown,
    meta: optimization.meta,
    tokenStats,
    savings,
    rag: ragData
  };
}

/**
 * Builds a complete Knowledge Base from a collection of documents
 * @param {Array<{ filename: string, markdown: string }>} documents 
 * @param {object} [options]
 * @param {string} [options.projectTitle='Knowledge Base']
 * @param {string} [options.summary='Curated knowledge base optimized for LLM reasoning and token reduction.']
 * @param {'raw'|'clean'|'ultra_compact'} [options.level='clean']
 * @param {number} [options.chunkMaxTokens=600]
 * @returns {object}
 */
function buildKnowledgeBase(documents, options = {}) {
  const {
    projectTitle = 'Knowledge Base',
    summary = 'Curated knowledge base optimized for LLM reasoning and token reduction.',
    level = 'clean',
    chunkMaxTokens = 600
  } = options;

  const processedDocs = [];
  const allRagChunks = [];
  let totalOriginalTokens = 0;
  let totalOptimizedTokens = 0;

  for (const doc of documents) {
    const processed = processDocumentForKb(doc.markdown, doc.filename, {
      level,
      injectFrontmatter: true,
      includeRagChunks: true,
      chunkMaxTokens
    });

    processedDocs.push(processed);
    totalOriginalTokens += processed.savings.originalTokens;
    totalOptimizedTokens += processed.savings.optimizedTokens;

    if (processed.rag && processed.rag.chunks) {
      allRagChunks.push(...processed.rag.chunks);
    }
  }

  // Generate llms.txt standard files
  const llmsTxtDocs = processedDocs.map(d => ({
    filename: d.filename,
    markdown: d.markdown,
    title: d.meta.title,
    description: d.meta.description
  }));

  const llmsTxt = generateLlmsTxt(llmsTxtDocs, { projectTitle, summary });
  const llmsFullTxt = generateLlmsFullTxt(llmsTxtDocs, { projectTitle, summary });
  const llmsSmallTxt = generateLlmsSmallTxt(llmsTxtDocs, { projectTitle, summary });

  // Unified JSONL for vector DBs
  const ragJsonl = allRagChunks.map(c => JSON.stringify({
    id: c.id,
    doc_id: c.docId,
    doc_title: c.docTitle,
    chunk_index: c.chunkIndex,
    title: c.title,
    breadcrumbs: c.breadcrumbsStr,
    token_count: c.tokenCount,
    text: c.content
  })).join('\n');

  const tokensSaved = Math.max(0, totalOriginalTokens - totalOptimizedTokens);
  const savingsPct = totalOriginalTokens > 0 ? +((tokensSaved / totalOriginalTokens) * 100).toFixed(1) : 0;

  const manifest = {
    title: projectTitle,
    summary,
    generatedAt: new Date().toISOString(),
    optimizationLevel: level,
    documentCount: processedDocs.length,
    totalOriginalTokens,
    totalOptimizedTokens,
    tokensSaved,
    savingsPercentage: savingsPct,
    totalRagChunks: allRagChunks.length,
    files: processedDocs.map(d => ({
      filename: d.filename,
      originalFilename: d.originalFilename,
      title: d.meta.title,
      tokens: d.tokenStats.tokens,
      savings: d.savings.savingsPercentage
    }))
  };

  return {
    manifest,
    llmsTxt,
    llmsFullTxt,
    llmsSmallTxt,
    ragJsonl,
    ragChunks: allRagChunks,
    documents: processedDocs,
    stats: {
      totalOriginalTokens,
      totalOptimizedTokens,
      tokensSaved,
      savingsPercentage: savingsPct,
      totalRagChunks: allRagChunks.length
    }
  };
}

/**
 * Writes knowledge base archive into a zip stream
 * @param {object} kbData Data returned by buildKnowledgeBase
 * @param {import('stream').Writable} destinationStream 
 */
function exportKnowledgeBaseZip(kbData, destinationStream) {
  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.on('error', (err) => {
    throw err;
  });

  archive.pipe(destinationStream);

  // 1. Standard llms.txt files at root
  archive.append(kbData.llmsTxt, { name: 'llms.txt' });
  archive.append(kbData.llmsFullTxt, { name: 'llms-full.txt' });
  archive.append(kbData.llmsSmallTxt, { name: 'llms-small.txt' });

  // 2. Vector DB / RAG chunks
  archive.append(kbData.ragJsonl, { name: 'rag-chunks.jsonl' });

  // 3. Manifest metadata
  archive.append(JSON.stringify(kbData.manifest, null, 2), { name: 'manifest.json' });

  // 4. Individual Markdown documents
  kbData.documents.forEach(doc => {
    archive.append(doc.markdown, { name: `docs/${doc.filename}` });
  });

  return archive.finalize();
}

module.exports = {
  processDocumentForKb,
  buildKnowledgeBase,
  exportKnowledgeBaseZip
};
