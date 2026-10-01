const mammoth = require('mammoth');
const { createTurndownService } = require('./htmlConverter');

// By default mammoth inlines every embedded image as a base64 data URI, which explodes the
// token count of the output. Replace images with an empty src and keep their alt text only.
const convertImage = mammoth.images.imgElement(async (image) => ({
  src: '',
  alt: image.altText || ''
}));

/**
 * Converts a DOCX buffer to Markdown string
 * @param {Buffer} buffer
 * @returns {Promise<{markdown: string, warnings: Array<string>}>}
 */
async function convertDocxToMarkdown(buffer) {
  const result = await mammoth.convertToHtml({ buffer }, { convertImage });
  const warnings = result.messages || [];

  const turndownService = createTurndownService();
  turndownService.addRule('strippedImage', {
    filter: (node) => node.nodeName === 'IMG' && !node.getAttribute('src'),
    replacement: (content, node) => {
      const alt = (node.getAttribute('alt') || '').trim();
      return alt ? `[Image: ${alt}]` : '';
    }
  });

  const markdown = turndownService.turndown(result.value);

  return {
    markdown: markdown.trim(),
    warnings: warnings.map(w => w.message)
  };
}

module.exports = {
  convertDocxToMarkdown
};
