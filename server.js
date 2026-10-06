const express = require('express');
const multer = require('multer');
const path = require('node:path');
const { ZipArchive } = require('archiver');
const { convertFileToMarkdown, analyzeMarkdown } = require('./lib/converter');
const { optimizeMarkdown } = require('./lib/tokenOptimizer');
const {
  chunkMarkdownForRag,
  toJsonlRecord,
  DEFAULT_MIN_TOKENS,
  DEFAULT_OVERLAP_RATIO
} = require('./lib/semanticChunker');
const {
  buildKnowledgeBase,
  exportKnowledgeBaseZip,
  recommendContextStrategy,
  FULL_CONTEXT_MAX_TOKENS
} = require('./lib/knowledgeBaseService');
const { anonymizeText } = require('./lib/anonymizer');
const { terminateOcrWorkers } = require('./lib/ocrConverter');
const { MODEL_PRICING, PRICING_AS_OF } = require('./lib/pricing');
const { PRIMARY_ENCODING } = require('./lib/tokenizer');
const { version } = require('./package.json');

const PORT = Number(process.env.PORT) || 3000;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB max per file
const MAX_BATCH_FILES = 30;
// CPU-bound work (tokenization) runs on the main thread anyway; a small pool only overlaps I/O-bound
// steps (PDF parsing, OCR worker round-trips) without starving other requests.
const BATCH_CONCURRENCY = Math.max(1, Number(process.env.BATCH_CONCURRENCY) || 3);

const LEVELS = new Set(['raw', 'clean', 'ultra_compact']);
const TABLE_FORMATS = new Set(['table', 'records', 'compact']);
const ANONYMIZE_MODES = new Set(['pseudonymize', 'mask', 'redact']);

const app = express();
app.disable('x-powered-by');

// Multer storage setup (in-memory for maximum processing speed without disk clutter)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_BATCH_FILES },
  // Browsers send raw UTF-8 filenames: without this, "Élodie.docx" becomes "Ã‰lodie.docx"
  defParamCharset: 'utf8'
});

// Security headers (the UI only loads its own scripts + Google Fonts + Font Awesome from cdnjs)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
    "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
  ].join('; '));
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
// Client-side markdown-it is served from the installed package so it never drifts from the server version
const MARKDOWN_IT_BROWSER = require.resolve('markdown-it/browser'); // UMD build (require condition)
app.get('/vendor/markdown-it.min.js', (req, res) => {
  res.sendFile(MARKDOWN_IT_BROWSER, { maxAge: '7d' });
});

const isTrue = (v) => v === true || v === 'true';
const isFalse = (v) => v === false || v === 'false';
const pick = (value, allowed, fallback) => (allowed.has(value) ? value : fallback);
const clampInt = (value, min, max, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/**
 * Normalizes and validates conversion options from multipart (strings) or JSON (typed) bodies
 * @param {object} body
 */
function parseConversionOptions(body = {}) {
  return {
    level: pick(body.level, LEVELS, 'clean'),
    injectFrontmatter: isTrue(body.injectFrontmatter),
    includeRag: !isFalse(body.includeRag),
    chunkMaxTokens: clampInt(body.chunkMaxTokens, 50, 8000, 600),
    // undefined = chunker defaults (15 % overlap, 150-token floor), 0 disables explicitly
    chunkOverlapTokens: clampInt(body.chunkOverlapTokens, 0, 1000, undefined),
    chunkMinTokens: clampInt(body.chunkMinTokens, 0, 2000, undefined),
    tableFormat: pick(body.tableFormat, TABLE_FORMATS, 'compact'),
    compactTables: !isFalse(body.compactTables),
    anonymize: isTrue(body.anonymize),
    anonymizeOptions: {
      mode: pick(body.anonymizeMode, ANONYMIZE_MODES, 'pseudonymize')
    }
  };
}

/**
 * Maps over items with at most `limit` promises in flight, preserving input order
 */
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ==========================================
// API: Single File Conversion & KB Ingestion
// ==========================================
app.post('/api/convert', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Aucun fichier n\'a été fourni.' });
  }

  const { originalname, buffer, mimetype } = req.file;
  const result = await convertFileToMarkdown(buffer, originalname, mimetype, parseConversionOptions(req.body));
  return res.json({ success: true, result });
});

