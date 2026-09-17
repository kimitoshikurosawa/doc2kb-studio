const path = require('node:path');
const MarkdownIt = require('markdown-it');
const { convertDocxToMarkdown } = require('./docxConverter');
const { convertPdfToMarkdown } = require('./pdfConverter');
const { convertSpreadsheetToMarkdown } = require('./excelConverter');
const { convertHtmlToMarkdown } = require('./htmlConverter');
const { convertTextToMarkdown } = require('./textConverter');
const { convertImageToMarkdown } = require('./ocrConverter');
const { analyzeTokens, calculateSavings } = require('./tokenizer');
const { processDocumentForKb } = require('./knowledgeBaseService');

// Initialize markdown-it instance
const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: true
});

/**
 * Extract comprehensive statistics including token economy and markdown-it rendering
 * @param {string} markdown 
 * @param {string} [originalRawMarkdown]
 * @returns {object}
 */
function analyzeMarkdown(markdown, originalRawMarkdown = null) {
  const html = md.render(markdown || '');
  const tokenStats = analyzeTokens(markdown || '');

  const headerMatches = (markdown || '').match(/^#{1,6}\s+.+$/gm) || [];
  const linkMatches = (markdown || '').match(/\[(.*?)\]\((.*?)\)/g) || [];
  const imageMatches = (markdown || '').match(/!\[(.*?)\]\((.*?)\)/g) || [];
  const tableRowMatches = (markdown || '').match(/^\s*\|.*\|\s*$/gm) || [];

  let savings = null;
  if (originalRawMarkdown && originalRawMarkdown !== markdown) {
    savings = calculateSavings(originalRawMarkdown, markdown);
  }

  return {
    renderedHtml: html,
    stats: {
      tokens: tokenStats.tokens,
      cl100kTokens: tokenStats.cl100kTokens,
      o200kTokens: tokenStats.o200kTokens,
      words: tokenStats.words,
      chars: tokenStats.chars,
      tokensPerWord: tokenStats.tokensPerWord,
      estimatedCosts: tokenStats.estimatedCosts,
      lines: (markdown || '').split(/\r?\n/).length,
      headers: headerMatches.length,
      links: linkMatches.length,
      images: imageMatches.length,
      tableRows: tableRowMatches.length,
      readingTimeMinutes: Math.ceil(tokenStats.words / 200),
      savings
    }
  };
}

/**
 * Main conversion function with token optimization and knowledge base generation
 * @param {Buffer} buffer 
 * @param {string} filename 
 * @param {string} mimetype 
 * @param {object} [options]
 * @param {'raw'|'clean'|'ultra_compact'} [options.level='clean']
 * @param {boolean} [options.injectFrontmatter=false]
 * @param {boolean} [options.includeRag=true]
 * @param {number} [options.chunkMaxTokens=600]
 * @param {'table'|'records'|'compact'} [options.tableFormat='compact']
 * @returns {Promise<object>}
 */
async function convertFileToMarkdown(buffer, filename, mimetype, options = {}) {
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  let rawMarkdown = '';
  let warnings = [];

  const {
    level = 'clean',
    injectFrontmatter = false,
    includeRag = true,
    chunkMaxTokens = 600,
    tableFormat = 'compact'
  } = options;

  try {
    if (ext === 'docx' || ext === 'doc' || mimetype.includes('wordprocessingml') || mimetype.includes('msword')) {
      const result = await convertDocxToMarkdown(buffer);
      rawMarkdown = result.markdown;
      warnings = result.warnings || [];
    } else if (ext === 'pdf' || mimetype.includes('pdf')) {
      const result = await convertPdfToMarkdown(buffer);
      rawMarkdown = result.markdown;
    } else if (['xlsx', 'xls', 'csv'].includes(ext) || mimetype.includes('spreadsheet') || mimetype.includes('csv')) {
      rawMarkdown = convertSpreadsheetToMarkdown(buffer, filename, { format: tableFormat });
    } else if (['html', 'htm'].includes(ext) || mimetype.includes('html')) {
      rawMarkdown = convertHtmlToMarkdown(buffer.toString('utf-8'));
    } else if (['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff'].includes(ext) || mimetype.startsWith('image/')) {
      const ocrResult = await convertImageToMarkdown(buffer);
      rawMarkdown = ocrResult.markdown;
    } else {
      // Default to text / code / JSON / markdown handling
      rawMarkdown = convertTextToMarkdown(buffer.toString('utf-8'), filename);
    }
  } catch (err) {
    console.error(`Error converting ${filename}:`, err);
    throw new Error(`Failed to convert ${filename}: ${err.message}`);
  }

  // Process document through Knowledge Base & Token Optimization pipeline
  const processed = processDocumentForKb(rawMarkdown, filename, {
    level,
    injectFrontmatter,
    includeRagChunks: includeRag,
    chunkMaxTokens
  });

  const analysis = analyzeMarkdown(processed.markdown, rawMarkdown);

  return {
    originalFilename: filename,
    outputFilename: processed.filename,
    markdown: processed.markdown,
    rawMarkdown,
    renderedHtml: analysis.renderedHtml,
    stats: analysis.stats,
    meta: processed.meta,
    rag: processed.rag,
    savings: processed.savings,
    warnings
  };
}

module.exports = {
  convertFileToMarkdown,
  analyzeMarkdown,
  md
};
