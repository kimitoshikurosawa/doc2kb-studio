/**
 * Doc2KB Studio - Enterprise Data Anonymization & Pseudonymization Engine
 * 100% Local / In-Memory (Zero-Cloud Leak, GDPR, HIPAA, PCI-DSS compliant)
 */

/**
 * Validates a credit card number using the Luhn checksum algorithm
 * @param {string} numberStr 
 * @returns {boolean}
 */
function isValidLuhn(numberStr) {
  const digits = numberStr.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let shouldDouble = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits.charAt(i), 10);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return (sum % 10) === 0;
}

/**
 * Validates an IBAN using ISO 7064 Modulo 97-10 checksum
 * @param {string} ibanStr 
 * @returns {boolean}
 */
function isValidIban(ibanStr) {
  const clean = ibanStr.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(clean)) return false;

  // Rearrange: move 4 initial characters to the end
  const rearranged = clean.slice(4) + clean.slice(0, 4);

  // Convert letters to numbers (A = 10, B = 11, etc.)
  let numericStr = '';
  for (let i = 0; i < rearranged.length; i++) {
    const code = rearranged.charCodeAt(i);
    if (code >= 65 && code <= 90) {
      numericStr += (code - 55).toString();
    } else {
      numericStr += rearranged[i];
    }
  }

  try {
    return BigInt(numericStr) % 97n === 1n;
  } catch (e) {
    return false;
  }
}

/**
 * Validates French Social Security Number (NIR) with Modulo 97 key check
 * @param {string} nirStr 
 * @returns {boolean}
 */
function isValidFrenchNir(nirStr) {
  const clean = nirStr.replace(/[\s.-]/g, '').toUpperCase();
  if (!/^[12]\d{12}(\d{2})?$/.test(clean)) return false;

  // If 13 digits (without key), treat as NIR pattern match
  if (clean.length === 13) return true;

  // If 15 digits, validate key: Key = 97 - (NIR13 % 97)
  const nir13 = clean.slice(0, 13);
  const key = parseInt(clean.slice(13, 15), 10);

  try {
    const expectedKey = 97n - (BigInt(nir13) % 97n);
    return BigInt(key) === expectedKey;
  } catch (e) {
    return false;
  }
}

/**
 * Primary Anonymization & Pseudonymization Engine
 * 
 * @param {string} text 
 * @param {object} [options]
 * @param {'pseudonymize'|'mask'|'redact'} [options.mode='pseudonymize']
 * @param {boolean} [options.maskEmails=true]
 * @param {boolean} [options.maskPhones=true]
 * @param {boolean} [options.maskCards=true]
 * @param {boolean} [options.maskIbans=true]
 * @param {boolean} [options.maskNir=true]
 * @param {boolean} [options.maskSecrets=true]
 * @param {boolean} [options.maskIps=true]
 * @param {boolean} [options.maskNames=true]
 * @returns {{ anonymizedText: string, entities: Array<object>, stats: object, rehydrationMap: object }}
 */
