const mammoth = require('mammoth');
const TurndownService = require('turndown');
const { gfm } = require('turndown-plugin-gfm');

function getTurndownService() {
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    emDelimiter: '_',
    strongDelimiter: '**',
    bulletListMarker: '-'
  });

  // Enable GFM plugin (tables, task lists, strikethrough)
  turndownService.use(gfm);

  // Keep figure and figcaption if present
  turndownService.addRule('figure', {
    filter: 'figure',
    replacement: function (content, node) {
      return '\n\n' + content.trim() + '\n\n';
    }
  });

  return turndownService;
}

/**
 * Converts a DOCX buffer to Markdown string
 * @param {Buffer} buffer 
 * @returns {Promise<{markdown: string, warnings: Array}>}
 */
async function convertDocxToMarkdown(buffer) {
  const result = await mammoth.convertToHtml({ buffer });
  const html = result.value;
  const warnings = result.messages || [];

  const turndownService = getTurndownService();
  const markdown = turndownService.turndown(html);

  return {
    markdown: markdown.trim(),
    warnings: warnings.map(w => w.message)
  };
}

module.exports = {
  convertDocxToMarkdown
};
