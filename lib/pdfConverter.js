const pdfParse = require('pdf-parse');

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
    // "Page 1", "Page 1 of 12", "1 / 15", "12", "- 4 -"
    if (/^Page\s+\d+(\s*(of|\/)\s*\d+)?$/i.test(line)) return false;
    if (/^\d+\s*\/\s*\d+$/.test(line)) return false;
    if (/^[-–—]\s*\d+\s*[-–—]$/.test(line)) return false;
    return true;
  });

  for (let i = 0; i < cleanLines.length; i++) {
    const line = cleanLines[i];

    // Blank lines
    if (!line) {
      if (formatted.length > 0 && formatted[formatted.length - 1] !== '') {
        formatted.push('');
      }
      continue;
    }

    // Detect numbered headings: "1. Introduction", "1.2 Scope", "A. Overview"
    const isNumberedHeading = /^(\d+(\.\d+)*|[A-Z]\.)\s+[A-Z0-9À-ÿ].*$/.test(line) && line.length < 90 && !line.endsWith('.');
    // Detect ALL CAPS short headings
    const isAllCapsHeading = /^[A-Z0-9À-ÿ\s\-_:]{3,60}$/.test(line) && !line.includes('.') && line.length > 3 && !/^(AND|THE|FOR|WITH|PAR|POUR)$/i.test(line);
    // Detect Chapter / Section headings
    const isChapterHeading = /^(Chapitre|Chapter|Section|Partie|Part|Annexe|Appendix)\s+\d+[:\s]/i.test(line);

    if (isNumberedHeading || isAllCapsHeading || isChapterHeading) {
      const dotCount = (line.match(/\./g) || []).length;
      let level = '##';
      if (dotCount === 1) level = '###';
      else if (dotCount >= 2) level = '####';
      else if (isChapterHeading) level = '#';
      else if (isAllCapsHeading) level = '##';

      formatted.push('');
      formatted.push(`${level} ${line.replace(/^#+\s*/, '')}`);
      formatted.push('');
      continue;
    }

    // Detect Bullet Points
    const bulletMatch = line.match(/^[\bullet•\-\*\u2013\u2014]\s*(.+)$/);
    if (bulletMatch) {
      formatted.push(`- ${bulletMatch[1]}`);
      continue;
    }

    // Detect Numbered Lists: "1) item" or "1. item"
    const numListMatch = line.match(/^(\d+|\w)[\.\)]\s*(.+)$/);
    if (numListMatch && line.length < 140) {
      formatted.push(`1. ${numListMatch[2]}`);
      continue;
    }

    // Detect pseudo-table lines (tab or 3+ spaces delimited)
    if (/\s{3,}|\t/.test(line) && line.split(/\s{3,}|\t/).length >= 2) {
      const columns = line.split(/\s{3,}|\t/).map(c => c.trim()).filter(Boolean);
      formatted.push(`|${columns.join('|')}|`);
      continue;
    }

    // Regular paragraph continuation or new line
    if (formatted.length > 0) {
      const prevLine = formatted[formatted.length - 1];
      // Join broken sentences across line breaks if previous line didn't end with sentence terminator
      if (
        prevLine &&
        !prevLine.startsWith('#') &&
        !prevLine.startsWith('-') &&
        !prevLine.startsWith('1.') &&
        !prevLine.startsWith('|') &&
        !prevLine.startsWith('>') &&
        !/[.!?:]$/.test(prevLine)
      ) {
        formatted[formatted.length - 1] = `${prevLine} ${line}`;
        continue;
      }
    }

    formatted.push(line);
  }

  return formatted.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Converts a PDF buffer to Markdown
 * @param {Buffer} buffer 
 * @returns {Promise<{markdown: string, meta: object}>}
 */
async function convertPdfToMarkdown(buffer) {
  const data = await pdfParse(buffer);
  const markdown = formatPdfTextToMarkdown(data.text);

  return {
    markdown: markdown.trim(),
    meta: {
      numpages: data.numpages,
      info: data.info || {}
    }
  };
}

module.exports = {
  convertPdfToMarkdown,
  formatPdfTextToMarkdown
};
