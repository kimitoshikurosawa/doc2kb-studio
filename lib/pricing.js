/**
 * LLM input-token pricing catalogue (USD per 1M input tokens).
 *
 * Prices move fast: override the whole catalogue without touching code with
 *   LLM_PRICING_JSON='[{"id":"my-model","label":"My Model","provider":"x","inputPerMillion":1.5}]'
 * or LLM_PRICING_FILE=/path/to/pricing.json (same JSON shape).
 *
 * Costs are computed on o200k_base token counts. Every vendor uses its own tokenizer, so
 * figures for non-OpenAI models are estimates (typically within ±10-30%).
 */
const fs = require('node:fs');

const PRICING_AS_OF = '2026-10-01';

const DEFAULT_MODEL_PRICING = Object.freeze([
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', provider: 'anthropic', inputPerMillion: 4.00 },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', provider: 'anthropic', inputPerMillion: 2.00 },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'anthropic', inputPerMillion: 1.00 },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', provider: 'openai', inputPerMillion: 4.00 },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', provider: 'openai', inputPerMillion: 0.20 },
  { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', provider: 'google', inputPerMillion: 2.00 },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', provider: 'google', inputPerMillion: 1.50 }
]);

function isValidEntry(e) {
  return e && typeof e.id === 'string' && typeof e.label === 'string' &&
    typeof e.inputPerMillion === 'number' && Number.isFinite(e.inputPerMillion) && e.inputPerMillion >= 0;
}

function loadPricing() {
  let raw = process.env.LLM_PRICING_JSON;
  try {
    if (!raw && process.env.LLM_PRICING_FILE) {
      raw = fs.readFileSync(process.env.LLM_PRICING_FILE, 'utf8');
    }
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isValidEntry)) {
        return Object.freeze(parsed.map(e => Object.freeze({ provider: 'custom', ...e })));
      }
      console.warn('[pricing] Invalid custom pricing catalogue, falling back to defaults.');
    }
  } catch (err) {
    console.warn(`[pricing] Could not load custom pricing (${err.message}), falling back to defaults.`);
  }
  return DEFAULT_MODEL_PRICING;
}

const MODEL_PRICING = loadPricing();

/**
 * @param {number} tokens
 * @returns {Record<string, number>} USD cost per model id
 */
function estimateCosts(tokens) {
  const costs = {};
  for (const m of MODEL_PRICING) {
    costs[m.id] = +((tokens / 1_000_000) * m.inputPerMillion).toFixed(6);
  }
  return costs;
}

module.exports = {
  MODEL_PRICING,
  PRICING_AS_OF,
  estimateCosts
};
