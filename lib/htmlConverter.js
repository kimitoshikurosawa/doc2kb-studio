const TurndownService = require('turndown');
const { gfm } = require('turndown-plugin-gfm');

// Elements whose content is never useful to an LLM (code, styling, embeds) and only burns tokens
const NON_CONTENT_ELEMENTS = ['script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed', 'canvas', 'svg', 'head'];

/**
 * Shared Turndown factory (HTML + DOCX pipelines)
 * @returns {TurndownService}
 */
function createTurndownService() {
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    emDelimiter: '_',
    strongDelimiter: '**',
    bulletListMarker: '-'
  });

  // Enable GFM plugin (tables, task lists, strikethrough)
  turndownService.use(gfm);
  turndownService.remove(NON_CONTENT_ELEMENTS);

  // Keep figure and figcaption if present
  turndownService.addRule('figure', {
    filter: 'figure',
    replacement: (content) => '\n\n' + content.trim() + '\n\n'
  });

  // Turndown pads list markers to 4 columns ("-   item", "1.  item"): a single space is
  // equally valid CommonMark and saves a token per list item
  turndownService.addRule('compactListItem', {
    filter: 'li',
    replacement: (content, node, options) => {
      let prefix = `${options.bulletListMarker} `;
      const parent = node.parentNode;
      if (parent.nodeName === 'OL') {
        const start = parent.getAttribute('start');
        const index = Array.prototype.indexOf.call(parent.children, node);
        prefix = `${start ? Number(start) + index : index + 1}. `;
      }
      const isParagraph = /\n$/.test(content);
      const body = content.replace(/^\n+|\n+$/g, '') + (isParagraph ? '\n' : '');
      return prefix + body.replace(/\n/gm, '\n' + ' '.repeat(prefix.length)) + (node.nextSibling ? '\n' : '');
    }
  });

  // Inline base64 images can weigh hundreds of thousands of tokens: keep only the alt text
  turndownService.addRule('dataUriImage', {
    filter: (node) => node.nodeName === 'IMG' && /^data:/i.test(node.getAttribute('src') || ''),
    replacement: (content, node) => {
      const alt = (node.getAttribute('alt') || '').trim();
      return alt ? `[Image: ${alt}]` : '';
    }
  });

  return turndownService;
}

function convertHtmlToMarkdown(htmlString) {
  return createTurndownService().turndown(htmlString || '');
}

module.exports = {
  convertHtmlToMarkdown,
  createTurndownService
};
