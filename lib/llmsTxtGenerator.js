const { countTokens } = require('./tokenizer');
const { extractDocumentMetadata } = require('./tokenOptimizer');

/**
 * Generates an llms.txt compliant file according to the llmstxt.org specification
 * 
 * @param {Array<{ filename: string, markdown: string, title?: string, description?: string }>} documents
 * @param {object} options
 * @param {string} [options.projectTitle='Knowledge Base']
 * @param {string} [options.summary='Curated knowledge base optimized for LLM reasoning, RAG ingestion, and token efficiency.']
 * @returns {string}
 */
function generateLlmsTxt(documents, options = {}) {
  const {
    projectTitle = 'Knowledge Base',
    summary = 'Curated knowledge base optimized for LLM reasoning, RAG ingestion, and token efficiency.'
  } = options;

  const lines = [
    `# ${projectTitle}`,
    '',
    `> ${summary}`,
    '',
    '## Documentation & Knowledge Files',
    ''
  ];

  if (!documents || documents.length === 0) {
    lines.push('- No documents available in this knowledge base.');
    return lines.join('\n');
  }

  documents.forEach((doc) => {
    const meta = extractDocumentMetadata(doc.markdown, doc.filename);
    const title = doc.title || meta.title || doc.filename;
    const tokens = countTokens(doc.markdown);
    const desc = doc.description || meta.description || 'Reference documentation.';
    const cleanDesc = desc.replace(/[\r\n]+/g, ' ').slice(0, 160);

    const relPath = doc.filename.endsWith('.md') ? doc.filename : `${doc.filename}.md`;
    lines.push(`- [${title}](${relPath}): ${cleanDesc} (Tokens: ~${tokens})`);
  });

  lines.push('');
  lines.push('## Topics & Key Concepts');
  lines.push('');

  // Aggregate keywords
  const allKeywords = new Set();
  documents.forEach(doc => {
    const meta = extractDocumentMetadata(doc.markdown, doc.filename);
    (meta.keywords || []).forEach(k => allKeywords.add(k));
  });

  if (allKeywords.size > 0) {
    const keywordList = Array.from(allKeywords).slice(0, 20);
    lines.push(`Keywords: ${keywordList.join(', ')}`);
    lines.push('');
  }

  lines.push('## Ingestion Notes for AI Agents');
  lines.push('');
  lines.push('- Standard: [llms.txt](https://llmstxt.org/) format for automated AI context ingestion.');
  lines.push('- For full comprehensive corpus, consult `llms-full.txt`.');
  lines.push('- For vector databases and embeddings, consult `rag-chunks.jsonl`.');

  return lines.join('\n');
}

/**
 * Generates llms-full.txt concatenating all documents into an ultra-clean, structured corpus
 * @param {Array<{ filename: string, markdown: string, title?: string }>} documents 
 * @param {object} options
 * @returns {string}
 */
function generateLlmsFullTxt(documents, options = {}) {
  const {
    projectTitle = 'Knowledge Base - Full Corpus',
    summary = 'Complete knowledge base corpus for high-context LLMs.'
  } = options;

  const lines = [
    `# ${projectTitle}`,
    '',
    `> ${summary}`,
    '',
    '---',
    ''
  ];

  documents.forEach((doc, idx) => {
    const meta = extractDocumentMetadata(doc.markdown, doc.filename);
    const title = doc.title || meta.title || doc.filename;
    const tokens = countTokens(doc.markdown);

    lines.push(`## Document ${idx + 1}: ${title}`);
    lines.push(`*Source: ${doc.filename} | Tokens: ~${tokens}*`);
    lines.push('');
    lines.push(doc.markdown.trim());
    lines.push('');
    lines.push('---');
    lines.push('');
  });

  return lines.join('\n');
}

/**
 * Generates llms-small.txt (digest summary for quick context windows)
 * @param {Array<{ filename: string, markdown: string, title?: string }>} documents 
 * @param {object} options 
 * @returns {string}
 */
function generateLlmsSmallTxt(documents, options = {}) {
  const {
    projectTitle = 'Knowledge Base - Executive Digest',
    summary = 'Compact overview of key facts and structure.'
  } = options;

  const lines = [
    `# ${projectTitle}`,
    '',
    `> ${summary}`,
    '',
    '## Executive Summary of Documents',
    ''
  ];

  documents.forEach((doc, idx) => {
    const meta = extractDocumentMetadata(doc.markdown, doc.filename);
    const title = doc.title || meta.title || doc.filename;

    lines.push(`### ${idx + 1}. ${title}`);
    if (meta.description) {
      lines.push(`> ${meta.description}`);
    }
    if (meta.headings && meta.headings.length > 0) {
      lines.push('Key sections:');
      meta.headings.slice(0, 6).forEach(h => {
        lines.push(`  - ${h.text}`);
      });
    }
    lines.push('');
  });

  return lines.join('\n');
}

module.exports = {
  generateLlmsTxt,
  generateLlmsFullTxt,
  generateLlmsSmallTxt
};