// ==========================================
// API: Batch Files Conversion
// ==========================================
app.post('/api/convert-batch', upload.array('files', MAX_BATCH_FILES), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'Aucun fichier fourni.' });
  }

  const options = parseConversionOptions(req.body);
  const results = await mapWithConcurrency(req.files, BATCH_CONCURRENCY, async (file) => {
    try {
      const resObj = await convertFileToMarkdown(file.buffer, file.originalname, file.mimetype, options);
      return { success: true, ...resObj };
    } catch (err) {
      return { success: false, originalFilename: file.originalname, error: err.message };
    }
  });

  let totalOriginalTokens = 0;
  let totalOptimizedTokens = 0;
  for (const r of results) {
    if (!r.success) continue;
    totalOriginalTokens += r.savings ? r.savings.originalTokens : r.stats.tokens;
    totalOptimizedTokens += r.stats.tokens;
  }

  const tokensSaved = Math.max(0, totalOriginalTokens - totalOptimizedTokens);
  const savingsPct = totalOriginalTokens > 0 ? +((tokensSaved / totalOriginalTokens) * 100).toFixed(1) : 0;

  return res.json({
    success: true,
    count: results.length,
    tokenEconomy: {
      totalOriginalTokens,
      totalOptimizedTokens,
      tokensSaved,
      savingsPercentage: savingsPct,
      contextStrategy: recommendContextStrategy(totalOptimizedTokens)
    },
    results
  });
});

// ==========================================
// API: Optimize Direct Text / Markdown
// ==========================================
app.post('/api/optimize-text', (req, res) => {
  const { text, filename } = req.body || {};
  if (typeof text !== 'string') {
    return res.status(400).json({ error: 'Champ text requis.' });
  }

  const options = parseConversionOptions(req.body);
  const docName = typeof filename === 'string' && filename.trim() ? path.basename(filename).slice(0, 255) : 'document.md';
  const baseName = path.basename(docName, path.extname(docName));
  let processedText = text;
  let anonymizationData = null;

  if (options.anonymize) {
    anonymizationData = anonymizeText(text, options.anonymizeOptions);
    processedText = anonymizationData.anonymizedText;
  }

  const optResult = optimizeMarkdown(processedText, {
    level: options.level,
    injectFrontmatter: options.injectFrontmatter,
    compactTables: options.compactTables,
    filename: docName
  });

  const analysis = analyzeMarkdown(optResult.optimizedMarkdown, text);

  const rag = options.includeRag
    ? chunkMarkdownForRag(optResult.body, {
      maxTokens: options.chunkMaxTokens,
      overlapTokens: options.chunkOverlapTokens,
      minTokens: options.chunkMinTokens,
      // Same doc id as /api/convert: re-optimizing keeps chunk ids stable for vector upserts
      docId: baseName.replace(/[^\w-]/g, '_'),
      docTitle: optResult.meta.title || baseName
    })
    : null;

  return res.json({
    success: true,
    optimizedMarkdown: optResult.optimizedMarkdown,
    originalMarkdown: text,
    renderedHtml: analysis.renderedHtml,
    stats: analysis.stats,
    meta: optResult.meta,
    savings: optResult.savings,
    anonymization: anonymizationData ? {
      stats: anonymizationData.stats,
      entitiesCount: anonymizationData.entities.length,
      rehydrationMap: anonymizationData.rehydrationMap
    } : null,
    rag
  });
});

// ==========================================
// API: Render Live Markdown with Token Stats
// ==========================================
app.post('/api/render-markdown', (req, res) => {
  const { markdown, originalMarkdown } = req.body || {};
  if (typeof markdown !== 'string') {
    return res.status(400).json({ error: 'Champ markdown requis.' });
  }

  const analysis = analyzeMarkdown(markdown, typeof originalMarkdown === 'string' ? originalMarkdown : null);
  return res.json({
    success: true,
    renderedHtml: analysis.renderedHtml,
    stats: analysis.stats
  });
});

// ==========================================
// API: Generate & Download Knowledge Base (llms.txt + RAG JSONL + Docs Zip)
// ==========================================
app.post('/api/generate-knowledge-base', async (req, res) => {
  const {
    documents, // Array of { filename, markdown }
    projectTitle = 'Knowledge Base',
    summary = 'Curated knowledge base optimized for LLM reasoning and token reduction.'
  } = req.body || {};

  const validDocs = Array.isArray(documents)
    ? documents.filter(d => d && typeof d.filename === 'string' && typeof d.markdown === 'string')
    : [];
  if (validDocs.length === 0) {
    return res.status(400).json({ error: 'Liste de documents invalide ou vide.' });
  }

  const options = parseConversionOptions(req.body);
  const title = String(projectTitle).slice(0, 200) || 'Knowledge Base';
  const kbData = buildKnowledgeBase(validDocs, {
    projectTitle: title,
    summary: String(summary).slice(0, 1000),
    level: options.level,
    chunkMaxTokens: options.chunkMaxTokens,
    chunkOverlapTokens: options.chunkOverlapTokens,
    chunkMinTokens: options.chunkMinTokens,
    compactTables: options.compactTables,
    anonymize: options.anonymize,
    anonymizeOptions: options.anonymizeOptions
  });

  const safeTitle = title.toLowerCase().replace(/[^\w-]/g, '_');
  res.attachment(`${safeTitle}-knowledge-base.zip`);
  res.setHeader('Content-Type', 'application/zip');

  try {
    await exportKnowledgeBaseZip(kbData, res);
  } catch (error) {
    // Headers are already sent: the stream has been destroyed, just log
    console.error('Error streaming knowledge base zip:', error);
  }
});

