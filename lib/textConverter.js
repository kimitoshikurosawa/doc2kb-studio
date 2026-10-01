// Source code extensions → fenced code block language tag
const CODE_LANGUAGES = {
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'jsx', ts: 'ts', tsx: 'tsx',
  py: 'python', java: 'java', kt: 'kotlin', go: 'go', rs: 'rust', rb: 'ruby',
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cs: 'csharp', swift: 'swift', php: 'php',
  html: 'html', css: 'css', scss: 'scss', xml: 'xml', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell', sql: 'sql', graphql: 'graphql',
  dockerfile: 'dockerfile', tf: 'hcl', ini: 'ini'
};

/**
 * Wraps content in a fenced code block, using a fence longer than any backtick run it contains
 * @param {string} content
 * @param {string} lang
 * @returns {string}
 */
function fence(content, lang) {
  const longestRun = Math.max(2, ...(content.match(/`+/g) || []).map(r => r.length));
  const ticks = '`'.repeat(longestRun + 1);
  return `${ticks}${lang}\n${content.replace(/\s+$/, '')}\n${ticks}`;
}

/**
 * Converts raw text / JSON / code into Markdown format
 * @param {string} content
 * @param {string} filename
 * @returns {string}
 */
function convertTextToMarkdown(content, filename = '') {
  const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : filename.toLowerCase();

  if (ext === 'json') {
    try {
      return fence(JSON.stringify(JSON.parse(content), null, 2), 'json');
    } catch {
      return fence(content, 'json');
    }
  }

  if (CODE_LANGUAGES[ext]) {
    return fence(content, CODE_LANGUAGES[ext]);
  }

  // Handle RTF simple cleanup if basic text containing rtf tags
  if (ext === 'rtf' || content.startsWith('{\\rtf')) {
    return content
      .replace(/\\par[d]?/g, '\n')
      .replace(/\\'[0-9a-f]{2}/gi, (hex) => String.fromCharCode(parseInt(hex.slice(2), 16)))
      .replace(/\\[a-z0-9-]+\s?/gi, '')
      .replace(/[{}]/g, '')
      .trim();
  }

  // Plain text / log / markdown
  return content.trim();
}

module.exports = {
  convertTextToMarkdown
};
