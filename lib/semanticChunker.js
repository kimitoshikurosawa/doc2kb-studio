const { createHash } = require('node:crypto');
const { countTokens, encode, decode } = require('./tokenizer');
const { protectCodeBlocks } = require('./tokenOptimizer');

const MIN_CHUNK_TOKENS = 32;
const SEPARATOR = '\n\n';
const SEPARATOR_TOKENS = 1;

/**
 * Stable document id derived from content: re-ingesting the same document yields the same
 * chunk ids, which makes vector-store upserts idempotent.
 * @param {string} markdown
 * @returns {string}
 */
function contentDocId(markdown) {
  return 'doc_' + createHash('sha256').update(markdown).digest('hex').slice(0, 12);
}

/**
 * Hard split on token boundaries (last resort for a single unbreakable unit)
 * @param {string} text
 * @param {number} maxTokens
 * @returns {string[]}
 */
function splitByTokenWindow(text, maxTokens) {
  const tokens = encode(text);
  if (!tokens) {
    // No encoder available: approximate with characters (~3.8 chars per token)
    const size = Math.max(1, Math.floor(maxTokens * 3.8));
    const parts = [];
    for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
    return parts;
  }
  const parts = [];
  for (let i = 0; i < tokens.length; i += maxTokens) {
    parts.push(decode(tokens.slice(i, i + maxTokens)));
  }
  return parts;
}

/**
 * Breaks a unit that exceeds maxTokens into smaller units, preferring natural boundaries:
 * lines (code / lists / tables) → sentences → raw token windows.
 * @param {string} unit
 * @param {number} maxTokens
 * @returns {string[]}
 */
function splitOversizedUnit(unit, maxTokens) {
  const isCode = /^ {0,3}(`{3,}|~{3,})/.test(unit);
  const lines = unit.split('\n');
  const candidates = lines.length > 1
    ? lines
    : unit.split(/(?<=[.!?…])\s+(?=[\p{Lu}\p{N}"«(])/u);

  if (candidates.length <= 1) return splitByTokenWindow(unit, maxTokens);

  const out = [];
  let current = [];
  let currentTokens = 0;
  const joiner = lines.length > 1 ? '\n' : ' ';

  for (const piece of candidates) {
    const pieceTokens = countTokens(piece);
    if (pieceTokens > maxTokens) {
      if (current.length) out.push(current.join(joiner));
      out.push(...splitOversizedUnit(piece, maxTokens));
      current = [];
      currentTokens = 0;
      continue;
    }
    if (currentTokens + pieceTokens + 1 > maxTokens && current.length) {
      out.push(current.join(joiner));
      current = [];
      currentTokens = 0;
    }
    current.push(piece);
    currentTokens += pieceTokens + 1;
  }
  if (current.length) out.push(current.join(joiner));

  // Keep split code fragments syntactically fenced so they still render/parse as code
  if (isCode && out.length > 1) {
    const fenceLine = lines[0];
    const fence = fenceLine.trim().match(/^(`{3,}|~{3,})/)[1];
    return out.map((part, i) => {
      let p = part;
      if (i > 0) p = `${fenceLine}\n${p}`;
      if (i < out.length - 1) p = `${p}\n${fence}`;
      return p;
    });
  }
  return out;
}

/**
 * Splits markdown into semantic sections along heading boundaries (H1-H4), ignoring
 * "headings" that live inside fenced code blocks.
 * @param {string} markdown
 * @param {string} docTitle
 * @returns {Array<{ title: string, breadcrumbs: string[], content: string }>}
 */
function splitIntoSections(markdown, docTitle) {
  const protectedDoc = protectCodeBlocks(markdown);
  const sections = [];
  let headingStack = [];
  let current = { title: docTitle, breadcrumbs: [docTitle], lines: [], hasBody: false };

  const pushCurrent = () => {
    // A section made only of its heading line carries no retrievable content: its title
    // still lives on in the breadcrumbs of the following sections.
    if (current.hasBody) {
      sections.push({
        title: current.title,
        breadcrumbs: current.breadcrumbs,
        content: protectedDoc.restore(current.lines.join('\n')).trim()
      });
    }
  };

  for (const line of protectedDoc.text.split(/\r?\n/)) {
    const headingMatch = line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      pushCurrent();
      const level = headingMatch[1].length;
      const headingText = headingMatch[2].trim();

      headingStack = headingStack.slice(0, level - 1);
      headingStack[level - 1] = headingText;

      current = {
        title: headingText,
        breadcrumbs: [docTitle, ...headingStack.filter(Boolean)],
        lines: [line],
        hasBody: false
      };
    } else {
      current.lines.push(line);
      if (line.trim()) current.hasBody = true;
    }
  }
  pushCurrent();

  return sections;
}

/**
 * Packs a section's units (paragraphs / code blocks) into chunks <= maxTokens,
 * with an optional token overlap between consecutive chunks of the same section.
 * @returns {string[]}
 */
