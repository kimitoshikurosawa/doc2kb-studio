const TurndownService = require('turndown');
const { gfm } = require('turndown-plugin-gfm');

function convertHtmlToMarkdown(htmlString) {
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    emDelimiter: '_',
    strongDelimiter: '**',
    bulletListMarker: '-'
  });

  turndownService.use(gfm);

  return turndownService.turndown(htmlString || '');
}

module.exports = {
  convertHtmlToMarkdown
};
