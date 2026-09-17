/**
 * Doc2KB Studio - Client App v2.0
 * AI Knowledge Base & LLM Token Reduction Studio
 */

document.addEventListener('DOMContentLoaded', () => {
  // Client-side markdown-it instance for instant rendering
  const md = window.markdownit ? window.markdownit({
    html: true,
    linkify: true,
    typographer: true,
    breaks: true
  }) : null;

  // Global State
  const state = {
    queue: [], // [{ id, file, status, result }]
    convertedFiles: [], // [{ filename, content, result }]
    activeFileId: null,
    currentMarkdown: '',
    originalRawMarkdown: '',
    currentRagChunks: [],
    currentStats: null,
    currentSavings: null,
    theme: 'dark'
  };

  // DOM Elements - Config
  const optLevelSelect = document.getElementById('optLevelSelect');
  const chkFrontmatter = document.getElementById('chkFrontmatter');
  const chkCompactTables = document.getElementById('chkCompactTables');
  const chkRagChunks = document.getElementById('chkRagChunks');
  const kbProjectTitle = document.getElementById('kbProjectTitle');
  const chunkMaxTokensInput = document.getElementById('chunkMaxTokensInput');

  // DOM Elements - Header & Metrics
  const pillTokens = document.getElementById('pillTokens');
  const pillSavings = document.getElementById('pillSavings');
  const themeToggleBtn = document.getElementById('themeToggleBtn');

  // DOM Elements - Dropzone & Queue
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const queueCard = document.getElementById('queueCard');
  const queueList = document.getElementById('queueList');
  const queueCount = document.getElementById('queueCount');
  const btnClearQueue = document.getElementById('btnClearQueue');
  const btnConvertAll = document.getElementById('btnConvertAll');
  const btnSampleFile = document.getElementById('btnSampleFile');
  const btnExportKbZip = document.getElementById('btnExportKbZip');

  // DOM Elements - Workspace
  const workspaceContainer = document.getElementById('workspaceContainer');
  const markdownEditor = document.getElementById('markdownEditor');
  const markdownPreview = document.getElementById('markdownPreview');
  const htmlSourceViewer = document.getElementById('htmlSourceViewer');
  const activeFilename = document.getElementById('activeFilename');

  // DOM Elements - Toolbar & Actions
  const btnOptimizeNow = document.getElementById('btnOptimizeNow');
  const btnCopyMd = document.getElementById('btnCopyMd');
  const btnDownloadMd = document.getElementById('btnDownloadMd');
  const btnDownloadRagJsonl = document.getElementById('btnDownloadRagJsonl');
  const btnCopyJsonl = document.getElementById('btnCopyJsonl');
  const btnCopyLlmsTxt = document.getElementById('btnCopyLlmsTxt');

  // DOM Elements - Tabs & RAG
  const badgeRagCount = document.getElementById('badgeRagCount');
  const ragChunkTotal = document.getElementById('ragChunkTotal');
  const ragChunksList = document.getElementById('ragChunksList');
  const llmsTxtViewer = document.getElementById('llmsTxtViewer');

  // DOM Elements - Stats & Costs
  const statSavedPercent = document.getElementById('statSavedPercent');
  const statOrigTokens = document.getElementById('statOrigTokens');
  const statOptTokens = document.getElementById('statOptTokens');
  const statTokensSavedCount = document.getElementById('statTokensSavedCount');
  const statTokens = document.getElementById('statTokens');
  const statWords = document.getElementById('statWords');
  const statChars = document.getElementById('statChars');
  const statHeaders = document.getElementById('statHeaders');
  const statDensity = document.getElementById('statDensity');
  const statReadingTime = document.getElementById('statReadingTime');

  const costGpt4o = document.getElementById('costGpt4o');
  const costClaude = document.getElementById('costClaude');
  const costGemini = document.getElementById('costGemini');
  const costGpt4oMini = document.getElementById('costGpt4oMini');

  // Helper: Read active conversion options
  function getConversionOptions() {
    return {
      level: optLevelSelect ? optLevelSelect.value : 'clean',
      injectFrontmatter: chkFrontmatter ? chkFrontmatter.checked : true,
      compactTables: chkCompactTables ? chkCompactTables.checked : true,
      includeRag: chkRagChunks ? chkRagChunks.checked : true,
      chunkMaxTokens: chunkMaxTokensInput ? parseInt(chunkMaxTokensInput.value, 10) || 600 : 600,
      projectTitle: kbProjectTitle ? kbProjectTitle.value.trim() || 'Knowledge Base' : 'Knowledge Base'
    };
  }

  // --- Theme Toggle ---
  themeToggleBtn.addEventListener('click', () => {
    document.body.classList.toggle('light-mode');
    document.body.classList.toggle('dark-mode');
    const isLight = document.body.classList.contains('light-mode');
    themeToggleBtn.innerHTML = isLight ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
    showToast(`Mode ${isLight ? 'Clair' : 'Sombre'} activé`, 'info');
  });

  // --- View Control (Split / Editor / Preview) ---
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const viewMode = btn.dataset.view;
      workspaceContainer.className = `workspace-container view-${viewMode}`;
    });
  });

  // --- Preview Subtabs Navigation ---
  const subtabBtns = document.querySelectorAll('.subtab-btn');
  const subtabContents = document.querySelectorAll('.subtab-content');
  subtabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      subtabBtns.forEach(b => b.classList.remove('active'));
      subtabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const targetSubtab = btn.dataset.subtab;
      const targetMap = {
        rendered: 'subtabRendered',
        rag: 'subtabRag',
        llms: 'subtabLlms',
        stats: 'subtabStats',
        source: 'subtabSource'
      };
      const elId = targetMap[targetSubtab];
      if (elId) {
        const el = document.getElementById(elId);
        if (el) el.classList.add('active');
      }
    });
  });

  // --- Drag & Drop Setup ---
  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) handleFilesAdded(files);
  });

  fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) handleFilesAdded(files);
    fileInput.value = '';
  });

  // --- Handle Added Files ---
  function handleFilesAdded(files) {
    files.forEach(file => {
      const queueItem = {
        id: 'file_' + Math.random().toString(36).substring(2, 9),
        file,
        status: 'pending',
        result: null
      };
      state.queue.push(queueItem);
    });

    renderQueue();
    showToast(`${files.length} document(s) ajouté(s)`, 'info');

    // Auto-convert if single file
    if (files.length === 1 && state.queue.length === 1) {
      convertQueueItem(state.queue[0]);
    }
  }

  // --- Queue UI Renderer ---
  function renderQueue() {
    if (state.queue.length === 0) {
      queueCard.classList.add('hidden');
      return;
    }

    queueCard.classList.remove('hidden');
    queueCount.textContent = state.queue.length;
    queueList.innerHTML = '';

    state.queue.forEach(item => {
      const el = document.createElement('div');
      el.className = `queue-item ${item.id === state.activeFileId ? 'active' : ''}`;

      const ext = item.file.name.split('.').pop().toLowerCase();
      let iconClass = 'fa-file-text format-icon txt';
      if (['docx', 'doc'].includes(ext)) iconClass = 'fa-file-word format-icon docx';
      if (ext === 'pdf') iconClass = 'fa-file-pdf format-icon pdf';
      if (['xlsx', 'xls', 'csv'].includes(ext)) iconClass = 'fa-file-excel format-icon excel';
      if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext)) iconClass = 'fa-file-image format-icon image';
      if (['html', 'htm'].includes(ext)) iconClass = 'fa-code format-icon html';

      let statusBadge = `<span class="status-badge pending">En attente</span>`;
      let tokenBadge = '';

      if (item.status === 'converting') {
        statusBadge = `<span class="status-badge pending"><i class="fa-solid fa-spinner fa-spin"></i> Traitement...</span>`;
      } else if (item.status === 'done' && item.result) {
        statusBadge = `<span class="status-badge success"><i class="fa-solid fa-check"></i> Prêt</span>`;
        const tokens = item.result.stats ? item.result.stats.tokens : 0;
        const savingsPct = item.result.savings ? item.result.savings.savingsPercentage : 0;
        tokenBadge = `
          <div class="queue-item-meta">
            <span class="queue-token-tag">${tokens.toLocaleString('fr-FR')} tok</span>
            ${savingsPct > 0 ? `<span class="queue-saving-tag">-${savingsPct}%</span>` : ''}
          </div>
        `;
      } else if (item.status === 'error') {
        statusBadge = `<span class="status-badge error"><i class="fa-solid fa-xmark"></i> Erreur</span>`;
      }

      el.innerHTML = `
        <div class="queue-item-info">
          <i class="fa-solid ${iconClass}"></i>
          <div>
            <div class="queue-item-name" title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</div>
            <div style="display:flex; gap:0.5rem; align-items:center;">
              <span class="queue-item-size">${formatFileSize(item.file.size)}</span>
              ${tokenBadge}
            </div>
          </div>
        </div>
        <div class="queue-item-actions">
          ${statusBadge}
          ${item.status === 'pending' ? `<button class="btn btn-ghost btn-sm btn-convert-single" data-id="${item.id}" title="Traiter"><i class="fa-solid fa-play"></i></button>` : ''}
          ${item.status === 'done' ? `<button class="btn btn-ghost btn-sm btn-view-single" data-id="${item.id}" title="Voir"><i class="fa-solid fa-eye"></i></button>` : ''}
          <button class="btn btn-ghost btn-sm btn-remove-single" data-id="${item.id}" title="Supprimer"><i class="fa-solid fa-xmark"></i></button>
        </div>
      `;

      queueList.appendChild(el);
    });

    // Attach Action Listeners
    document.querySelectorAll('.btn-convert-single').forEach(b => {
      b.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        const item = state.queue.find(q => q.id === id);
        if (item) convertQueueItem(item);
      });
    });

    document.querySelectorAll('.btn-view-single').forEach(b => {
      b.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        const item = state.queue.find(q => q.id === id);
        if (item && item.result) loadConvertedResult(item);
      });
    });

    document.querySelectorAll('.btn-remove-single').forEach(b => {
      b.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        state.queue = state.queue.filter(q => q.id !== id);
        state.convertedFiles = state.convertedFiles.filter(f => f.id !== id);
        renderQueue();
        refreshLlmsTxtPreview();
      });
    });
  }

  // --- Queue Actions ---
  btnClearQueue.addEventListener('click', () => {
    state.queue = [];
    state.convertedFiles = [];
    renderQueue();
    refreshLlmsTxtPreview();
    showToast('Liste vidée', 'info');
  });

  btnConvertAll.addEventListener('click', async () => {
    const pendingItems = state.queue.filter(q => q.status === 'pending');
    if (pendingItems.length === 0) {
      showToast('Aucun document en attente.', 'info');
      return;
    }

    for (const item of pendingItems) {
      await convertQueueItem(item);
    }
    showToast('Tous les documents ont été traités !', 'success');
  });

  // --- Single Document Conversion API Call ---
  async function convertQueueItem(item) {
    item.status = 'converting';
    renderQueue();

    const options = getConversionOptions();
    const formData = new FormData();
    formData.append('file', item.file);
    formData.append('level', options.level);
    formData.append('injectFrontmatter', options.injectFrontmatter);
    formData.append('includeRag', options.includeRag);
    formData.append('chunkMaxTokens', options.chunkMaxTokens);

    try {
      const response = await fetch('/api/convert', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Échec de la conversion');
      }

      item.status = 'done';
      item.result = data.result;

      // Update convertedFiles list for KB compilation
      const existingIdx = state.convertedFiles.findIndex(f => f.id === item.id);
      const fileEntry = {
        id: item.id,
        filename: data.result.outputFilename,
        markdown: data.result.markdown,
        title: data.result.meta ? data.result.meta.title : item.file.name,
        description: data.result.meta ? data.result.meta.description : '',
        result: data.result
      };

      if (existingIdx >= 0) {
        state.convertedFiles[existingIdx] = fileEntry;
      } else {
        state.convertedFiles.push(fileEntry);
      }

      renderQueue();
      loadConvertedResult(item);
      refreshLlmsTxtPreview();
      showToast(`Optimisé : ${item.file.name}`, 'success');

    } catch (err) {
      console.error(err);
      item.status = 'error';
      renderQueue();
      showToast(`Erreur sur ${item.file.name}: ${err.message}`, 'error');
    }
  }

  // --- Load Result into Studio Workspace ---
  function loadConvertedResult(item) {
    state.activeFileId = item.id;
    state.currentMarkdown = item.result.markdown;
    state.originalRawMarkdown = item.result.rawMarkdown || item.result.markdown;
    state.currentRagChunks = item.result.rag ? item.result.rag.chunks : [];
    state.currentStats = item.result.stats;
    state.currentSavings = item.result.savings;

    activeFilename.textContent = item.result.outputFilename;
    markdownEditor.value = item.result.markdown;

    // Render HTML & RAG chunks
    renderMarkdownLive(item.result.markdown);
    renderRagChunks(state.currentRagChunks);
    updateStatsDisplay(item.result.stats, item.result.savings);
    renderQueue();
  }

  // --- Live Markdown Rendering ---
  function renderMarkdownLive(markdownText) {
    state.currentMarkdown = markdownText;

    let renderedHtml = '';
    if (md) {
      renderedHtml = md.render(markdownText);
    } else {
      renderedHtml = `<pre>${escapeHtml(markdownText)}</pre>`;
    }

    markdownPreview.innerHTML = renderedHtml || '<div class="empty-state"><p>Aucun contenu</p></div>';
    htmlSourceViewer.value = renderedHtml;
  }

  // Listen to manual typing in editor
  markdownEditor.addEventListener('input', (e) => {
    const text = e.target.value;
    renderMarkdownLive(text);
  });

  // --- Optimize Now Button (Direct on-the-fly Token Optimization) ---
  btnOptimizeNow.addEventListener('click', async () => {
    const currentText = markdownEditor.value;
    if (!currentText.trim()) {
      showToast('Aucun texte à optimiser !', 'info');
      return;
    }

    btnOptimizeNow.disabled = true;
    btnOptimizeNow.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Optimisation...';

    const options = getConversionOptions();

    try {
      const response = await fetch('/api/optimize-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: currentText,
          filename: activeFilename.textContent || 'document.md',
          level: options.level,
          injectFrontmatter: options.injectFrontmatter,
          includeRag: options.includeRag,
          chunkMaxTokens: options.chunkMaxTokens
        })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Erreur lors de l\'optimisation');
      }

      state.currentMarkdown = data.optimizedMarkdown;
      state.currentRagChunks = data.rag ? data.rag.chunks : [];
      state.currentStats = data.stats;
      state.currentSavings = data.savings;

      markdownEditor.value = data.optimizedMarkdown;
      renderMarkdownLive(data.optimizedMarkdown);
      renderRagChunks(state.currentRagChunks);
      updateStatsDisplay(data.stats, data.savings);

      // Update in convertedFiles if exists
      if (state.activeFileId) {
        const item = state.queue.find(q => q.id === state.activeFileId);
        if (item && item.result) {
          item.result.markdown = data.optimizedMarkdown;
          item.result.stats = data.stats;
          item.result.savings = data.savings;
          item.result.rag = data.rag;
        }
        renderQueue();
      }

      refreshLlmsTxtPreview();
      showToast(`Optimisation terminée : ${data.savings.savingsPercentage}% économisés !`, 'success');

    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btnOptimizeNow.disabled = false;
      btnOptimizeNow.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Optimiser Tokens';
    }
  });

  // --- Render RAG Chunks ---
  function renderRagChunks(chunks) {
    badgeRagCount.textContent = chunks.length;
    ragChunkTotal.textContent = chunks.length;

    if (!chunks || chunks.length === 0) {
      ragChunksList.innerHTML = `
        <div class="empty-state">
          <i class="fa-solid fa-cubes"></i>
          <p>Aucun chunk généré. Activez le découpage RAG dans les options.</p>
        </div>
      `;
      return;
    }

    ragChunksList.innerHTML = '';
    chunks.forEach((chunk, index) => {
      const card = document.createElement('div');
      card.className = 'rag-chunk-card';
      card.innerHTML = `
        <div class="rag-chunk-header">
          <div class="rag-breadcrumb">
            <i class="fa-solid fa-folder-tree"></i>
            <span>${escapeHtml(chunk.breadcrumbsStr || chunk.title)}</span>
          </div>
          <span class="rag-token-badge">
            <i class="fa-solid fa-bolt"></i> ${chunk.tokenCount} tokens
          </span>
        </div>
        <div class="rag-chunk-body">${escapeHtml(chunk.content)}</div>
      `;
      ragChunksList.appendChild(card);
    });
  }

  // --- Refresh llms.txt Live Preview ---
  function refreshLlmsTxtPreview() {
    const options = getConversionOptions();
    const docs = state.convertedFiles.map(f => ({
      filename: f.filename,
      markdown: f.markdown,
      title: f.title,
      description: f.description
    }));

    if (docs.length === 0 && state.currentMarkdown) {
      docs.push({
        filename: activeFilename.textContent || 'document.md',
        markdown: state.currentMarkdown,
        title: 'Document Actuel'
      });
    }

    const lines = [
      `# ${options.projectTitle}`,
      '',
      `> Base de connaissances IA structurée et optimisée pour la réduction de tokens.`,
      '',
      '## Documents Disponibles',
      ''
    ];

    docs.forEach(d => {
      lines.push(`- [${d.title || d.filename}](${d.filename}): ${d.description || 'Fichier de référence.'}`);
    });

    lines.push('');
    lines.push('## Ingestion Notes');
    lines.push('- Standard: https://llmstxt.org/ - optimisé pour agents autonomes & RAG.');

    llmsTxtViewer.value = lines.join('\n');
  }

  // --- Update Statistics Display & Costs ---
  function updateStatsDisplay(stats, savings) {
    if (!stats) return;

    const tokens = stats.tokens || stats.cl100kTokens || 0;
    const words = stats.words || 0;
    const chars = stats.chars || 0;
    const headers = stats.headers || 0;
    const density = stats.tokensPerWord || (words > 0 ? (tokens / words).toFixed(2) : 0);
    const readingTime = stats.readingTimeMinutes || Math.ceil(words / 200);

    statTokens.textContent = tokens.toLocaleString('fr-FR');
    statWords.textContent = words.toLocaleString('fr-FR');
    statChars.textContent = chars.toLocaleString('fr-FR');
    statHeaders.textContent = headers.toLocaleString('fr-FR');
    statDensity.textContent = density;
    statReadingTime.textContent = `${readingTime} min`;

    // Header Pill
    pillTokens.textContent = tokens.toLocaleString('fr-FR');

    // Savings banner
    if (savings && savings.savingsPercentage > 0) {
      statSavedPercent.textContent = `-${savings.savingsPercentage}%`;
      statOrigTokens.textContent = (savings.originalTokens || 0).toLocaleString('fr-FR');
      statOptTokens.textContent = (savings.optimizedTokens || 0).toLocaleString('fr-FR');
      statTokensSavedCount.textContent = (savings.tokensSaved || 0).toLocaleString('fr-FR');
      pillSavings.textContent = `-${savings.savingsPercentage}%`;
      pillSavings.classList.remove('hidden');
    } else {
      statSavedPercent.textContent = `0%`;
      statOrigTokens.textContent = tokens.toLocaleString('fr-FR');
      statOptTokens.textContent = tokens.toLocaleString('fr-FR');
      statTokensSavedCount.textContent = '0';
      pillSavings.classList.add('hidden');
    }

    // Estimated API Costs
    if (stats.estimatedCosts) {
      costGpt4o.textContent = `$${stats.estimatedCosts.gpt4o.toFixed(5)}`;
      costClaude.textContent = `$${stats.estimatedCosts.claude35Sonnet.toFixed(5)}`;
      costGemini.textContent = `$${stats.estimatedCosts.gemini15Flash.toFixed(5)}`;
      costGpt4oMini.textContent = `$${stats.estimatedCosts.gpt4oMini.toFixed(5)}`;
    }
  }

  // --- Copy Markdown ---
  btnCopyMd.addEventListener('click', () => {
    const text = markdownEditor.value;
    if (!text) return showToast('Rien à copier', 'info');
    navigator.clipboard.writeText(text).then(() => {
      showToast('Markdown copié !', 'success');
    });
  });

  // --- Copy JSONL Chunks ---
  btnCopyJsonl.addEventListener('click', () => {
    if (!state.currentRagChunks || state.currentRagChunks.length === 0) {
      return showToast('Aucun chunk RAG à copier', 'info');
    }
    const jsonl = state.currentRagChunks.map(c => JSON.stringify(c)).join('\n');
    navigator.clipboard.writeText(jsonl).then(() => {
      showToast('JSONL RAG copié dans le presse-papier !', 'success');
    });
  });

  // --- Copy llms.txt ---
  btnCopyLlmsTxt.addEventListener('click', () => {
    const text = llmsTxtViewer.value;
    if (!text) return showToast('llms.txt vide', 'info');
    navigator.clipboard.writeText(text).then(() => {
      showToast('llms.txt copié !', 'success');
    });
  });

  // --- Download .MD File ---
  btnDownloadMd.addEventListener('click', () => {
    const text = markdownEditor.value;
    if (!text) return showToast('Aucun contenu à télécharger', 'info');

    const name = activeFilename.textContent !== 'Aucun fichier sélectionné' 
      ? activeFilename.textContent 
      : 'document.md';

    downloadBlob(text, name.endsWith('.md') ? name : `${name}.md`, 'text/markdown;charset=utf-8');
    showToast(`Fichier ${name} téléchargé`, 'success');
  });

  // --- Download RAG JSONL ---
  btnDownloadRagJsonl.addEventListener('click', () => {
    if (!state.currentRagChunks || state.currentRagChunks.length === 0) {
      return showToast('Aucun chunk RAG généré', 'info');
    }

    const jsonl = state.currentRagChunks.map(c => JSON.stringify({
      id: c.id,
      doc_id: c.docId,
      doc_title: c.docTitle,
      chunk_index: c.chunkIndex,
      title: c.title,
      breadcrumbs: c.breadcrumbsStr,
      token_count: c.tokenCount,
      text: c.content
    })).join('\n');

    downloadBlob(jsonl, 'rag-chunks.jsonl', 'application/x-ndjson');
    showToast('rag-chunks.jsonl téléchargé', 'success');
  });

  // --- Export Full Knowledge Base ZIP ---
  btnExportKbZip.addEventListener('click', async () => {
    if (state.convertedFiles.length === 0 && !state.currentMarkdown) {
      return showToast('Aucun document prêt pour l\'export Knowledge Base', 'info');
    }

    btnExportKbZip.disabled = true;
    btnExportKbZip.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Génération du Pack KB...';

    const options = getConversionOptions();
    const docs = state.convertedFiles.map(f => ({
      filename: f.filename,
      markdown: f.markdown
    }));

    if (docs.length === 0 && state.currentMarkdown) {
      docs.push({
        filename: activeFilename.textContent || 'document.md',
        markdown: state.currentMarkdown
      });
    }

    try {
      const response = await fetch('/api/generate-knowledge-base', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documents: docs,
          projectTitle: options.projectTitle,
          level: options.level,
          chunkMaxTokens: options.chunkMaxTokens
        })
      });

      if (!response.ok) throw new Error('Échec de la génération du ZIP');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${options.projectTitle.toLowerCase().replace(/[^\w-]/g, '_')}-knowledge-base.zip`;
      a.click();
      URL.revokeObjectURL(url);

      showToast('Pack Base de Connaissances téléchargé avec succès !', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btnExportKbZip.disabled = false;
      btnExportKbZip.innerHTML = '<i class="fa-solid fa-box-archive"></i> Exporter Pack Base de Connaissances (.ZIP)';
    }
  });

  // --- Load Sample File ---
  btnSampleFile.addEventListener('click', () => {
    const sampleDoc = `# 🧠 Architecture & Base de Connaissances IA (RAG & Tokens)

