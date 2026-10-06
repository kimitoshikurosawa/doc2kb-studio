const { countTokens, calculateSavings } = require('./tokenizer');

const CODE_PLACEHOLDER_RE = /\u0000CODE(\d+)\u0000/g;

/**
 * Swaps fenced code blocks for opaque placeholders so that prose-oriented regex rules
 * (boilerplate stripping, table compaction, list minification...) never alter code.
 * @param {string} text
 * @returns {{ text: string, blocks: string[], restore: (t: string) => string }}
 */
function protectCodeBlocks(text) {
  const blocks = [];
  const out = [];
  let buffer = null;
  let opener = '';

  const flush = () => {
    out.push(`\u0000CODE${blocks.length}\u0000`);
    blocks.push(buffer.join('\n'));
    buffer = null;
  };

  for (const line of text.split('\n')) {
    if (buffer === null) {
      const open = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (open) {
        buffer = [line];
        opener = open[1];
      } else {
        out.push(line);
      }
      continue;
    }

    buffer.push(line);
    const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
    if (close && close[1][0] === opener[0] && close[1].length >= opener.length) flush();
  }
  if (buffer !== null) flush(); // unclosed fence runs to end of document (CommonMark)

  return {
    text: out.join('\n'),
    blocks,
    restore: (t) => t.replace(CODE_PLACEHOLDER_RE, (_, i) => blocks[Number(i)])
  };
}

/**
 * Returns the markdown with fenced code blocks removed (for structure/metadata analysis)
 * @param {string} markdown
 * @returns {string}
 */
function stripCodeBlocks(markdown) {
  return protectCodeBlocks(markdown || '').text.replace(CODE_PLACEHOLDER_RE, '');
}

function yamlString(value) {
  // JSON strings are valid YAML double-quoted scalars (escapes quotes, backslashes, control chars)
  return JSON.stringify(String(value));
}

/**
 * Strips recurring document boilerplate, page numbers, legal disclaimers and empty tags
 * @param {string} text 
 * @returns {string}
 */
function stripBoilerplate(text) {
  if (!text) return '';

  let cleaned = text;

  // Remove HTML comments
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');

  // Remove empty HTML tags like <div></div>, <p></p>, <span></span>
  cleaned = cleaned.replace(/<(div|span|p|section|article)[^>]*>\s*<\/\1>/gi, '');

  // Remove PDF page indicators like "Page 1 of 10", "Page 1 / 10", "1/10", "Page 1"
  cleaned = cleaned.replace(/^\s*(Page\s+\d+(\s*(of|\/)\s*\d+)?|\d+\s*\/\s*\d+)\s*$/gim, '');

  // Remove redundant repetitive horizontal rules (keep at most one if really necessary)
  cleaned = cleaned.replace(/^[ \t]*([-*_]){3,}[ \t]*$/gm, '---');
  cleaned = cleaned.replace(/(---(\r?\n))+---/g, '---');

  // Strip non-semantic decorative symbols often found in converted documents
  cleaned = cleaned.replace(/^[ \t]*[•·▪▫►]\s*/gm, '- ');

  // Remove empty bullet points
  cleaned = cleaned.replace(/^\s*[-*+]\s*$/gm, '');

  // Clean trailing spaces on every line
  cleaned = cleaned.replace(/[ \t]+$/gm, '');

  return cleaned;
}

/**
 * Minifies Markdown tables by stripping excessive whitespace padding inside cells
 * e.g. "|  Column One   |  Column Two   |" -> "|Column One|Column Two|"
 * This saves huge amounts of tokens while remaining 100% compliant with GFM Markdown!
 * @param {string} markdown 
 * @returns {string}
 */
function compactMarkdownTables(markdown) {
  if (!markdown || !markdown.includes('|')) return markdown;

  const lines = markdown.split(/\r?\n/);
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if line looks like a markdown table row (starts and ends with | or contains multiple |)
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const isSeparator = /^\s*\|(\s*:?-+:?\s*\|)+\s*$/.test(line);

      if (isSeparator) {
        // Compact separator: | --- | --- | -> |---|---|
        const cols = line.trim().split('|').slice(1, -1);
        const compactedCols = cols.map(c => {
          const trimmed = c.trim();
          if (trimmed.startsWith(':') && trimmed.endsWith(':')) return ':---:';
          if (trimmed.endsWith(':')) return '---:';
          if (trimmed.startsWith(':')) return ':---';
          return '---';
        });
        result.push(`|${compactedCols.join('|')}|`);
      } else {
        // Compact data or header row
        const cols = line.trim().split('|').slice(1, -1);
        const compactedCols = cols.map(c => c.trim());
        result.push(`|${compactedCols.join('|')}|`);
      }
    } else {
      result.push(line);
    }
  }

  return result.join('\n');
}

