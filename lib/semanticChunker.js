const { countTokens } = require('./tokenizer');

/**
 * Splits markdown documents into semantic chunks along heading boundaries (H1, H2, H3),
 * preserving section breadcrumbs and keeping tokens within optimal RAG bounds (e.g. 200 - 800 tokens).
 * 
 * @param {string} markdown 
 * @param {object} options
 * @param {number} [options.maxTokens=600] Maximum tokens per chunk
 * @param {number} [options.minTokens=10] Minimum tokens before considering merging with adjacent section
 * @param {string} [options.docId='doc'] Document identifier
 * @param {string} [options.docTitle=''] Document title
 * @param {boolean} [options.splitOnHeadings=true] Ensure distinct H1/H2 headings form separate chunks
 * @returns {{ chunks: Array<object>, totalChunks: number, totalTokens: number, jsonl: string }}
 */
function chunkMarkdownForRag(markdown, options = {}) {
  const {
    maxTokens = 600,
    minTokens = 10,
    docId = 'doc_' + Math.random().toString(36).substring(2, 8),
    docTitle = 'Document',
    splitOnHeadings = true
  } = options;

  if (!markdown || typeof markdown !== 'string') {
    return { chunks: [], totalChunks: 0, totalTokens: 0, jsonl: '' };
  }

  // Split lines
  const lines = markdown.split(/\r?\n/);
  const sections = [];
  let currentHeadingStack = [];
  let currentSection = {
    title: docTitle,
    breadcrumbs: [docTitle],
    lines: []
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);

    if (headingMatch) {
      // If current section has content, push it
      if (currentSection.lines.length > 0 && currentSection.lines.some(l => l.trim().length > 0)) {
        sections.push({
          ...currentSection,
          content: currentSection.lines.join('\n').trim()
        });
      }

      const level = headingMatch[1].length;
      const headingText = headingMatch[2].trim();

      // Update heading stack for breadcrumbs
      currentHeadingStack = currentHeadingStack.slice(0, level - 1);
      currentHeadingStack[level - 1] = headingText;
      const breadcrumbs = [docTitle, ...currentHeadingStack.filter(Boolean)];

      currentSection = {
        title: headingText,
        breadcrumbs,
        lines: [line]
      };
    } else {
      currentSection.lines.push(line);
    }
  }

  // Push final section
  if (currentSection.lines.length > 0 && currentSection.lines.some(l => l.trim().length > 0)) {
    sections.push({
      ...currentSection,
      content: currentSection.lines.join('\n').trim()
    });
  }

  // If no headings found, treat entire content as 1 section
  if (sections.length === 0 && markdown.trim().length > 0) {
    sections.push({
      title: docTitle,
      breadcrumbs: [docTitle],
      content: markdown.trim()
    });
  }

  // Now process sections into chunks respecting maxTokens and semantic boundaries
  const chunks = [];
  let chunkCounter = 0;

  for (const sec of sections) {
    const secTokens = countTokens(sec.content);

    // If splitOnHeadings is true, keep each heading as its own chunk if it fits maxTokens
    if (secTokens <= maxTokens) {
      // Only merge if section is extremely tiny (< minTokens) and splitOnHeadings is false
      if (!splitOnHeadings && secTokens < minTokens && chunks.length > 0) {
        const prevChunk = chunks[chunks.length - 1];
        const combinedTokens = countTokens(prevChunk.content + '\n\n' + sec.content);
        if (combinedTokens <= maxTokens) {
          prevChunk.content += '\n\n' + sec.content;
          prevChunk.tokenCount = combinedTokens;
          prevChunk.charCount = prevChunk.content.length;
          continue;
        }
      }

      chunkCounter++;
      chunks.push({
        id: `${docId}_chunk_${chunkCounter}`,
        docId,
        docTitle,
        chunkIndex: chunkCounter,
        title: sec.title,
        breadcrumbs: sec.breadcrumbs,
        breadcrumbsStr: sec.breadcrumbs.join(' > '),
        content: sec.content,
        tokenCount: secTokens,
        charCount: sec.content.length
      });
    } else {
      // Split large section exceeding maxTokens by paragraphs
      const paragraphs = sec.content.split(/\r?\n\r?\n/);
      let subLines = [];
      let subIndex = 1;

      for (const p of paragraphs) {
        const potentialContent = [...subLines, p].join('\n\n');
        const pTokens = countTokens(potentialContent);

        if (pTokens > maxTokens && subLines.length > 0) {
          chunkCounter++;
          const contentStr = subLines.join('\n\n').trim();
          chunks.push({
            id: `${docId}_chunk_${chunkCounter}`,
            docId,
            docTitle,
            chunkIndex: chunkCounter,
            title: `${sec.title} (Partie ${subIndex})`,
            breadcrumbs: sec.breadcrumbs,
            breadcrumbsStr: sec.breadcrumbs.join(' > '),
            content: contentStr,
            tokenCount: countTokens(contentStr),
            charCount: contentStr.length
          });
          subIndex++;
          subLines = [p];
        } else {
          subLines.push(p);
        }
      }

      if (subLines.length > 0) {
        chunkCounter++;
        const contentStr = subLines.join('\n\n').trim();
        chunks.push({
          id: `${docId}_chunk_${chunkCounter}`,
          docId,
          docTitle,
          chunkIndex: chunkCounter,
          title: subIndex > 1 ? `${sec.title} (Partie ${subIndex})` : sec.title,
          breadcrumbs: sec.breadcrumbs,
          breadcrumbsStr: sec.breadcrumbs.join(' > '),
          content: contentStr,
          tokenCount: countTokens(contentStr),
          charCount: contentStr.length
        });
      }
    }
  }

  const totalTokens = chunks.reduce((acc, c) => acc + c.tokenCount, 0);

  // Generate JSONL representation for direct ingestion into vector stores
  const jsonl = chunks.map(c => JSON.stringify({
    id: c.id,
    doc_id: c.docId,
    doc_title: c.docTitle,
    chunk_index: c.chunkIndex,
    title: c.title,
    breadcrumbs: c.breadcrumbsStr,
    token_count: c.tokenCount,
    text: c.content
  })).join('\n');

  return {
    chunks,
    totalChunks: chunks.length,
    totalTokens,
    jsonl
  };
}

module.exports = {
  chunkMarkdownForRag
};
