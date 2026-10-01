const path = require('node:path');
const { createWorker } = require('tesseract.js');

// The repository ships uncompressed traineddata files: OCR runs fully offline (no CDN download)
const LANG_PATH = path.join(__dirname, '..');
const BULLET_RE = /^[•●▪◦‣\-*]\s+(.+)$/;

// One long-lived worker per language set: spawning a worker and loading a model costs
// ~1-2 s per call, so reusing it is the dominant OCR speed-up for batch conversions.
const workers = new Map();

function getWorker(lang) {
  if (!workers.has(lang)) {
    const workerPromise = createWorker(lang.split('+'), 1, { langPath: LANG_PATH, gzip: false, cacheMethod: 'none' });
    // Drop failed initializations so the next call can retry
    workerPromise.catch(() => workers.delete(lang));
    workers.set(lang, workerPromise);
  }
  return workers.get(lang);
}

/**
 * Releases all OCR workers (call on shutdown)
 */
async function terminateOcrWorkers() {
  const pending = [...workers.values()];
  workers.clear();
  await Promise.allSettled(pending.map(async (p) => (await p).terminate()));
}

/**
 * Perform OCR on an image buffer (PNG, JPG, WEBP, etc.) and convert recognized text to Markdown
 * @param {Buffer} buffer
 * @param {string} lang Language code ('fra', 'eng', 'fra+eng')
 * @returns {Promise<{markdown: string, confidence: number}>}
 */
async function convertImageToMarkdown(buffer, lang = 'fra+eng') {
  let data;
  try {
    const worker = await getWorker(lang);
    ({ data } = await worker.recognize(buffer));
  } catch (err) {
    throw new Error(`Échec du traitement OCR sur l'image: ${err.message}`);
  }

  const rawText = data.text || '';
  const confidence = data.confidence || 0;

  // Convert raw OCR text into structured Markdown
  const formatted = [`> 📷 *Texte extrait par OCR (Confiance: ${Math.round(confidence)}%)*`, ''];

  for (const line of rawText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (formatted[formatted.length - 1] !== '') formatted.push('');
      continue;
    }

    // Detect potential headings (short ALL CAPS lines)
    if (/^[A-Z0-9À-Ý\s\-_:]{3,50}$/.test(trimmed) && /[A-ZÀ-Ý]{3}/.test(trimmed)) {
      formatted.push('', `## ${trimmed}`, '');
      continue;
    }

    const bulletMatch = trimmed.match(BULLET_RE);
    if (bulletMatch) {
      formatted.push(`- ${bulletMatch[1]}`);
      continue;
    }

    formatted.push(trimmed);
  }

  return {
    markdown: formatted.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    confidence
  };
}

module.exports = {
  convertImageToMarkdown,
  terminateOcrWorkers
};
