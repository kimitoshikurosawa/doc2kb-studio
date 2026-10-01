const { PDFParse } = require('pdf-parse');

// Bullet glyphs commonly produced by PDF text extraction (•, ●, ▪, ◦, ‣, -, *, –, —)
const BULLET_RE = /^[•●▪◦‣\-*–—]\s+(.+)$/;
const NUMBERED_ITEM_RE = /^(\d{1,3})[.)]\s+(.+)$/;
const LETTERED_ITEM_RE = /^[a-z]\)\s+(.+)$/;
const COLUMN_SPLIT_RE = /\s{3,}|\t/;

/**
 * Turns runs of consecutive pseudo-table rows (`|a|b|`) into valid GFM tables
 * by inserting the mandatory separator row; isolated rows become plain text.
 * @param {string[]} lines
 * @returns {string[]}
 */
function finalizePseudoTables(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith('|')) {
      out.push(lines[i]);
      i++;
      continue;
    }

    const block = [];
    while (i < lines.length && lines[i].startsWith('|')) block.push(lines[i++]);

    if (block.length < 2) {
      out.push(block[0].slice(1, -1).split('|').join(' | '));
      continue;
    }

    const width = Math.max(...block.map(r => r.split('|').length - 2));
    const pad = (row) => {
      const cells = row.split('|').slice(1, -1);
      while (cells.length < width) cells.push('');
      return `|${cells.join('|')}|`;
    };
    out.push(pad(block[0]), `|${Array(width).fill('---').join('|')}|`, ...block.slice(1).map(pad));
  }
  return out;
}

/**
 * Clean and structure raw PDF text into high-quality Markdown for LLMs
 * @param {string} rawText
 * @returns {string}
 */
function formatPdfTextToMarkdown(rawText) {
  if (!rawText) return '';

  const rawLines = rawText.split(/\r?\n/);
  const formatted = [];

  // Filter out running page numbers and common artifacts
  const cleanLines = rawLines.map(l => l.trim()).filter(line => {
    if (!line) return true; // keep blank line markers
    // "Page 1", "Page 1 of 12", "1 / 15", "- 4 -", "-- 1 of 3 --" (pdf-parse page joiner)
    if (/^Page\s+\d+(\s*(of|sur|\/)\s*\d+)?$/i.test(line)) return false;
    if (/^\d+\s*\/\s*\d+$/.test(line)) return false;
    if (/^[-–—]+\s*\d+(\s+(of|sur)\s+\d+)?\s*[-–—]+$/i.test(line)) return false;
    return true;
  });

  for (const line of cleanLines) {
    // Blank lines
    if (!line) {
      if (formatted.length > 0 && formatted[formatted.length - 1] !== '') {
        formatted.push('');
      }
      continue;
    }

    // Detect numbered headings: "1. Introduction", "1.2 Scope", "A. Overview"
    const isNumberedHeading = /^(\d+(\.\d+)*\.?|[A-Z]\.)\s+[A-Z0-9À-Ý].*$/.test(line) && line.length < 90 && !/[.:;,]$/.test(line);
    // Detect ALL CAPS short headings
    const isAllCapsHeading = /^[A-Z0-9À-Ý\s\-_:]{3,60}$/.test(line) && /[A-ZÀ-Ý]{3}/.test(line) && !/^(AND|THE|FOR|WITH|PAR|POUR)$/i.test(line);
    // Detect Chapter / Section headings
    const isChapterHeading = /^(Chapitre|Chapter|Section|Partie|Part|Annexe|Appendix)\s+\d+[:\s]/i.test(line);

    if (isNumberedHeading || isAllCapsHeading || isChapterHeading) {
      const numbering = (line.match(/^\d+(\.\d+)*/) || [''])[0];
      const depth = numbering ? numbering.split('.').length : 0;
      let level = '##';
      if (isChapterHeading) level = '#';
      else if (depth === 2) level = '###';
      else if (depth >= 3) level = '####';

      formatted.push('');
      formatted.push(`${level} ${line.replace(/^#+\s*/, '')}`);
      formatted.push('');
      continue;
    }

    // Detect Bullet Points
    const bulletMatch = line.match(BULLET_RE);
    if (bulletMatch) {
      formatted.push(`- ${bulletMatch[1]}`);
      continue;
    }

    // Detect Numbered Lists: "1) item" or "1. item" (keeps the original number)
    const numListMatch = line.length < 140 && line.match(NUMBERED_ITEM_RE);
    if (numListMatch) {
      formatted.push(`${numListMatch[1]}. ${numListMatch[2]}`);
      continue;
    }

    const letterMatch = line.length < 140 && line.match(LETTERED_ITEM_RE);
    if (letterMatch) {
      formatted.push(`- ${letterMatch[1]}`);
      continue;
    }

    // Detect pseudo-table lines (tab or 3+ spaces delimited)
    if (COLUMN_SPLIT_RE.test(line)) {
      const columns = line.split(COLUMN_SPLIT_RE).map(c => c.trim().replace(/\|/g, '\\|')).filter(Boolean);
      if (columns.length >= 2) {
        formatted.push(`|${columns.join('|')}|`);
        continue;
      }
    }

    // Regular paragraph continuation or new line
    if (formatted.length > 0) {
      const prevLine = formatted[formatted.length - 1];
      // Join broken sentences across line breaks if previous line didn't end with sentence terminator
      if (
        prevLine &&
        !prevLine.startsWith('#') &&
        !prevLine.startsWith('- ') &&
        !/^\d+\. /.test(prevLine) &&
        !prevLine.startsWith('|') &&
        !prevLine.startsWith('>') &&
        !/[.!?:]$/.test(prevLine)
      ) {
        // Re-join words hyphenated across a line break ("transfor-\nmation")
        formatted[formatted.length - 1] = /[a-zà-ÿ]-$/.test(prevLine)
          ? `${prevLine.slice(0, -1)}${line}`
          : `${prevLine} ${line}`;
        continue;
      }
    }

    formatted.push(line);
  }

  return finalizePseudoTables(formatted).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Converts a PDF buffer to Markdown
 * @param {Buffer} buffer
 * @returns {Promise<{markdown: string, meta: object}>}
 */
async function convertPdfToMarkdown(buffer) {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    // Join pages ourselves: pdf-parse's default joiner injects "-- N of M --" markers
    const text = result.pages.map(p => p.text).join('\n\n');
    const markdown = formatPdfTextToMarkdown(text);

    return {
      markdown,
      meta: {
        numpages: result.total
      }
    };
  } finally {
    await parser.destroy();
  }
}

module.exports = {
  convertPdfToMarkdown,
  formatPdfTextToMarkdown
};
