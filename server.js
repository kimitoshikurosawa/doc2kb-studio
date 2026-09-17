const express = require('express');
const multer = require('multer');
const path = require('path');
const archiver = require('archiver');
const { convertFileToMarkdown, analyzeMarkdown, md } = require('./lib/converter');
const { optimizeMarkdown } = require('./lib/tokenOptimizer');
const { chunkMarkdownForRag } = require('./lib/semanticChunker');
const { buildKnowledgeBase, exportKnowledgeBaseZip } = require('./lib/knowledgeBaseService');
const { analyzeTokens, calculateSavings } = require('./lib/tokenizer');

const app = express();
const PORT = process.env.PORT || 3000;

// Multer storage setup (in-memory for maximum processing speed without disk clutter)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50 MB max per file
});

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Helper to parse conversion options from request
function parseConversionOptions(reqBody) {
  return {
    level: reqBody.level || 'clean', // 'raw' | 'clean' | 'ultra_compact'
    injectFrontmatter: reqBody.injectFrontmatter === 'true' || reqBody.injectFrontmatter === true,
    includeRag: reqBody.includeRag !== 'false' && reqBody.includeRag !== false,
    chunkMaxTokens: parseInt(reqBody.chunkMaxTokens, 10) || 600,
    tableFormat: reqBody.tableFormat || 'compact'
  };
}

// ==========================================
// API: Single File Conversion & KB Ingestion
// ==========================================
app.post('/api/convert', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier n\'a été fourni.' });
    }

    const { originalname, buffer, mimetype } = req.file;
    const options = parseConversionOptions(req.body);

    const result = await convertFileToMarkdown(buffer, originalname, mimetype, options);

    return res.json({
      success: true,
      result
    });
  } catch (error) {
    console.error('Error in /api/convert:', error);
    return res.status(500).json({ error: error.message || 'Erreur lors de la conversion du fichier.' });
  }
});

// ==========================================
// API: Batch Files Conversion
// ==========================================
app.post('/api/convert-batch', upload.array('files', 30), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Aucun fichier fourni.' });
    }

    const options = parseConversionOptions(req.body);
    const results = [];
    let totalOriginalTokens = 0;
    let totalOptimizedTokens = 0;

    for (const file of req.files) {
      try {
        const resObj = await convertFileToMarkdown(file.buffer, file.originalname, file.mimetype, options);
        totalOriginalTokens += resObj.savings ? resObj.savings.originalTokens : resObj.stats.tokens;
        totalOptimizedTokens += resObj.stats.tokens;
        results.push({ success: true, ...resObj });
      } catch (err) {
        results.push({
          success: false,
          originalFilename: file.originalname,
          error: err.message
        });
      }
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
        savingsPercentage: savingsPct
      },
      results
    });
  } catch (error) {
    console.error('Error in /api/convert-batch:', error);
    return res.status(500).json({ error: error.message || 'Erreur lors de la conversion par lots.' });
  }
});

