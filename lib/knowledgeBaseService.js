const path = require('node:path');
const { ZipArchive } = require('archiver');
const { analyzeTokens } = require('./tokenizer');
const { optimizeMarkdown } = require('./tokenOptimizer');
const { chunkMarkdownForRag, toJsonlRecord } = require('./semanticChunker');
const { generateLlmsTxt, generateLlmsFullTxt, generateLlmsSmallTxt } = require('./llmsTxtGenerator');
const { anonymizeText } = require('./anonymizer');

const KB_DOCS_DIR = 'docs';

/**
 * Processes a single converted document with token optimization and optional RAG chunking
 * @param {string} rawMarkdown 
 * @param {string} filename 
 * @param {object} [options]
 * @param {'raw'|'clean'|'ultra_compact'} [options.level='clean']
 * @param {boolean} [options.injectFrontmatter=false]
 * @param {boolean} [options.includeRagChunks=true]
 * @param {number} [options.chunkMaxTokens=600]
 * @param {number} [options.chunkOverlapTokens=0]
 * @param {boolean} [options.anonymize=false]
 * @param {object} [options.anonymizeOptions]
 * @returns {object}
 */
function processDocumentForKb(rawMarkdown, filename, options = {}) {
  const {
    level = 'clean',
    injectFrontmatter = false,
    includeRagChunks = true,
    chunkMaxTokens = 600,
    chunkOverlapTokens = 0,
    anonymize = false,
    anonymizeOptions = {}
  } = options;

  const baseName = path.basename(filename, path.extname(filename));
  const outputFilename = `${baseName}.md`;

  let inputMarkdown = rawMarkdown;
  let anonymizationData = null;

  if (anonymize) {
    anonymizationData = anonymizeText(rawMarkdown, anonymizeOptions);
    inputMarkdown = anonymizationData.anonymizedText;
  }

  // Run token optimization
  const optimization = optimizeMarkdown(inputMarkdown, {
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
      overlapTokens: chunkOverlapTokens,
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
    rag: ragData,
    anonymization: anonymizationData ? {
      stats: anonymizationData.stats,
      entitiesCount: anonymizationData.entities.length,
      rehydrationMap: anonymizationData.rehydrationMap
    } : null
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
    chunkMaxTokens = 600,
    chunkOverlapTokens = 0,
    anonymize = false,
    anonymizeOptions = {}
  } = options;

  const processedDocs = [];
  const allRagChunks = [];
  const usedNames = new Set();
  let totalOriginalTokens = 0;
  let totalOptimizedTokens = 0;
  let totalAnonymizedEntities = 0;

  for (const doc of documents) {
    const processed = processDocumentForKb(doc.markdown, doc.filename, {
      level,
      injectFrontmatter: true,
      includeRagChunks: true,
      chunkMaxTokens,
      chunkOverlapTokens,
      anonymize,
      anonymizeOptions
    });

    // Two uploads named "readme.docx" must not overwrite each other in the archive
    let name = processed.filename;
    for (let n = 2; usedNames.has(name); n++) {
      name = processed.filename.replace(/\.md$/, `-${n}.md`);
    }
    usedNames.add(name);
    processed.filename = name;

    processedDocs.push(processed);
    totalOriginalTokens += processed.savings.originalTokens;
    totalOptimizedTokens += processed.savings.optimizedTokens;
    if (processed.anonymization) {
      totalAnonymizedEntities += processed.anonymization.entitiesCount;
    }

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

  const llmsTxt = generateLlmsTxt(llmsTxtDocs, { projectTitle, summary, basePath: `${KB_DOCS_DIR}/` });
  const llmsFullTxt = generateLlmsFullTxt(llmsTxtDocs, { projectTitle, summary });
  const llmsSmallTxt = generateLlmsSmallTxt(llmsTxtDocs, { projectTitle, summary });

  // Unified JSONL for vector DBs
  const ragJsonl = allRagChunks.map(toJsonlRecord).join('\n');

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
    totalAnonymizedEntities,
    totalRagChunks: allRagChunks.length,
    files: processedDocs.map(d => ({
      filename: d.filename,
      originalFilename: d.originalFilename,
      title: d.meta.title,
      tokens: d.tokenStats.tokens,
      savings: d.savings.savingsPercentage,
      anonymizedCount: d.anonymization ? d.anonymization.entitiesCount : 0
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
      totalAnonymizedEntities,
      totalRagChunks: allRagChunks.length
    }
  };
}

/**
 * Writes knowledge base archive into a zip stream
 * @param {object} kbData Data returned by buildKnowledgeBase
 * @param {import('node:stream').Writable} destinationStream
 * @returns {Promise<void>} resolves once the archive is fully written, rejects on archive errors
 */
function exportKnowledgeBaseZip(kbData, destinationStream) {
  const archive = new ZipArchive({ zlib: { level: 9 } });

  const done = new Promise((resolve, reject) => {
    archive.on('error', (err) => {
      // Never throw from an event handler (it would crash the process): abort the output instead
      destinationStream.destroy(err);
      reject(err);
    });
    archive.on('end', resolve);
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
    archive.append(doc.markdown, { name: `${KB_DOCS_DIR}/${doc.filename}` });
  });

  archive.finalize();
  return done;
}

module.exports = {
  processDocumentForKb,
  buildKnowledgeBase,
  exportKnowledgeBaseZip
};