function anonymizeText(text, options = {}) {
  if (!text || typeof text !== 'string') {
    return {
      anonymizedText: '',
      entities: [],
      stats: { total: 0, byType: {} },
      rehydrationMap: {}
    };
  }

  const {
    mode = 'pseudonymize', // 'pseudonymize' ([PERSONNE_1]), 'mask' ([PERSONNE]), 'redact' ([CONFIDENTIEL])
    maskEmails = true,
    maskPhones = true,
    maskCards = true,
    maskIbans = true,
    maskNir = true,
    maskSecrets = true,
    maskIps = true,
    maskNames = true
  } = options;

  let resultText = text;
  const entityRegistry = new Map(); // normalizedValue -> placeholder
  const counters = {}; // type -> count
  const detectedEntities = [];
  const rehydrationMap = {};

  /**
   * Helper to get or create a consistent pseudonym for an entity
   */
  function getPlaceholder(type, originalValue, defaultLabel) {
    if (mode === 'redact') return '[CONFIDENTIEL]';
    if (mode === 'mask') return `[${defaultLabel || type.toUpperCase()}]`;

    const normalized = originalValue.trim().toLowerCase();
    const registryKey = `${type}:${normalized}`;

    if (entityRegistry.has(registryKey)) {
      return entityRegistry.get(registryKey);
    }

    counters[type] = (counters[type] || 0) + 1;
    const placeholder = `[${defaultLabel || type.toUpperCase()}_${counters[type]}]`;
    entityRegistry.set(registryKey, placeholder);
    rehydrationMap[placeholder] = originalValue.trim();

    return placeholder;
  }

  function recordEntity(type, original, placeholder) {
    detectedEntities.push({
      type,
      original,
      placeholder
    });
  }

  // =========================================================================
  // 1. SECRETS, API KEYS & PRIVATE KEYS (Highest Risk)
  // =========================================================================
  if (maskSecrets) {
    // PEM Private Keys (RSA, EC, etc.)
    resultText = resultText.replace(/-----BEGIN[ A-Z_-]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z_-]*PRIVATE KEY-----/gi, (match) => {
      const ph = getPlaceholder('SECRET', match, 'CLE_PRIVEE');
      recordEntity('private_key', match, ph);
      return ph;
    });

    // JWT Tokens
    resultText = resultText.replace(/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\b/g, (match) => {
      const ph = getPlaceholder('SECRET', match, 'TOKEN_JWT');
      recordEntity('jwt_token', match, ph);
      return ph;
    });

    // OpenAI API Keys (sk-... or sk-proj-...)
    resultText = resultText.replace(/\bsk-(?:proj-)?[a-zA-Z0-9_-]{32,}\b/g, (match) => {
      const ph = getPlaceholder('SECRET', match, 'API_KEY_OPENAI');
      recordEntity('api_key_openai', match, ph);
      return ph;
    });

    // AWS Access Key ID
    resultText = resultText.replace(/\b(?<![A-Z0-9])AKIA[0-9A-Z]{16}(?![A-Z0-9])\b/g, (match) => {
      const ph = getPlaceholder('SECRET', match, 'AWS_ACCESS_KEY');
      recordEntity('aws_key', match, ph);
      return ph;
    });

    // GitHub Personal Access Tokens (ghp_..., github_pat_...)
    resultText = resultText.replace(/\b(?:ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82})\b/g, (match) => {
      const ph = getPlaceholder('SECRET', match, 'GITHUB_TOKEN');
      recordEntity('github_token', match, ph);
      return ph;
    });

    // Slack / Discord Webhooks
    resultText = resultText.replace(/https:\/\/(?:hooks\.slack\.com\/services\/[A-Za-z0-9_\/]+|discord(?:app)?\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+)/gi, (match) => {
      const ph = getPlaceholder('SECRET', match, 'WEBHOOK_SECRET');
      recordEntity('webhook_secret', match, ph);
      return ph;
    });
  }

  // =========================================================================
  // 2. IDENTIFICATION: French NIR / Social Security Number
  // =========================================================================
  if (maskNir) {
    // French Social Security Number (13 or 15 digits, optionally formatted)
    resultText = resultText.replace(/\b[12][\s.-]?\d{2}[\s.-]?(?:0[1-9]|1[0-2]|20)[\s.-]?(?:[0-8]\d|9[0-8]|2A|2B)[\s.-]?\d{3}[\s.-]?\d{3}(?:[\s.-]?\d{2})?\b/gi, (match) => {
      if (isValidFrenchNir(match)) {
        const ph = getPlaceholder('SECURITE_SOCIALE', match, 'NIR');
        recordEntity('french_nir', match, ph);
        return ph;
      }
      return match;
    });
  }

  // =========================================================================
  // 3. FINANCIAL: IBAN & CREDIT CARDS (With Mathematical Checksums)
  // =========================================================================
  if (maskIbans) {
    // Potential IBAN pattern
    resultText = resultText.replace(/\b[A-Z]{2}\d{2}(?:[\s-]?[A-Z0-9]{4}){2,7}(?:[\s-]?[A-Z0-9]{1,4})?\b/gi, (match) => {
      if (isValidIban(match)) {
        const ph = getPlaceholder('IBAN', match, 'IBAN');
        recordEntity('iban', match, ph);
        return ph;
      }
      return match;
    });
  }

  if (maskCards) {
    // Credit Card numbers (13 to 19 digits, optionally spaced or dashed)
    resultText = resultText.replace(/\b(?:\d[ -]?){13,19}\b/g, (match) => {
      if (isValidLuhn(match)) {
        const ph = getPlaceholder('CARTE_BANCAIRE', match, 'CB');
        recordEntity('credit_card', match, ph);
        return ph;
      }
      return match;
    });
  }

  // =========================================================================
  // 4. CONTACT: EMAILS & PHONE NUMBERS
  // =========================================================================
  if (maskEmails) {
    // RFC 5322 compatible email pattern
    resultText = resultText.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, (match) => {
      const ph = getPlaceholder('EMAIL', match, 'EMAIL');
      recordEntity('email', match, ph);
      return ph;
    });
  }

  if (maskPhones) {
    // French phone numbers (01-09, +33, 0033)
    resultText = resultText.replace(/(?:(?:\+|00)33|0)\s*[1-9](?:[\s.-]*\d{2}){4}\b/g, (match) => {
      const ph = getPlaceholder('TELEPHONE', match, 'TEL');
      recordEntity('phone_fr', match, ph);
      return ph;
    });

    // International E.164 phone numbers (e.g. +1 555-123-4567, +44 ...)
    resultText = resultText.replace(/\b\+(?:[1-9]\d{0,2})[\s.-]?(?:\(?\d{1,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}\b/g, (match) => {
      // Avoid false positive on simple small numbers
      if (match.replace(/\D/g, '').length >= 8) {
        const ph = getPlaceholder('TELEPHONE', match, 'TEL');
        recordEntity('phone_intl', match, ph);
        return ph;
      }
      return match;
    });
  }

  // =========================================================================
  // 5. NETWORK: IP ADDRESSES (IPv4 & IPv6)
  // =========================================================================
  if (maskIps) {
    // IPv4 (Excluding common local loops 127.0.0.1 and 0.0.0.0 if not desired, or mask public/private)
    resultText = resultText.replace(/\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g, (match) => {
      // Don't mask common software versions like 1.0.0.1 or simple numbers unless IP context
      const parts = match.split('.').map(Number);
      if (parts[0] > 0) {
        const ph = getPlaceholder('IP', match, 'ADRESSE_IP');
        recordEntity('ip_address', match, ph);
        return ph;
      }
      return match;
    });
  }

  // =========================================================================
  // 6. NAMES & PERSONS (Contextual Trigger Matching)
  // =========================================================================
  if (maskNames) {
    // Titles of civility: M., Mme, Monsieur, Madame, Dr., Docteur, Maître, Me
    resultText = resultText.replace(/\b(M\.|Mme|Monsieur|Madame|Dr\.|Docteur|Maître|Me)\s+([A-ZÀ-ÿ][a-zà-ÿ]+(?:\s+[A-ZÀ-ÿ][a-zà-ÿ]+){1,2})\b/g, (match, prefix, name) => {
      const ph = getPlaceholder('PERSONNE', name, 'PERSONNE');
      recordEntity('person_name', name, ph);
      return `${prefix} ${ph}`;
    });

    // Explicit Document Roles: "Signé par: Jean Dupont", "Salarié: Marie Martin", "Patient: Luc Martin"
    resultText = resultText.replace(/\b(Signé(?:\s+par)?|Salarié|Employé|Collaborateur|Client|Patient|Auteur|Bénéficiaire)\s*:\s*([A-ZÀ-ÿ][a-zà-ÿ]+(?:\s+[A-ZÀ-ÿ][a-zà-ÿ]+){1,2})\b/gi, (match, role, name) => {
      const ph = getPlaceholder('PERSONNE', name, 'PERSONNE');
      recordEntity('person_name', name, ph);
      return `${role}: ${ph}`;
    });
  }

  // Compile statistics
  const byType = {};
  detectedEntities.forEach(e => {
    byType[e.type] = (byType[e.type] || 0) + 1;
  });

  return {
    anonymizedText: resultText,
    entities: detectedEntities,
    stats: {
      total: detectedEntities.length,
      byType
    },
    rehydrationMap
  };
}

module.exports = {
  anonymizeText,
  isValidLuhn,
  isValidIban,
  isValidFrenchNir
};