Ce document démontre la puissance de **Doc2KB Studio** pour concevoir des bases de connaissances ultra-performantes destinées aux modèles de langage (LLMs) tels que GPT-4o, Claude 3.5 Sonnet et Gemini 1.5.

## 1. Objectifs Stratégiques

L'intégration de documents d'entreprise dans les contextes LLM présente deux défis majeurs :
- **La saturation de la fenêtre de contexte** et les coûts prohibitifs en tokens.
- **La perte de contexte sémantique** lors d'un découpage arbitraire par nombre de caractères.

## 2. Comparatif des Formats & Économie de Tokens

| Format Source | Problématique Tokens | Solution Doc2KB Studio | Économie Moyenne |
| :--- | :--- | :--- | :---: |
| **DOCX / Word** | Balises XML & styles invisibles | Extraction ATX Markdown pure | ~40% |
| **PDF Numérisé** | En-têtes, pieds de page & césures | Normalisation sémantique | ~35% |
| **Excel / CSV** | Espaces superflus dans les tables | Compactage GFM sans whitespace | ~50% |
| **HTML / Scraping** | Balises navigation & scripts | Pruning des boilerplates | ~65% |

## 3. Norme Standard llms.txt

Doc2KB Studio implémente la spécification officielle proposée par [llmstxt.org](https://llmstxt.org/) :
- Génération automatique de \`llms.txt\` (index synthétique annoté).
- Consolidation dans \`llms-full.txt\` pour ingestion en batch ou context caching.
- Export immédiat en \`rag-chunks.jsonl\` avec breadcrumbs pour bases vectorielles.

\`\`\`javascript
// Exemple d'ingestion directe du chunk dans votre pipeline vectoriel
const chunk = {
  id: "arch_doc_chunk_1",
  breadcrumbs: "Architecture > Objectifs Stratégiques",
  tokens: 142,
  content: "Extrait hautement informatif..."
};
\`\`\`

> *« Réduire les tokens superflus améliore simultanément la précision de l'IA et divise les coûts d'inférence. »*
`;

    activeFilename.textContent = 'Guide_Architecture_IA.md';
    markdownEditor.value = sampleDoc;
    renderMarkdownLive(sampleDoc);

    // Auto-optimize to demonstrate features
    btnOptimizeNow.click();
    showToast('Document de démonstration chargé et analysé !', 'success');
  });

  // --- Utility Functions ---
  function downloadBlob(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'fa-info-circle';
    if (type === 'success') icon = 'fa-circle-check';
    if (type === 'error') icon = 'fa-triangle-exclamation';

    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
});
