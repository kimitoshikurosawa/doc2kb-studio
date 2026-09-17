const XLSX = require('xlsx');

/**
 * Converts XLSX / XLS / CSV buffer into token-optimized Markdown tables or Record sets
 * @param {Buffer} buffer 
 * @param {string} originalName 
 * @param {object} [options]
 * @param {'table'|'records'|'compact'} [options.format='compact']
 * @param {number} [options.maxRows=1000] Cap to prevent context window explosion
 * @returns {string}
 */
function convertSpreadsheetToMarkdown(buffer, originalName = '', options = {}) {
  const { format = 'compact', maxRows = 1000 } = options;
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const result = [];

  workbook.SheetNames.forEach((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false });

    if (!jsonData || jsonData.length === 0) return;

    if (workbook.SheetNames.length > 1) {
      result.push(`## Feuille: ${sheetName}\n`);
    }

    // Clean up empty rows
    const rows = jsonData.filter(row => Array.isArray(row) && row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== ''));

    if (rows.length === 0) return;

    // First row as headers
    const rawHeaders = rows[0].map(h => String(h || '').trim().replace(/\|/g, '\\|'));
    const maxCols = Math.max(...rows.slice(0, 100).map(r => r.length), rawHeaders.length);

    const headers = [...rawHeaders];
    while (headers.length < maxCols) {
      headers.push(`Col_${headers.length + 1}`);
    }

    const dataRows = rows.slice(1);
    const displayedRows = dataRows.slice(0, maxRows);

    if (format === 'records') {
      // Record-oriented format for LLMs (Very token-efficient for sparse tables & embeddings)
      displayedRows.forEach((row, idx) => {
        const parts = [];
        for (let c = 0; c < maxCols; c++) {
          const val = row[c] !== undefined && row[c] !== null ? String(row[c]).trim() : '';
          if (val) {
            parts.push(`**${headers[c]}**: ${val}`);
          }
        }
        if (parts.length > 0) {
          result.push(`- [Ligne ${idx + 1}] ${parts.join(' | ')}`);
        }
      });
      result.push('\n');
    } else {
      // Compact GFM Markdown table
      const isUltra = format === 'compact';
      const sep = isUltra ? '|' : ' | ';
      const pad = isUltra ? '' : ' ';

      result.push(`|${pad}${headers.join(sep)}${pad}|`);
      result.push(`|${pad}${headers.map(() => '---').join(sep)}${pad}|`);

      displayedRows.forEach(row => {
        const cells = [];
        for (let c = 0; c < maxCols; c++) {
          const val = row[c] !== undefined && row[c] !== null ? String(row[c]).trim().replace(/\|/g, '\\|').replace(/\r?\n/g, ' ') : '';
          cells.push(val);
        }
        result.push(`|${pad}${cells.join(sep)}${pad}|`);
      });

      result.push('\n');
    }

    if (dataRows.length > maxRows) {
      result.push(`> ⚠️ *Table tronquée: ${dataRows.length - maxRows} lignes supplémentaires omises pour optimiser les tokens LLM.*\n`);
    }
  });

  return result.join('\n').trim();
}

module.exports = {
  convertSpreadsheetToMarkdown
};
