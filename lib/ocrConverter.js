const { createWorker } = require('tesseract.js');

/**
 * Perform OCR on an image buffer (PNG, JPG, WEBP, etc.) and convert recognized text to Markdown
 * @param {Buffer} buffer 
 * @param {string} lang Language code ('fra', 'eng', 'fra+eng')
 * @returns {Promise<{markdown: string, confidence: number}>}
 */
async function convertImageToMarkdown(buffer, lang = 'fra+eng') {
  let worker;
  try {
    worker = await createWorker(lang);
    const { data } = await worker.recognize(buffer);
    await worker.terminate();

    const rawText = data.text || '';
    const confidence = data.confidence || 0;

    // Convert raw OCR text into structured Markdown
    const lines = rawText.split(/\r?\n/);
    const formatted = [];

    formatted.push(`> 📷 *Texte extrait par OCR (Confiance: ${Math.round(confidence)}%)*\n`);

    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) {
        if (formatted.length > 0 && formatted[formatted.length - 1] !== '') {
          formatted.push('');
        }
        return;
      }

      // Detect potential headings
      if (/^[A-Z0-9À-ÿ\s\-_:]{3,50}$/.test(trimmed) && trimmed.length > 3) {
        formatted.push(`\n## ${trimmed}\n`);
        return;
      }

      // Detect bullet points
      if (/^[\bullet•\-\*]\s*(.+)$/.test(trimmed)) {
        formatted.push(`- ${trimmed.replace(/^[\bullet•\-\*]\s*/, '')}`);
        return;
      }

      formatted.push(trimmed);
    });

    return {
      markdown: formatted.join('\n').trim(),
      confidence
    };
  } catch (err) {
    if (worker) await worker.terminate();
    throw new Error(`Échec du traitement OCR sur l'image: ${err.message}`);
  }
}

module.exports = {
  convertImageToMarkdown
};
