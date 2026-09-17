/**
 * Converts raw text / JSON / code into Markdown format
 * @param {string} content 
 * @param {string} filename 
 * @returns {string}
 */
function convertTextToMarkdown(content, filename = '') {
  const ext = filename.split('.').pop().toLowerCase();

  if (ext === 'json') {
    try {
      const parsed = JSON.parse(content);
      return '```json\n' + JSON.stringify(parsed, null, 2) + '\n```';
    } catch (e) {
      return '```json\n' + content + '\n```';
    }
  }

  if (['js', 'ts', 'py', 'java', 'c', 'cpp', 'html', 'css', 'xml', 'yaml', 'yml', 'sh', 'sql', 'php'].includes(ext)) {
    return '```' + ext + '\n' + content + '\n```';
  }

  // Handle RTF simple cleanup if basic text containing rtf tags
  if (ext === 'rtf' || content.startsWith('{\\rtf')) {
    const cleanText = content
      .replace(/\\par[d]?/g, '\n')
      .replace(/\\[a-z0-9]+\s?/gi, '')
      .replace(/[\{\}]/g, '')
      .trim();
    return cleanText;
  }

  // Plain text / log / markdown
  return content.trim();
}

module.exports = {
  convertTextToMarkdown
};