// ==========================================
// API: Export RAG Chunks JSONL
// ==========================================
app.post('/api/export-rag-jsonl', (req, res) => {
  const { chunks } = req.body || {}; // Array of chunks
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return res.status(400).json({ error: 'Liste de chunks requise.' });
  }

  res.attachment('rag-chunks.jsonl');
  res.setHeader('Content-Type', 'application/x-ndjson');
  return res.send(chunks.filter(c => c && typeof c === 'object').map(toJsonlRecord).join('\n'));
});

// ==========================================
// API: Download Converted Files as ZIP Archive
// ==========================================
app.post('/api/download-zip', (req, res) => {
  const { files } = req.body || {}; // Array of { filename, content }
  const validFiles = Array.isArray(files)
    ? files.filter(f => f && typeof f.filename === 'string' && f.filename && typeof f.content === 'string')
    : [];
  if (validFiles.length === 0) {
    return res.status(400).json({ error: 'Liste de fichiers invalide.' });
  }

  res.attachment('markdown-conversions.zip');
  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on('error', (err) => {
    console.error('Error streaming zip:', err);
    res.destroy(err);
  });
  archive.pipe(res);

  for (const f of validFiles) {
    // Flatten paths: archive entries must never escape the archive root ("../../etc/x")
    archive.append(f.content, { name: path.basename(f.filename) });
  }
  archive.finalize();
});

// ==========================================
// API: Health & Capabilities Status
// ==========================================
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    app: 'Doc2KB Studio',
    version,
    runtime: { node: process.version },
    capabilities: {
      converters: ['docx', 'pdf', 'xlsx', 'csv', 'html', 'ocr_images', 'txt_code'],
      tokenizer: `js-tiktoken (${PRIMARY_ENCODING} primary, cl100k_base legacy)`,
      ragChunking: {
        semantic: true,
        overlap: true,
        codeAware: true,
        defaults: { maxTokens: 600, overlapRatio: DEFAULT_OVERLAP_RATIO, minTokens: DEFAULT_MIN_TOKENS },
        contextualEmbeddingText: true,
        tableHeaderRepetition: true
      },
      contextStrategy: { fullContextMaxTokens: FULL_CONTEXT_MAX_TOKENS },
      llmsTxtStandard: 'llmstxt.org v0.1',
      tokenOptimizer: [...LEVELS],
      anonymization: {
        supported: true,
        modes: [...ANONYMIZE_MODES],
        entities: ['iban', 'credit_card', 'french_nir', 'secrets_api_keys', 'emails', 'phones', 'ips', 'names']
      }
    },
    pricing: {
      asOf: PRICING_AS_OF,
      unit: 'USD per 1M input tokens',
      models: MODEL_PRICING
    }
  });
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Route API inconnue.' });
});

// Centralized error handler (Express 5 forwards rejected async handlers here)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? `Fichier trop volumineux (max ${MAX_FILE_SIZE / 1024 / 1024} Mo).`
      : `Upload invalide: ${err.message}`;
    return res.status(status).json({ error: message });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Corps JSON invalide.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Requête trop volumineuse.' });
  }

  console.error(`Error in ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) return res.destroy(err);
  return res.status(500).json({ error: err.message || 'Erreur interne du serveur.' });
});

function start(port = PORT) {
  const server = app.listen(port, () => {
    console.log(`====================================================`);
    console.log(`🚀 Doc2KB Studio v${version} démarré (Node ${process.version})`);
    console.log(`🌐 Application accessible sur: http://localhost:${server.address().port}`);
    console.log(`🧠 Moteur d'optimisation IA & Réduction de Tokens actif`);
    console.log(`📑 Norme llms.txt & Chunking RAG intégrés`);
    console.log(`====================================================`);
  });

  const shutdown = (signal) => {
    console.log(`\n${signal} reçu, arrêt propre...`);
    server.close(async () => {
      await terminateOcrWorkers();
      process.exit(0);
    });
    server.closeIdleConnections();
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  return server;
}

if (require.main === module) {
  start();
}

module.exports = { app, start, parseConversionOptions };
