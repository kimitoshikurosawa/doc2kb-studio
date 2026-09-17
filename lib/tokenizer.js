const { getEncoding } = require('js-tiktoken');

let cl100kEncoder = null;
let o200kEncoder = null;

try {
  cl100kEncoder = getEncoding('cl100k_base');
} catch (e) {
  console.warn('Warning: Could not initialize cl100k_base encoder:', e.message);
}

try {
  o200kEncoder = getEncoding('o200k_base');
} catch (e) {
  console.warn('Warning: Could not initialize o200k_base encoder:', e.message);
}

// Cost per 1 million input tokens (USD)
const PRICING_PER_MILLION = {
  gpt4o: 2.50,
  gpt4oMini: 0.15,
  claude35Sonnet: 3.00,
  claude35Haiku: 0.80,
  gemini15Pro: 1.25,
  gemini15Flash: 0.075
};

/**
 * Fast and accurate token count for a text string
 * @param {string} text 
 * @param {'cl100k_base'|'o200k_base'} encoding 
 * @returns {number}
 */
function countTokens(text, encoding = 'cl100k_base') {
  if (!text || typeof text !== 'string') return 0;

  try {
    if (encoding === 'o200k_base' && o200kEncoder) {
      return o200kEncoder.encode(text).length;
    }
    if (cl100kEncoder) {
      return cl100kEncoder.encode(text).length;
    }
  } catch (err) {
    // Fallback to heuristic
  }

  // Fallback: rule-of-thumb ~ 1 token ≈ 4 characters (or ~0.75 words) in English/French
  return Math.ceil(text.length / 3.8);
}

/**
 * Detailed token and cost analysis of a text
 * @param {string} text 
 * @returns {object}
 */
function analyzeTokens(text) {
  if (!text || typeof text !== 'string') {
    return {
      tokens: 0,
      cl100kTokens: 0,
      o200kTokens: 0,
      words: 0,
      chars: 0,
      tokensPerWord: 0,
      estimatedCosts: {}
    };
  }

  const cl100kTokens = countTokens(text, 'cl100k_base');
  const o200kTokens = countTokens(text, 'o200k_base');
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const chars = text.length;
  const tokensPerWord = words > 0 ? +(cl100kTokens / words).toFixed(2) : 0;

  const estimatedCosts = {
    gpt4o: +((cl100kTokens / 1_000_000) * PRICING_PER_MILLION.gpt4o).toFixed(6),
    gpt4oMini: +((cl100kTokens / 1_000_000) * PRICING_PER_MILLION.gpt4oMini).toFixed(6),
    claude35Sonnet: +((cl100kTokens / 1_000_000) * PRICING_PER_MILLION.claude35Sonnet).toFixed(6),
    gemini15Flash: +((cl100kTokens / 1_000_000) * PRICING_PER_MILLION.gemini15Flash).toFixed(6)
  };

  return {
    tokens: cl100kTokens,
    cl100kTokens,
    o200kTokens,
    words,
    chars,
    tokensPerWord,
    estimatedCosts
  };
}

/**
 * Calculates reduction metrics between original and optimized content
 * @param {string} original 
 * @param {string} optimized 
 * @returns {object}
 */
function calculateSavings(original, optimized) {
  const origTokens = countTokens(original, 'cl100k_base');
  const optTokens = countTokens(optimized, 'cl100k_base');
  const savedTokens = Math.max(0, origTokens - optTokens);
  const percentage = origTokens > 0 ? +((savedTokens / origTokens) * 100).toFixed(1) : 0;

  const origWords = (original || '').trim().split(/\s+/).filter(Boolean).length;
  const optWords = (optimized || '').trim().split(/\s+/).filter(Boolean).length;

  const costSavedGpt4o = +((savedTokens / 1_000_000) * PRICING_PER_MILLION.gpt4o).toFixed(6);
  const costSavedClaude = +((savedTokens / 1_000_000) * PRICING_PER_MILLION.claude35Sonnet).toFixed(6);

  return {
    originalTokens: origTokens,
    optimizedTokens: optTokens,
    tokensSaved: savedTokens,
    savingsPercentage: percentage,
    originalWords: origWords,
    optimizedWords: optWords,
    costSavedGpt4o,
    costSavedClaude
  };
}

module.exports = {
  countTokens,
  analyzeTokens,
  calculateSavings,
  PRICING_PER_MILLION
};