// ==========================================
// API: Optimize Direct Text / Markdown
// ==========================================
app.post('/api/optimize-text', (req, res) => {
  try {
    const { text, filename, level = 'clean', injectFrontmatter = false, includeRag = true, chunkMaxTokens = 600 } = req.body;
    if (typeof text !== 'string') {
      return res.status(400).json({ error: 'Champ text requis.' });
    }

    const optResult = optimizeMarkdown(text, {
      level,
      injectFrontmatter,
      filename: filename || 'document.md'
    });

    const analysis = analyzeMarkdown(optResult.optimizedMarkdown, text);

    let rag = null;
    if (includeRag) {
      rag = chunkMarkdownForRag(optResult.optimizedMarkdown, {
        maxTokens: chunkMaxTokens,
        docTitle: optResult.meta.title || filename || 'Document'
      });
    }

    return res.json({
      success: true,
      optimizedMarkdown: optResult.optimizedMarkdown,
      originalMarkdown: text,
      renderedHtml: analysis.renderedHtml,
      stats: analysis.stats,
      meta: optResult.meta,
      savings: optResult.savings,
      rag
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: Render Live Markdown with Token Stats
// ==========================================
app.post('/api/render-markdown', (req, res) => {
  try {
    const { markdown, originalMarkdown } = req.body;
    if (typeof markdown !== 'string') {
      return res.status(400).json({ error: 'Champ markdown requis.' });
    }

    const analysis = analyzeMarkdown(markdown, originalMarkdown || null);
    return res.json({
      success: true,
      renderedHtml: analysis.renderedHtml,
      stats: analysis.stats
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: Generate & Download Knowledge Base (llms.txt + RAG JSONL + Docs Zip)
// ==========================================
app.post('/api/generate-knowledge-base', (req, res) => {
  try {
    const {
      documents, // Array of { filename, markdown }
      projectTitle = 'Knowledge Base',
      summary = 'Curated knowledge base optimized for LLM reasoning and token reduction.',
      level = 'clean',
      chunkMaxTokens = 600
    } = req.body;

    if (!Array.isArray(documents) || documents.length === 0) {
      return res.status(400).json({ error: 'Liste de documents invalide ou vide.' });
    }

    const kbData = buildKnowledgeBase(documents, {
      projectTitle,
      summary,
      level,
      chunkMaxTokens
    });

    const safeTitle = projectTitle.toLowerCase().replace(/[^\w-]/g, '_');
    res.attachment(`${safeTitle}-knowledge-base.zip`);
    res.setHeader('Content-Type', 'application/zip');

    exportKnowledgeBaseZip(kbData, res);
  } catch (error) {
    console.error('Error in /api/generate-knowledge-base:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: Export RAG Chunks JSONL
// ==========================================
app.post('/api/export-rag-jsonl', (req, res) => {
  try {
    const { chunks } = req.body; // Array of chunks or markdown
    if (!Array.isArray(chunks) || chunks.length === 0) {
      return res.status(400).json({ error: 'Liste de chunks requise.' });
    }

    const jsonl = chunks.map(c => JSON.stringify({
      id: c.id,
      doc_id: c.docId || c.doc_id,
      doc_title: c.docTitle || c.doc_title,
      chunk_index: c.chunkIndex || c.chunk_index,
      title: c.title,
      breadcrumbs: c.breadcrumbsStr || c.breadcrumbs,
      token_count: c.tokenCount || c.token_count,
      text: c.content || c.text
    })).join('\n');

    res.attachment('rag-chunks.jsonl');
    res.setHeader('Content-Type', 'application/x-ndjson');
    return res.send(jsonl);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: Download Converted Files as ZIP Archive
// ==========================================
app.post('/api/download-zip', (req, res) => {
  try {
    const { files } = req.body; // Array of { filename, content }
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'Liste de fichiers invalide.' });
    }

    res.attachment('markdown-conversions.zip');
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', (err) => {
      res.status(500).send({ error: err.message });
    });

    archive.pipe(res);

    files.forEach(f => {
      if (f.filename && f.content) {
        archive.append(f.content, { name: f.filename });
      }
    });

    archive.finalize();
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: Health & Capabilities Status
// ==========================================
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    app: 'Doc2KB Studio',
    version: '2.0.0',
    capabilities: {
      converters: ['docx', 'pdf', 'xlsx', 'csv', 'html', 'ocr_images', 'txt_code'],
      tokenizer: 'js-tiktoken (cl100k_base, o200k_base)',
      ragChunking: true,
      llmsTxtStandard: 'llmstxt.org v0.1',
      tokenOptimizer: ['raw', 'clean', 'ultra_compact']
    }
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Doc2KB Studio démarré avec succès !`);
  console.log(`🌐 Application accessible sur: http://localhost:${PORT}`);
  console.log(`🧠 Moteur d'optimisation IA & Réduction de Tokens actif`);
  console.log(`📑 Norme llms.txt & Chunking RAG intégrés`);
  console.log(`====================================================`);
});