function packSection(content, maxTokens, overlapTokens) {
  const protectedSec = protectCodeBlocks(content);
  const units = protectedSec.text
    .split(/\n\s*\n/)
    .map(u => protectedSec.restore(u).trim())
    .filter(Boolean)
    .flatMap(u => (countTokens(u) > maxTokens ? splitOversizedUnit(u, maxTokens) : [u]))
    .map(u => ({ text: u, tokens: countTokens(u) }));

  const chunks = [];
  let current = [];
  let currentTokens = 0;

  for (const unit of units) {
    const added = unit.tokens + (current.length ? SEPARATOR_TOKENS : 0);
    if (currentTokens + added > maxTokens && current.length) {
      chunks.push(current.map(u => u.text).join(SEPARATOR));

      // Carry trailing units over as overlap context (never the whole previous chunk)
      const overlap = [];
      let overlapSize = 0;
      for (let i = current.length - 1; i > 0 && overlapTokens > 0; i--) {
        const size = current[i].tokens + SEPARATOR_TOKENS;
        if (overlapSize + size > overlapTokens || overlapSize + size + unit.tokens > maxTokens) break;
        overlap.unshift(current[i]);
        overlapSize += size;
      }
      current = overlap;
      currentTokens = overlapSize;
    }
    current.push(unit);
    currentTokens += unit.tokens + (current.length > 1 ? SEPARATOR_TOKENS : 0);
  }
  if (current.length) chunks.push(current.map(u => u.text).join(SEPARATOR));

  return chunks;
}

/**
 * Serializes a chunk into the JSONL record format used for vector store ingestion
 * @param {object} c
 * @returns {string}
 */
function toJsonlRecord(c) {
  return JSON.stringify({
    id: c.id,
    doc_id: c.docId ?? c.doc_id,
    doc_title: c.docTitle ?? c.doc_title,
    chunk_index: c.chunkIndex ?? c.chunk_index,
    title: c.title,
    breadcrumbs: c.breadcrumbsStr ?? c.breadcrumbs,
    token_count: c.tokenCount ?? c.token_count,
    text: c.content ?? c.text
  });
}

/**
 * Splits markdown documents into semantic chunks along heading boundaries (H1-H4),
 * preserving section breadcrumbs and keeping tokens within optimal RAG bounds.
 *
 * @param {string} markdown
 * @param {object} options
 * @param {number} [options.maxTokens=600] Maximum tokens per chunk
 * @param {number} [options.overlapTokens=0] Tokens of trailing context repeated at the start of the next chunk of the same section
 * @param {number} [options.minTokens=10] Minimum tokens before considering merging with adjacent section
 * @param {string} [options.docId] Document identifier (defaults to a content hash)
 * @param {string} [options.docTitle='Document'] Document title
 * @param {boolean} [options.splitOnHeadings=true] Ensure distinct headings form separate chunks
 * @returns {{ chunks: Array<object>, totalChunks: number, totalTokens: number, jsonl: string }}
 */
function chunkMarkdownForRag(markdown, options = {}) {
  if (!markdown || typeof markdown !== 'string' || !markdown.trim()) {
    return { chunks: [], totalChunks: 0, totalTokens: 0, jsonl: '' };
  }

  const {
    minTokens = 10,
    docTitle = 'Document',
    splitOnHeadings = true
  } = options;
  const maxTokens = Math.max(MIN_CHUNK_TOKENS, Number(options.maxTokens) || 600);
  const overlapTokens = Math.min(Math.max(0, Number(options.overlapTokens) || 0), Math.floor(maxTokens / 2));
  const docId = options.docId || contentDocId(markdown);

  const sections = splitIntoSections(markdown, docTitle);
  const chunks = [];

  const pushChunk = (sec, content, title) => {
    const index = chunks.length + 1;
    chunks.push({
      id: `${docId}_chunk_${index}`,
      docId,
      docTitle,
      chunkIndex: index,
      title,
      breadcrumbs: sec.breadcrumbs,
      breadcrumbsStr: sec.breadcrumbs.join(' > '),
      content,
      tokenCount: countTokens(content),
      charCount: content.length
    });
  };

  for (const sec of sections) {
    const secTokens = countTokens(sec.content);

    if (secTokens <= maxTokens) {
      // Only merge if section is extremely tiny (< minTokens) and splitOnHeadings is false
      if (!splitOnHeadings && secTokens < minTokens && chunks.length > 0) {
        const prev = chunks[chunks.length - 1];
        const merged = prev.content + SEPARATOR + sec.content;
        const mergedTokens = countTokens(merged);
        if (mergedTokens <= maxTokens) {
          prev.content = merged;
          prev.tokenCount = mergedTokens;
          prev.charCount = merged.length;
          continue;
        }
      }
      pushChunk(sec, sec.content, sec.title);
      continue;
    }

    const parts = packSection(sec.content, maxTokens, overlapTokens);
    parts.forEach((part, i) => {
      pushChunk(sec, part, parts.length > 1 ? `${sec.title} (Partie ${i + 1})` : sec.title);
    });
  }

  return {
    chunks,
    totalChunks: chunks.length,
    totalTokens: chunks.reduce((acc, c) => acc + c.tokenCount, 0),
    jsonl: chunks.map(toJsonlRecord).join('\n')
  };
}

module.exports = {
  chunkMarkdownForRag,
  toJsonlRecord,
  contentDocId
};
