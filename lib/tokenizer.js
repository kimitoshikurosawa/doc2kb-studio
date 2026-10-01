const { getEncoding } = require('js-tiktoken');
const { estimateCosts, MODEL_PRICING } = require('./pricing');

// o200k_base is the encoding of every current OpenAI model and the closest public proxy for
// modern LLM tokenizers; cl100k_base is kept for legacy comparisons.
const PRIMARY_ENCODING = 'o200k_base';
const SUPPORTED_ENCODINGS = ['o200k_base', 'cl100k_base'];

const encoders = {};
for (const name of SUPPORTED_ENCODINGS) {
  try {
    encoders[name] = getEncoding(name);
  } catch (e) {
    console.warn(`Warning: Could not initialize ${name} encoder:`, e.message);
  }
}

// js-tiktoken's BPE merge is quadratic in the length of a single pre-tokenized piece: a 10k-char
// run without whitespace ("AAAA..." in base64 images, "=====" rulers, padding) takes ~10 s.
// - runs of one repeated character are counted from a single encoded 32-char block;
// - other long non-whitespace runs are encoded in 128-char segments.
// The count deviation is at most ~1 token per segment, and only on such pathological runs.
const PATHOLOGICAL_RE = /(\S)\1{31,}|\S{256,}/;
const REPEAT_RE = /(\S)\1{31,}/g;
const LONG_RUN_RE = /\S{256,}/g;
const REPEAT_BLOCK = 32;
const SEGMENT_SIZE = 128;

function append(out, tokens) {
  for (const t of tokens) out.push(t); // no spread: avoids call-stack limits on huge arrays
}

function encodeSegmented(enc, text, out) {
  let last = 0;
  for (const m of text.matchAll(LONG_RUN_RE)) {
    if (m.index > last) append(out, enc.encode(text.slice(last, m.index)));
    for (let i = 0; i < m[0].length; i += SEGMENT_SIZE) {
      append(out, enc.encode(m[0].slice(i, i + SEGMENT_SIZE)));
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) append(out, enc.encode(text.slice(last)));
}

function safeEncode(enc, text) {
  if (!PATHOLOGICAL_RE.test(text)) return enc.encode(text);

  const out = [];
  let last = 0;
  for (const m of text.matchAll(REPEAT_RE)) {
    encodeSegmented(enc, text.slice(last, m.index), out);
    const block = enc.encode(m[1].repeat(REPEAT_BLOCK));
    const fullBlocks = Math.floor(m[0].length / REPEAT_BLOCK);
    for (let i = 0; i < fullBlocks; i++) append(out, block);
    const rest = m[0].length % REPEAT_BLOCK;
    if (rest) append(out, enc.encode(m[1].repeat(rest)));
    last = m.index + m[0].length;
  }
  encodeSegmented(enc, text.slice(last), out);
  return out;
}

// BPE encoding is by far the hottest path of the pipeline (optimizer, chunker, llms.txt and stats
// all re-count the same strings). A small LRU cache per encoding removes the redundant work.
const CACHE_LIMIT = 512;
const caches = Object.fromEntries(SUPPORTED_ENCODINGS.map(name => [name, new Map()]));

function cachedCount(encoding, text) {
  const cache = caches[encoding];
  const hit = cache.get(text);
  if (hit !== undefined) {
    // Refresh recency
    cache.delete(text);
    cache.set(text, hit);
    return hit;
  }
  const count = safeEncode(encoders[encoding], text).length;
  cache.set(text, count);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return count;
}

/**
 * Fast and accurate token count for a text string
 * @param {string} text
 * @param {'o200k_base'|'cl100k_base'} [encoding='o200k_base']
 * @returns {number}
 */
function countTokens(text, encoding = PRIMARY_ENCODING) {
  if (!text || typeof text !== 'string') return 0;

  const name = encoders[encoding] ? encoding : Object.keys(encoders)[0];
  if (name) {
    try {
      return cachedCount(name, text);
    } catch {
      // Fallback to heuristic
    }
  }

  // Fallback: rule-of-thumb ~ 1 token ≈ 4 characters in English/French
  return Math.ceil(text.length / 3.8);
}

/**
 * Encode text into token ids (used for hard token-window splitting)
 * @param {string} text
 * @returns {number[]|null} null when no encoder is available
 */
function encode(text) {
  const enc = encoders[PRIMARY_ENCODING];
  return enc ? safeEncode(enc, text) : null;
}

/**
 * @param {number[]} tokens
 * @returns {string}
 */
function decode(tokens) {
  return encoders[PRIMARY_ENCODING].decode(tokens);
}

function countWords(text) {
  return (text || '').trim().split(/\s+/).filter(Boolean).length;
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
      estimatedCosts: estimateCosts(0)
    };
  }

  const o200kTokens = countTokens(text, 'o200k_base');
  const cl100kTokens = countTokens(text, 'cl100k_base');
  const words = countWords(text);

  return {
    tokens: o200kTokens,
    encoding: PRIMARY_ENCODING,
    cl100kTokens,
    o200kTokens,
    words,
    chars: text.length,
    tokensPerWord: words > 0 ? +(o200kTokens / words).toFixed(2) : 0,
    estimatedCosts: estimateCosts(o200kTokens)
  };
}

/**
 * Calculates reduction metrics between original and optimized content
 * @param {string} original
 * @param {string} optimized
 * @returns {object}
 */
function calculateSavings(original, optimized) {
  const origTokens = countTokens(original);
  const optTokens = countTokens(optimized);
  const savedTokens = Math.max(0, origTokens - optTokens);

  return {
    originalTokens: origTokens,
    optimizedTokens: optTokens,
    tokensSaved: savedTokens,
    savingsPercentage: origTokens > 0 ? +((savedTokens / origTokens) * 100).toFixed(1) : 0,
    originalWords: countWords(original),
    optimizedWords: countWords(optimized),
    costSaved: estimateCosts(savedTokens)
  };
}

module.exports = {
  countTokens,
  encode,
  decode,
  analyzeTokens,
  calculateSavings,
  PRIMARY_ENCODING,
  MODEL_PRICING
};