/**
 * Extracts high-level metadata (Title, H2 sections, summary preview, keywords)
 * @param {string} markdown 
 * @param {string} filename 
 * @returns {object}
 */
function extractDocumentMetadata(markdown, filename = '') {
  if (!markdown) {
    return {
      title: filename || 'Untitled',
      description: '',
      headings: [],
      keywords: [],
      estimatedTokens: 0
    };
  }

  const prose = stripCodeBlocks(markdown);

  // Detect main title: first H1 (# Title) or first non-empty line
  let title = '';
  const h1Match = prose.match(/^#\s+(.+)$/m);
  if (h1Match) {
    title = h1Match[1].trim();
  } else {
    // Look for first bold text or first line
    const firstLine = prose.split(/\r?\n/).find(l => l.trim().length > 0) || '';
    title = firstLine.replace(/^[#*_\s]+|[#*_\s]+$/g, '').trim() || (filename ? filename.replace(/\.[^/.]+$/, '') : 'Document');
  }

  // Extract all headings for hierarchy map
  const headingMatches = [...prose.matchAll(/^(#{1,6})\s+(.+)$/gm)];
  const headings = headingMatches.map(m => ({
    level: m[1].length,
    text: m[2].trim()
  }));

  // Extract a brief 1-2 sentence summary / first informative paragraph
  const paragraphs = prose.split(/\r?\n\r?\n/)
    .map(p => p.trim())
    .filter(p => p && !p.startsWith('#') && !p.startsWith('|') && !p.startsWith('```') && !p.startsWith('---'));
  
  const description = paragraphs.length > 0 
    ? paragraphs[0].replace(/\r?\n/g, ' ').slice(0, 220) + (paragraphs[0].length > 220 ? '...' : '')
    : '';

  // Extract simple topic keywords from headings and frequent words
  const words = (title + ' ' + headings.map(h => h.text).join(' '))
    .toLowerCase()
    .replace(/[^\wÀ-ÿ\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 4 && !['cette', 'votre', 'notre', 'leurs', 'alors', 'apres', 'comme', 'faire', 'depuis', 'entre', 'quelle', 'quand'].includes(w));
  
  const frequency = {};
  words.forEach(w => { frequency[w] = (frequency[w] || 0) + 1; });
  const keywords = Object.keys(frequency)
    .sort((a, b) => frequency[b] - frequency[a])
    .slice(0, 6);

  const tokens = countTokens(markdown);

  return {
    title,
    description,
    headings,
    keywords,
    estimatedTokens: tokens
  };
}

// Leading YAML frontmatter ("---\n...\n---"), as produced by generateFrontmatter or authored by hand
const FRONTMATTER_RE = /^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Separates a leading YAML frontmatter block from the document body
 * @param {string} markdown
 * @returns {{ frontmatter: string, body: string }}
 */
function splitFrontmatter(markdown) {
  const match = (markdown || '').match(FRONTMATTER_RE);
  if (!match) return { frontmatter: '', body: markdown || '' };
  return { frontmatter: match[0].trimEnd(), body: markdown.slice(match[0].length).replace(/^\s*\n/, '') };
}

/**
 * Builds YAML frontmatter block for LLM knowledge base ingestion
 * @param {object} meta 
 * @returns {string}
 */
function generateFrontmatter(meta) {
  const lines = ['---'];
  if (meta.title) lines.push(`title: ${yamlString(meta.title)}`);
  if (meta.description) lines.push(`description: ${yamlString(meta.description)}`);
  if (meta.keywords && meta.keywords.length > 0) lines.push(`keywords: [${meta.keywords.map(yamlString).join(', ')}]`);
  if (meta.estimatedTokens) lines.push(`tokens: ${meta.estimatedTokens}`);
  if (meta.headings && meta.headings.length > 0) {
    const topSections = meta.headings.filter(h => h.level <= 2).map(h => yamlString(h.text));
    if (topSections.length > 0) {
      lines.push(`sections: [${topSections.slice(0, 8).join(', ')}]`);
    }
  }
  lines.push('---');
  return lines.join('\n') + '\n\n';
}

/**
 * Primary token optimization engine
 * @param {string} rawMarkdown 
 * @param {object} options
 * @param {'raw'|'clean'|'ultra_compact'} [options.level='clean']
 * @param {boolean} [options.stripImages=false]
 * @param {boolean} [options.compactTables=true]
 * @param {boolean} [options.injectFrontmatter=false]
 * @param {string} [options.filename='']
 * @returns {{ optimizedMarkdown: string, originalMarkdown: string, body: string, savings: object, meta: object }}
 */
function optimizeMarkdown(rawMarkdown, options = {}) {
  const {
    level = 'clean',
    stripImages = false,
    compactTables = true,
    injectFrontmatter = false,
    filename = ''
  } = options;

  if (!rawMarkdown || typeof rawMarkdown !== 'string') {
    return {
      optimizedMarkdown: '',
      originalMarkdown: '',
      body: '',
      savings: calculateSavings('', ''),
      meta: extractDocumentMetadata('', filename)
    };
  }

  const originalMarkdown = rawMarkdown;
  // An existing frontmatter (re-optimizing an already processed document, KB export) is detached:
  // it is regenerated from the body when requested, instead of being stacked or chunked as content.
  const { frontmatter: existingFrontmatter, body: sourceBody } = splitFrontmatter(rawMarkdown);

  const text = level === 'raw'
    ? sourceBody
    : optimizeBody(sourceBody, { level, stripImages, compactTables });

  // Savings compare bodies only: a detached frontmatter is not a reduction achieved by optimization
  const savings = calculateSavings(sourceBody, text);
  const meta = extractDocumentMetadata(text, filename);

  let finalText = text;
  if (level === 'raw' && !injectFrontmatter) {
    finalText = originalMarkdown; // 'raw' means byte-for-byte untouched
  } else if (injectFrontmatter) {
    finalText = generateFrontmatter(meta) + text;
  } else if (existingFrontmatter) {
    finalText = `${existingFrontmatter}\n\n${text}`;
  }

  return {
    optimizedMarkdown: finalText,
    originalMarkdown,
    body: text,
    savings,
    meta
  };
}

/**
 * Applies the level-specific token reductions to a document body (no frontmatter)
 * @param {string} body
 * @param {{ level: string, stripImages: boolean, compactTables: boolean }} options
 * @returns {string}
 */
function optimizeBody(body, { level, stripImages, compactTables }) {
  const code = protectCodeBlocks(body);
  let text = stripBoilerplate(code.text);

  // Inline base64 images (data URIs) carry no meaning for an LLM and can cost 100k+ tokens
  text = text.replace(/!\[([^\]]*)\]\(\s*data:[^)]*\)/gi, (match, alt) => {
    const trimmedAlt = (alt || '').trim();
    return trimmedAlt ? `[Image: ${trimmedAlt}]` : '';
  });

  // Clean or simplify images if requested or if ultra_compact
  if (stripImages || level === 'ultra_compact') {
    // Replace ![alt text](url) with simple text marker or remove decorative images
    text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, (match, alt) => {
      const trimmedAlt = (alt || '').trim();
      return trimmedAlt ? `[Image: ${trimmedAlt}]` : '';
    });
  }

  // Compact markdown tables to save tokens
  if (compactTables || level === 'ultra_compact') {
    text = compactMarkdownTables(text);
  }

  // Level: 'clean' (Balanced)
  if (level === 'clean') {
    // Normalize multiple consecutive blank lines to standard 2 newlines
    text = text.replace(/\n{3,}/g, '\n\n');

    // Remove trailing spaces on lines
    text = text.replace(/[ \t]+$/gm, '');

    // Trim start and end
    text = text.trim();
  }

  // Level: 'ultra_compact' (Maximum Token Reduction for LLMs)
  if (level === 'ultra_compact') {
    // Remove decorative horizontal rules completely
    text = text.replace(/^[ \t]*---[ \t]*$/gm, '');

    // Minify list spacing: single newline between list items
    text = text.replace(/(\n-\s+[^\n]+)\n{2,}(-\s+)/g, '$1\n$2');

    // Minify blank lines: ensure max 1 blank line between sections
    text = text.replace(/\n{3,}/g, '\n\n');

    // Clean tracking URLs
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (match, linkText, url) => {
      if (linkText.toLowerCase() === url.toLowerCase()) return `<${url}>`;
      try {
        const parsedUrl = new URL(url);
        if (parsedUrl.searchParams.has('utm_source') || parsedUrl.searchParams.has('ref')) {
          ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref'].forEach(p => parsedUrl.searchParams.delete(p));
          return `[${linkText}](${parsedUrl.toString()})`;
        }
      } catch (e) {
        // Keep as is if invalid URL
      }
      return match;
    });

    text = text.trim();
  }

  return code.restore(text);
}

module.exports = {
  optimizeMarkdown,
  compactMarkdownTables,
  stripBoilerplate,
  extractDocumentMetadata,
  generateFrontmatter,
  splitFrontmatter,
  protectCodeBlocks,
  stripCodeBlocks
};
