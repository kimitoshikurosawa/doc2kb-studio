const { createHash } = require('node:crypto');
const { countTokens, encode, decode } = require('./tokenizer');
const { protectCodeBlocks } = require('./tokenOptimizer');

const MIN_CHUNK_TOKENS = 32;
const SEPARATOR = '\n\n';
const SEPARATOR_TOKENS = 1;
// Benchmarks (FloTorch 2026, NVIDIA FinanceBench, Vectara NAACL 2025) converge on:
// - fragments below ~150-200 tokens hurt end-to-end answer accuracy → merge tiny sections;
// - 10-20 % overlap between consecutive chunks is the sweet spot (NVIDIA: 15 %).
const DEFAULT_MIN_TOKENS = 150;
const DEFAULT_OVERLAP_RATIO = 0.15;
// GFM table: header row followed by a delimiter row ("|---|:---:|")
const TABLE_DELIMITER_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

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
 * Splits an oversized GFM table by rows, repeating the header + delimiter rows in every part:
 * without them, rows of the 2nd+ chunk are just anonymous cells for the retriever and the LLM.
 * @param {string} unit
 * @param {number} maxTokens
 * @returns {string[]|null} null when the unit is not a table (or its header alone is too big)
 */
function splitOversizedTable(unit, maxTokens) {
  const lines = unit.split('\n');
  if (lines.length < 3 || !lines[0].trim().startsWith('|') || !TABLE_DELIMITER_RE.test(lines[1])) return null;

  const header = `${lines[0]}\n${lines[1]}`;
  const budget = maxTokens - countTokens(header) - 1;
  if (budget < MIN_CHUNK_TOKENS) return null;

  const parts = [];
  let rows = [];
  let rowsTokens = 0;
  for (const row of lines.slice(2)) {
    const rowTokens = countTokens(row) + 1;
    if (rowsTokens + rowTokens > budget && rows.length) {
      parts.push(`${header}\n${rows.join('\n')}`);
      rows = [];
      rowsTokens = 0;
    }
    rows.push(row);
    rowsTokens += rowTokens;
  }
  if (rows.length) parts.push(`${header}\n${rows.join('\n')}`);
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
  const table = splitOversizedTable(unit, maxTokens);
  if (table) return table;

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

      // "Guide > Guide > Install" when the H1 repeats the document title: drop the duplicate
      const path = headingStack.filter(Boolean);
      if (path[0] === docTitle) path.shift();

      current = {
        title: headingText,
        breadcrumbs: [docTitle, ...path],
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
 * Last sentences of a prose unit fitting in `budget` tokens (never code or table fragments)
 * @param {string} text
 * @param {number} budget
 * @returns {string} '' when nothing fits
 */
function trailingSentences(text, budget) {
  if (budget <= 0 || /^ {0,3}(`{3,}|~{3,})/.test(text) || text.trim().startsWith('|')) return '';
  const sentences = text.split(/(?<=[.!?…])\s+/u);
  if (sentences.length < 2) return '';
  const picked = [];
  let size = 0;
  for (let i = sentences.length - 1; i > 0; i--) {
    const t = countTokens(sentences[i]) + 1;
    if (size + t > budget) break;
    picked.unshift(sentences[i]);
    size += t;
  }
  return picked.join(' ');
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
      // Paragraphs are usually bigger than the overlap budget (15 % of 600 = 90 tokens): fall back
      // to the trailing sentences of the last unit so the default overlap is not a no-op
      if (overlap.length === 0 && overlapTokens > 0) {
        const budget = Math.min(overlapTokens, maxTokens - unit.tokens - SEPARATOR_TOKENS);
        const tail = trailingSentences(current[current.length - 1].text, budget);
        if (tail) {
          const tailTokens = countTokens(tail);
          overlap.push({ text: tail, tokens: tailTokens });
          overlapSize = tailTokens + SEPARATOR_TOKENS;
        }
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
    text: c.content ?? c.text,
    // What to embed and BM25-index; `text` is what to show / inject into the prompt
    embedding_text: c.embeddingText ?? c.embedding_text
      ?? buildEmbeddingText([].concat(c.breadcrumbs ?? []), c.content ?? c.text ?? '')
  });
}

/**
 * Text to embed / index in BM25 for a chunk: its heading path followed by its content.
 * A cheap, local take on Anthropic's "Contextual Retrieval": a chunk saying "Set it to 3000"
 * is unfindable on its own, "Manual > Configuration > Port" in front of it is not.
 * @param {string[]} breadcrumbs
 * @param {string} content
 * @returns {string}
 */
function buildEmbeddingText(breadcrumbs, content) {
  return `${breadcrumbs.join(' > ')}\n\n${content}`;
}

/**
 * Longest common prefix of two breadcrumb paths (the shared parent of merged sections)
 */
function commonBreadcrumbs(a, b) {
  const out = [];
  for (let i = 0; i < Math.min(a.length, b.length) && a[i] === b[i]; i++) out.push(a[i]);
  return out.length ? out : a.slice(0, 1);
}

/**
 * Splits markdown documents into semantic chunks along heading boundaries (H1-H4),
 * preserving section breadcrumbs and keeping tokens within optimal RAG bounds.
 *
 * Pipeline: heading sections → tiny adjacent sections merged up to `minTokens` → oversized
 * sections packed by paragraphs (tables split by rows with their header) with overlap.
 *
 * @param {string} markdown
 * @param {object} options
 * @param {number} [options.maxTokens=600] Maximum tokens per chunk
 * @param {number} [options.overlapTokens] Tokens of trailing context repeated at the start of the next chunk of the same section (default: 15 % of maxTokens; 0 disables)
 * @param {number} [options.minTokens=150] Adjacent sections smaller than this are merged (0 disables: one chunk per heading)
 * @param {string} [options.docId] Document identifier (defaults to a content hash)
 * @param {string} [options.docTitle='Document'] Document title
 * @returns {{ chunks: Array<object>, totalChunks: number, totalTokens: number, jsonl: string }}
 */
function chunkMarkdownForRag(markdown, options = {}) {
  if (!markdown || typeof markdown !== 'string' || !markdown.trim()) {
    return { chunks: [], totalChunks: 0, totalTokens: 0, jsonl: '' };
  }

  const { docTitle = 'Document' } = options;
  const maxTokens = Math.max(MIN_CHUNK_TOKENS, Number(options.maxTokens) || 600);
  const requestedOverlap = options.overlapTokens ?? Math.round(maxTokens * DEFAULT_OVERLAP_RATIO);
  const overlapTokens = Math.min(Math.max(0, Number(requestedOverlap) || 0), Math.floor(maxTokens / 2));
  const minTokens = Math.min(Math.max(0, Number(options.minTokens ?? DEFAULT_MIN_TOKENS) || 0), maxTokens);
  const docId = options.docId || contentDocId(markdown);

  // 1. Sections, with tiny neighbours merged: a 20-token "## Contact" section is a useless
  //    retrieval unit on its own, but a fine one together with its siblings.
  const groups = [];
  let pending = null; // { title, breadcrumbs, content, tokens }

  const flushPending = () => {
    if (!pending) return;
    const prev = groups[groups.length - 1];
    // Still under the floor (last section, or followed by an oversized one): fold it into the
    // previous group when that fits, rather than emitting a fragment
    if (pending.tokens < minTokens && prev && !prev.oversized) {
      const merged = prev.content + SEPARATOR + pending.content;
      const mergedTokens = countTokens(merged);
      if (mergedTokens <= maxTokens) {
        prev.content = merged;
        prev.tokens = mergedTokens;
        prev.breadcrumbs = commonBreadcrumbs(prev.breadcrumbs, pending.breadcrumbs);
        pending = null;
        return;
      }
    }
    groups.push(pending);
    pending = null;
  };

  for (const sec of splitIntoSections(markdown, docTitle)) {
    const tokens = countTokens(sec.content);

    if (tokens > maxTokens) {
      const oversized = { ...sec, tokens, oversized: true };
      const prev = groups[groups.length - 1];
      // An undersized fragment with no previous group to fold into leads the oversized section
      // instead: it is packed with the first part rather than left alone as a fragment
      if (pending && pending.tokens < minTokens && (!prev || prev.oversized)) {
        oversized.content = pending.content + SEPARATOR + oversized.content;
        oversized.breadcrumbs = commonBreadcrumbs(pending.breadcrumbs, oversized.breadcrumbs);
        oversized.title = pending.title;
        pending = null;
      }
      flushPending();
      groups.push(oversized);
      continue;
    }

    if (pending) {
      const merged = pending.content + SEPARATOR + sec.content;
      const mergedTokens = countTokens(merged);
      if (pending.tokens < minTokens && mergedTokens <= maxTokens) {
        pending.content = merged;
        pending.tokens = mergedTokens;
        pending.breadcrumbs = commonBreadcrumbs(pending.breadcrumbs, sec.breadcrumbs);
        continue;
      }
      flushPending();
    }
    pending = { title: sec.title, breadcrumbs: sec.breadcrumbs, content: sec.content, tokens };
  }
  flushPending();

  // 2. Chunks
  const chunks = [];
  const pushChunk = (breadcrumbs, content, title) => {
    const index = chunks.length + 1;
    chunks.push({
      id: `${docId}_chunk_${index}`,
      docId,
      docTitle,
      chunkIndex: index,
      title,
      breadcrumbs,
      breadcrumbsStr: breadcrumbs.join(' > '),
      content,
      embeddingText: buildEmbeddingText(breadcrumbs, content),
      tokenCount: countTokens(content),
      charCount: content.length
    });
  };

  for (const group of groups) {
    if (!group.oversized) {
      pushChunk(group.breadcrumbs, group.content, group.title);
      continue;
    }
    const parts = packSection(group.content, maxTokens, overlapTokens);
    parts.forEach((part, i) => {
      pushChunk(group.breadcrumbs, part, parts.length > 1 ? `${group.title} (Partie ${i + 1})` : group.title);
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
  buildEmbeddingText,
  DEFAULT_MIN_TOKENS,
  DEFAULT_OVERLAP_RATIO,
  contentDocId
};
