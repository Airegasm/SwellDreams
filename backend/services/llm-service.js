/**
 * LLM Service - Supports both Text Completion (KoboldCpp) and Chat Completion (OpenAI-compatible)
 */

const http = require('http');
const https = require('https');
const { extractJsonFromResponse, safeJsonParse } = require('../utils/errors');
const { createLogger, sanitizeForLog } = require('../utils/logger');

const log = createLogger('LLM');

// Track active requests for abort capability
const activeRequests = new Set();

// Cache llama.cpp server capabilities (fetched once from /props)
let llamaCppCapsCache = null;
let llamaCppCapsCacheUrl = null;

// Default sampler settings
const DEFAULT_SETTINGS = {
  llmUrl: '',
  apiType: 'auto',  // 'auto', 'text_completion', 'chat_completion'
  promptTemplate: 'none',  // 'none', 'chatml', 'llama', 'llama3', 'mistral', 'mistral-tekken', 'alpaca', 'vicuna', 'gemma2', 'gemma3', 'jinja'
  maxTokens: 150,
  contextTokens: 8192,
  streaming: false,
  trimIncompleteSentences: true,
  temperature: 0.92,
  topK: 0,
  topP: 0.92,
  typicalP: 1,
  minP: 0.08,
  topA: 0,
  tfs: 1,
  topNsigma: 0,
  repetitionPenalty: 1.05,
  repPenRange: 2048,
  repPenSlope: 1,
  frequencyPenalty: 0.58,
  presencePenalty: 0.2,
  neutralizeSamplers: false,
  samplerOrder: [],
  // KoboldCpp advanced samplers
  dryMultiplier: 0,        // DRY repetition penalty multiplier (0 = disabled)
  dryBase: 1.75,           // DRY base
  dryAllowedLength: 2,     // DRY allowed length
  dryPenaltyLastN: 0,      // DRY penalty range (0 = auto)
  drySequenceBreakers: [], // DRY sequence breakers e.g. ["\n", ":", "\"", "*"]
  xtcThreshold: 0.1,       // XTC threshold
  xtcProbability: 0,       // XTC probability (0 = disabled)
  smoothingFactor: 0,      // Smoothing factor (0 = disabled)
  smoothingCurve: 1,       // Smoothing curve
  // Dynamic Temperature
  dynaTempRange: 0,        // Dynamic temperature range (0 = disabled)
  dynaTempExponent: 1,     // Dynamic temperature exponent
  // Mirostat
  mirostat: 0,             // Mirostat mode (0 = disabled, 1 = Mirostat, 2 = Mirostat 2.0)
  mirostatTau: 5,          // Mirostat target entropy
  mirostatEta: 0.1,        // Mirostat learning rate
  // Author's note injection depth (messages from end of transcript; SillyTavern-style)
  authorNoteDepth: 4,
  // Stop sequences and token control (defaults help prevent role confusion)
  stopSequences: ['\n[Player]:', '\n[Char]:', '\nUser:', '\nAssistant:'],
  bannedTokens: [],        // Banned token strings (KoboldCpp banned_tokens)
  bannedStrings: [],       // KoboldCpp anti-slop literal phrases (generation backtracks)
  logitBias: [],           // Array of [tokenId, bias] pairs (per-token steering / hard bans)
  grammar: '',             // GBNF grammar string (empty = disabled)
  // Generation / tokenization controls (NOT samplers — sent even when overrideSamplers is off)
  overrideSamplers: true,  // false = send only prompt/limits/stop/EOS, letting the server's launched profile govern samplers (e.g. llama-server / LlamaHerder)
  banEosToken: false,      // true = forbid the model's EOS token so it runs to max/stop. Kobold use_default_badwordsids / llama.cpp ignore_eos
  skipSpecialTokens: true, // strip special tokens from returned text (KoboldCpp skip_special_tokens)
  addBosToken: true,       // prepend the model BOS token (KoboldCpp add_bos_token)
  seed: -1,                // RNG seed (-1 = random). Kobold sampler_seed / llama.cpp seed
  nKeep: 0                 // llama.cpp: leading prompt tokens to retain on context overflow (0 = none, -1 = all)
};

/**
 * Clamp a maxTokens value to a sane positive integer. NaN / non-numeric /
 * <= 0 values fall back to the setting default (150), guarding against an
 * empty or corrupt setting producing a 0-length (or negative) generation.
 * @param {*} value - Raw maxTokens setting
 * @returns {number}
 */
function clampMaxTokens(value) {
  const fallback = DEFAULT_SETTINGS.maxTokens || 150;
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

/**
 * Detect API type from URL or use explicit setting
 * @param {string} url - LLM endpoint URL
 * @param {string} explicitType - Explicit API type ('auto', 'text_completion', 'chat_completion')
 * @returns {'chat_completion' | 'text_completion'}
 */
function detectApiType(url, explicitType = 'auto') {
  // If explicit type is set (not auto), use it
  if (explicitType && explicitType !== 'auto') {
    return explicitType;
  }

  // Auto-detect from URL
  if (!url) return 'text_completion';
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('/chat/completions') ||
      lowerUrl.includes('/v1/chat') ||
      lowerUrl.includes('openai') ||
      lowerUrl.includes('/api/v1/chat')) {
    return 'chat_completion';
  }
  return 'text_completion';
}

/**
 * Wrap prompt with instruct template tokens
 * @param {string} systemPrompt - System/instruction prompt
 * @param {string} prompt - User prompt / conversation
 * @param {string} template - Template type
 * @returns {string} - Wrapped prompt for text completion
 */
function wrapWithTemplate(systemPrompt, prompt, template) {
  if (!template || template === 'none') {
    // No wrapping - combine system + prompt directly
    return systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
  }

  switch (template) {
    case 'chatml':
      // ChatML format: <|im_start|>role\ncontent<|im_end|>
      let chatml = '';
      if (systemPrompt) {
        chatml += `<|im_start|>system\n${systemPrompt}<|im_end|>\n`;
      }
      chatml += `<|im_start|>user\n${prompt}<|im_end|>\n`;
      chatml += `<|im_start|>assistant\n`;
      return chatml;

    case 'llama':
      // Llama/Mistral format: [INST] content [/INST]
      let llama = '';
      if (systemPrompt) {
        llama += `[INST] <<SYS>>\n${systemPrompt}\n<</SYS>>\n\n${prompt} [/INST]`;
      } else {
        llama += `[INST] ${prompt} [/INST]`;
      }
      return llama;

    case 'mistral':
      // Mistral v0.2+ format (simpler than Llama)
      let mistral = '';
      if (systemPrompt) {
        mistral += `[INST] ${systemPrompt}\n\n${prompt} [/INST]`;
      } else {
        mistral += `[INST] ${prompt} [/INST]`;
      }
      return mistral;

    case 'mistral-tekken':
      // Mistral v7 "Tekken" format: dedicated [SYSTEM_PROMPT] block, no spaces
      // inside [INST]. Used by Mistral Small 3.x and finetunes (e.g. Skyfall).
      // BOS (<s>) is added by the tokenizer server-side, so it is omitted here.
      let tekken = '';
      if (systemPrompt) {
        tekken += `[SYSTEM_PROMPT]${systemPrompt}[/SYSTEM_PROMPT]`;
      }
      tekken += `[INST]${prompt}[/INST]`;
      return tekken;

    case 'alpaca':
      // Alpaca format
      let alpaca = '';
      if (systemPrompt) {
        alpaca += `### Instruction:\n${systemPrompt}\n\n`;
      }
      alpaca += `### Input:\n${prompt}\n\n### Response:\n`;
      return alpaca;

    case 'vicuna':
      // Vicuna format
      let vicuna = '';
      if (systemPrompt) {
        vicuna += `${systemPrompt}\n\n`;
      }
      vicuna += `USER: ${prompt}\nASSISTANT: `;
      return vicuna;

    case 'llama3':
      // Llama 3 Instruct format
      let llama3 = '<|begin_of_text|>';
      if (systemPrompt) {
        llama3 += `<|start_header_id|>system<|end_header_id|>\n\n${systemPrompt}<|eot_id|>`;
      }
      llama3 += `<|start_header_id|>user<|end_header_id|>\n\n${prompt}<|eot_id|>`;
      llama3 += `<|start_header_id|>assistant<|end_header_id|>\n\n`;
      return llama3;

    case 'gemma2':
      // Gemma 2 format — no system role, system prompt prepended to first user turn
      let gemma2 = '<start_of_turn>user\n';
      if (systemPrompt) {
        gemma2 += `${systemPrompt}\n\n`;
      }
      gemma2 += `${prompt}<end_of_turn>\n`;
      gemma2 += `<start_of_turn>model\n`;
      return gemma2;

    case 'gemma3':
      // Gemma 3 format — system role is supported via API but the actual Jinja template
      // prepends system content to the first user turn (no <start_of_turn>system exists).
      // For text completion, use same format as gemma2.
      let gemma3 = '<start_of_turn>user\n';
      if (systemPrompt) {
        gemma3 += `${systemPrompt}\n\n`;
      }
      gemma3 += `${prompt}<end_of_turn>\n`;
      gemma3 += `<start_of_turn>model\n`;
      return gemma3;

    default:
      return systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
  }
}

/**
 * Get template-specific stop tokens that signal end of generation
 */
function getTemplateStopTokens(template) {
  switch (template) {
    case 'gemma2':
    case 'gemma3':
      return ['<end_of_turn>'];
    case 'chatml':
      return ['<|im_end|>'];
    case 'llama3':
      return ['<|eot_id|>'];
    case 'llama':
    case 'mistral':
    case 'mistral-tekken':
      return ['</s>'];
    case 'alpaca':
      return ['### Instruction:', '### Input:'];
    case 'vicuna':
      return ['USER:', '</s>'];
    default:
      return [];
  }
}

/**
 * Convert a [[tokenId, bias], ...] list into KoboldCpp's logit_bias object form
 * ({ "tokenId": bias }). Returns null if there is nothing to send.
 */
function toKoboldLogitBias(logitBias) {
  if (!Array.isArray(logitBias) || logitBias.length === 0) return null;
  const obj = {};
  for (const entry of logitBias) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const id = parseInt(entry[0]);
    const bias = Number(entry[1]);
    if (Number.isNaN(id) || Number.isNaN(bias)) continue;
    obj[id] = bias;
  }
  return Object.keys(obj).length ? obj : null;
}

/**
 * Prepare a stop-sequence list for providers that cap the number of stops
 * (OpenAI / OpenRouter allow at most 4). The first entries of `stopSequences`
 * are the static role-confusion defaults; callers may append context-injected
 * cross-role guards. A naive slice(0, max) would silently drop those injected
 * guards. So we de-duplicate and prioritize the injected (later) stops, then
 * fall back to the leading defaults, before truncating to `max`.
 *
 * @param {string[]} stopSequences - Full ordered list (defaults first, injected last)
 * @param {number} max - Provider maximum (e.g. 4)
 * @returns {string[]}
 */
function capStopSequences(stopSequences, max = 4) {
  const stops = (stopSequences || []).filter(s => typeof s === 'string' && s.length > 0);
  if (stops.length <= max) {
    return [...new Set(stops)];
  }
  const defaults = DEFAULT_SETTINGS.stopSequences || [];
  const defaultSet = new Set(defaults);
  // Injected stops = anything not in the static defaults; keep their order.
  const injected = [];
  const baseDefaults = [];
  for (const s of stops) {
    if (defaultSet.has(s)) baseDefaults.push(s);
    else injected.push(s);
  }
  // Injected guards first, then defaults; de-dupe; truncate to provider max.
  const prioritized = [...new Set([...injected, ...baseDefaults])];
  return prioritized.slice(0, max);
}

/**
 * Normalize a [[tokenId, bias], ...] list for llama.cpp (array of [id, number]).
 * Returns null if there is nothing to send.
 */
function toLlamaLogitBias(logitBias) {
  if (!Array.isArray(logitBias) || logitBias.length === 0) return null;
  const out = [];
  for (const entry of logitBias) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const id = parseInt(entry[0]);
    const bias = Number(entry[1]);
    if (Number.isNaN(id) || Number.isNaN(bias)) continue;
    out.push([id, bias]);
  }
  return out.length ? out : null;
}

/**
 * Build request body for KoboldCpp (text completion)
 */
function buildTextCompletionRequest(prompt, settings) {
  const body = {
    prompt: prompt,
    max_length: clampMaxTokens(settings.maxTokens),
    max_context_length: settings.contextTokens
  };

  // --- Generation / tokenization controls (NOT samplers) ---
  // Always sent so they apply even when deferring samplers to the server.
  // EOS control: KoboldCpp historically defaults use_default_badwordsids to
  // true (which BANS EOS and causes run-on replies), so send it explicitly.
  body.use_default_badwordsids = !!settings.banEosToken;
  if (settings.addBosToken !== undefined) body.add_bos_token = settings.addBosToken !== false;
  if (settings.skipSpecialTokens !== undefined) body.skip_special_tokens = settings.skipSpecialTokens !== false;
  if (typeof settings.seed === 'number' && settings.seed >= 0) body.sampler_seed = settings.seed;

  // Stop sequences — merge user-defined + template-specific stop tokens
  const templateStops = getTemplateStopTokens(settings.promptTemplate);
  const userStops = settings.stopSequences || [];
  const allStops = [...new Set([...userStops, ...templateStops])];
  if (allStops.length > 0) {
    body.stop_sequence = allStops;
  }

  // Token / string control
  if (settings.bannedTokens && settings.bannedTokens.length > 0) {
    body.banned_tokens = settings.bannedTokens;
  }
  if (settings.bannedStrings && settings.bannedStrings.length > 0) {
    body.banned_strings = settings.bannedStrings; // KoboldCpp anti-slop
  }
  const koboldLogitBias = toKoboldLogitBias(settings.logitBias);
  if (koboldLogitBias) body.logit_bias = koboldLogitBias;

  // Grammar (GBNF)
  if (settings.grammar && settings.grammar.trim()) {
    body.grammar = settings.grammar.trim();
  }

  // --- Samplers ---
  // Skipped entirely when overrideSamplers is false, so the server's launched
  // sampler profile governs (useful for llama.cpp/KoboldCpp configured upstream).
  if (settings.overrideSamplers !== false) {
    body.temperature = settings.temperature;
    body.top_p = settings.topP;
    body.top_k = settings.topK;
    body.typical = settings.typicalP;
    body.min_p = settings.minP;
    body.tfs = settings.tfs;
    body.top_a = settings.topA;
    body.rep_pen = settings.repetitionPenalty;
    body.rep_pen_range = settings.repPenRange;
    body.rep_pen_slope = settings.repPenSlope;
    body.presence_penalty = settings.presencePenalty;
    body.frequency_penalty = settings.frequencyPenalty;

    // Top N-Sigma (KoboldCpp field: nsigma)
    if (settings.topNsigma && settings.topNsigma > 0) {
      body.nsigma = settings.topNsigma;
    }

    // Sampler order
    if (settings.samplerOrder && settings.samplerOrder.length > 0) {
      body.sampler_order = settings.samplerOrder;
    }

    // DRY repetition penalty
    if (settings.dryMultiplier && settings.dryMultiplier > 0) {
      body.dry_multiplier = settings.dryMultiplier;
      body.dry_base = settings.dryBase || 1.75;
      body.dry_allowed_length = settings.dryAllowedLength || 2;
      body.dry_penalty_last_n = settings.dryPenaltyLastN || 0;
      if (settings.drySequenceBreakers && settings.drySequenceBreakers.length > 0) {
        body.dry_sequence_breakers = settings.drySequenceBreakers;
      }
    }

    // XTC (Exclude Top Choices)
    if (settings.xtcProbability && settings.xtcProbability > 0) {
      body.xtc_threshold = settings.xtcThreshold || 0.1;
      body.xtc_probability = settings.xtcProbability;
    }

    // Smoothing
    if (settings.smoothingFactor && settings.smoothingFactor > 0) {
      body.smoothing_factor = settings.smoothingFactor;
      body.smoothing_curve = settings.smoothingCurve || 1;
    }

    // Dynamic Temperature
    if (settings.dynaTempRange && settings.dynaTempRange > 0) {
      body.dynatemp_range = settings.dynaTempRange;
      body.dynatemp_exponent = settings.dynaTempExponent || 1;
    }

    // Mirostat
    if (settings.mirostat && settings.mirostat > 0) {
      body.mirostat = settings.mirostat;
      body.mirostat_tau = settings.mirostatTau || 5;
      body.mirostat_eta = settings.mirostatEta || 0.1;
    }

    // Neutralize samplers if requested
    if (settings.neutralizeSamplers) {
      body.temperature = 1;
      body.top_p = 1;
      body.top_k = 0;
      body.typical = 1;
      body.min_p = 0;
      body.tfs = 1;
      body.top_a = 0;
      body.rep_pen = 1;
      body.nsigma = 0;
      body.presence_penalty = 0;
      body.frequency_penalty = 0;
      delete body.dry_multiplier;
      delete body.xtc_probability;
      delete body.smoothing_factor;
    }
  }

  return body;
}

/**
 * Build request body for OpenAI-compatible (chat completion)
 */
function buildChatCompletionRequest(messages, settings) {
  const body = {
    model: settings.model || 'default',
    messages: messages,
    max_tokens: clampMaxTokens(settings.maxTokens),
    temperature: settings.temperature,
    top_p: settings.topP,
    frequency_penalty: settings.frequencyPenalty,
    presence_penalty: settings.presencePenalty
  };

  // Some OpenAI-compatible APIs support additional params
  if (settings.topK > 0) {
    body.top_k = settings.topK;
  }

  // Stop sequences (OpenAI uses 'stop' parameter)
  if (settings.stopSequences && settings.stopSequences.length > 0) {
    // OpenAI allows up to 4 stop sequences — prioritize injected cross-role
    // guards over the static defaults before truncating.
    body.stop = capStopSequences(settings.stopSequences, 4);
  }

  // Neutralize samplers if requested
  if (settings.neutralizeSamplers) {
    body.temperature = 1;
    body.top_p = 1;
    body.frequency_penalty = 0;
    body.presence_penalty = 0;
  }

  return body;
}

/**
 * Make HTTP/HTTPS request to LLM endpoint
 */
function makeRequest(url, bodyOrMethod = 'POST', method = null) {
  // Handle both (url, body) and (url, method) signatures
  let body = bodyOrMethod;
  let requestMethod = method || 'POST';

  if (typeof bodyOrMethod === 'string' && bodyOrMethod.toUpperCase() === bodyOrMethod) {
    // bodyOrMethod is actually the method
    requestMethod = bodyOrMethod;
    body = null;
  }

  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: requestMethod,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: 120000 // 2 minute timeout
      };

      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          activeRequests.delete(req);
          let parsed = null;
          try {
            parsed = JSON.parse(data);
          } catch (e) {
            // Non-2xx with an unparseable body: surface the status + raw preview
            if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
              reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
              return;
            }
            reject(new Error(`Failed to parse response: ${data.substring(0, 200)}`));
            return;
          }
          // Reject on non-2xx, preferring the provider's parsed error message
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            const providerMsg = parsed && parsed.error
              ? (parsed.error.message || (typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error)))
              : null;
            reject(new Error(providerMsg || `HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
            return;
          }
          resolve(parsed);
        });
      });

      // Track this request
      activeRequests.add(req);

      req.on('error', (e) => {
        activeRequests.delete(req);
        reject(e);
      });
      req.on('timeout', () => {
        activeRequests.delete(req);
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Make streaming HTTP/HTTPS request to LLM endpoint (SSE)
 * @param {string} url - Endpoint URL
 * @param {Object} body - Request body
 * @param {Function} onToken - Callback for each token received
 * @returns {Promise<string>} - Complete generated text
 */
function makeStreamingRequest(url, body, onToken) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        timeout: 300000 // 5 minute timeout for streaming
      };

      let aborted = false;
      let fullText = '';

      const req = client.request(options, (res) => {
        let buffer = '';

        res.on('data', chunk => {
          buffer += chunk.toString();

          // Process complete SSE events
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith('data:')) {
              const jsonStr = line.slice(5).trim();
              if (jsonStr && jsonStr !== '[DONE]') {
                try {
                  const data = JSON.parse(jsonStr);
                  // KoboldCpp format: { token: "..." }
                  if (data.token !== undefined) {
                    fullText += data.token;
                    if (onToken) onToken(data.token, fullText);
                  }
                  // OpenAI format: { choices: [{ delta: { content: "..." } }] }
                  else if (data.choices && data.choices[0]?.delta?.content) {
                    const token = data.choices[0].delta.content;
                    fullText += token;
                    if (onToken) onToken(token, fullText);
                  }
                  // llama.cpp native format: { content: "...", stop: false }
                  else if (data.content !== undefined && data.stop !== undefined) {
                    fullText += data.content;
                    if (onToken) onToken(data.content, fullText);
                  }
                } catch (e) {
                  // Skip malformed JSON
                }
              }
            }
          }
        });

        res.on('end', () => {
          activeRequests.delete(req);
          resolve(fullText);
        });
      });

      activeRequests.add(req);

      req.on('error', (e) => {
        activeRequests.delete(req);
        // Intentional aborts (e.g. emergency stop via req.destroy) surface as
        // ECONNRESET / ERR_STREAM_PREMATURE_CLOSE. Resolve with whatever text we
        // accumulated rather than discarding the partial generation.
        const isAbort = aborted || req._swellAborted;
        const isResetWithText = (e.code === 'ECONNRESET' || e.code === 'ERR_STREAM_PREMATURE_CLOSE') && fullText.length > 0;
        if (isAbort || isResetWithText) {
          // Flagged abort, or a reset after we already received tokens — keep
          // the partial generation instead of throwing it away.
          resolve(fullText);
          return;
        }
        reject(e);
      });
      req.on('timeout', () => {
        activeRequests.delete(req);
        req.destroy();
        reject(new Error('Streaming request timeout'));
      });

      // Mark intentional aborts so the error handler resolves partial text
      req.on('abort', () => { aborted = true; });

      req.write(JSON.stringify(body));
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Trim incomplete sentences from the end of text
 * Valid endings: . ? ! * "
 */
// Strip a trailing incomplete sentence — but NEVER a trailing device-control tag like [pump on].
// The tag is intentionally the final line with no sentence punctuation, so the raw sentence-trim
// would delete it before the device parser ever sees it. Peel it off, trim the prose, re-attach it
// on its own line. Central to every backend (Horde, llama.cpp, kobold, OpenRouter) — all call this.
function trimIncompleteSentences(text) {
  if (!text || typeof text !== 'string') return text;
  const tagMatch = text.match(/\s*\[\s*pump\b[^\]]*\]\s*$/i);
  if (tagMatch) {
    const tag = tagMatch[0].trim();
    const head = text.slice(0, tagMatch.index);
    if (!head.trim()) return tag;                                  // tag-only output
    return trimSentencesCore(head).replace(/\s+$/, '') + '\n' + tag;
  }
  return trimSentencesCore(text);
}

function trimSentencesCore(text) {
  if (!text || typeof text !== 'string') return text;

  let trimmed = text.trim();

  // Valid endings for roleplay text: . ? ! *
  // Quote " is only valid if preceded by text (closing quote), not if it's an opening quote
  if (/[.?!*]\s*$/.test(trimmed)) {
    return balanceQuotesAndAsterisks(trimmed);
  }
  // Check for closing quote: " preceded by sentence-ending punctuation or word char
  if (/[.?!*\w]"\s*$/.test(trimmed)) {
    return balanceQuotesAndAsterisks(trimmed);
  }

  // Find the last valid ending character
  // For quotes, only count them if they appear to be closing quotes (preceded by punctuation or text)
  let lastValidEnd = Math.max(
    trimmed.lastIndexOf('.'),
    trimmed.lastIndexOf('?'),
    trimmed.lastIndexOf('!'),
    trimmed.lastIndexOf('*')
  );

  // Check for closing quotes - find last " that's preceded by punctuation or word
  const quoteMatches = [...trimmed.matchAll(/[.?!*\w]"/g)];
  if (quoteMatches.length > 0) {
    const lastClosingQuote = quoteMatches[quoteMatches.length - 1];
    const quotePos = lastClosingQuote.index + 1; // Position of the " itself
    if (quotePos > lastValidEnd) {
      lastValidEnd = quotePos;
    }
  }

  if (lastValidEnd > 0 && lastValidEnd >= trimmed.length * 0.7) {
    // Only trim if we keep at least 70% of the text
    trimmed = trimmed.substring(0, lastValidEnd + 1).trim();
    return balanceQuotesAndAsterisks(trimmed);
  }

  // Return original if no good trim point
  return balanceQuotesAndAsterisks(trimmed);
}

/**
 * Ensure quotes and asterisks are balanced (even count)
 * Adds closing characters if needed to properly close dialog and actions
 */
function balanceQuotesAndAsterisks(text) {
  if (!text || typeof text !== 'string') return text;

  let result = text;

  // Count double quotes
  const quoteCount = (result.match(/"/g) || []).length;
  if (quoteCount % 2 !== 0) {
    // Odd number of quotes - add closing quote
    result += '"';
  }

  // Count asterisks (used for actions like *walks over*)
  const asteriskCount = (result.match(/\*/g) || []).length;
  if (asteriskCount % 2 !== 0) {
    // Odd number of asterisks - add closing asterisk
    result += '*';
  }

  return result;
}

/**
 * Extract generated text from response based on API type
 */
function extractGeneratedText(response, apiType) {
  if (apiType === 'chat_completion') {
    // OpenAI format
    if (response.choices && response.choices[0]) {
      if (response.choices[0].message) {
        return response.choices[0].message.content;
      }
      if (response.choices[0].text) {
        return response.choices[0].text;
      }
    }
  } else {
    // KoboldCpp format
    if (response.results && response.results[0]) {
      return response.results[0].text;
    }
    // Alternative KoboldCpp format
    if (response.content) {
      return response.content;
    }
    // Direct text response
    if (typeof response.text === 'string') {
      return response.text;
    }
  }

  // Before the generic failure, surface a top-level provider error if present
  // (mirrors makeOpenRouterRequest's error handling).
  if (response && response.error) {
    const msg = response.error.message
      || (typeof response.error === 'string' ? response.error : JSON.stringify(response.error));
    throw new Error(msg || 'LLM provider returned an error');
  }

  throw new Error('Could not extract generated text from response');
}

/**
 * Main LLM generation function
 * @param {Object} options
 * @param {string} options.prompt - For text completion mode
 * @param {Array} options.messages - For chat completion mode [{role, content}]
 * @param {string} options.systemPrompt - System prompt (used in chat mode)
 * @param {Object} options.settings - Sampler settings
 * @returns {Promise<{text: string, apiType: string}>}
 */
async function generate(options) {
  const { prompt, messages, systemPrompt, settings = {} } = options;
  const mergedSettings = { ...DEFAULT_SETTINGS, ...settings };

  // Check if using OpenRouter
  if (mergedSettings.endpointStandard === 'openrouter') {
    if (!mergedSettings.openRouterApiKey) {
      throw new Error('OpenRouter API key not configured');
    }
    return generateOpenRouter({ prompt, messages, systemPrompt, settings: mergedSettings });
  }

  // Check if using AI Horde
  if (mergedSettings.endpointStandard === 'aihorde') {
    return generateHorde({ prompt, messages, systemPrompt, settings: mergedSettings });
  }

  // Check if using llama.cpp native
  if (mergedSettings.endpointStandard === 'llamacpp') {
    return generateLlamaCpp({ prompt, messages, systemPrompt, settings: mergedSettings });
  }

  if (!mergedSettings.llmUrl) {
    throw new Error('LLM URL not configured');
  }

  const apiType = detectApiType(mergedSettings.llmUrl, mergedSettings.apiType);
  let requestBody;
  let endpoint = mergedSettings.llmUrl;

  if (apiType === 'chat_completion') {
    // Build messages array, handling models without system role support
    const chatMessages = buildChatMessages(systemPrompt, prompt, messages, mergedSettings);

    requestBody = buildChatCompletionRequest(chatMessages, mergedSettings);

    // Append the OpenAI-compatible chat path if the URL is bare (mirrors the streaming path).
    // Without this, a non-streaming chat request POSTs to the raw llmUrl and misses the route.
    if (!endpoint.includes('/chat/completions')) {
      endpoint = endpoint.replace(/\/?$/, '/v1/chat/completions');
    }
  } else {
    // Text completion - apply template wrapping
    let userPrompt = prompt || '';

    if (!userPrompt && messages && messages.length > 0) {
      // Convert messages to text format
      userPrompt = messages.map(m => {
        if (m.role === 'system') return m.content;
        if (m.role === 'user') return `User: ${m.content}`;
        if (m.role === 'assistant') return `Assistant: ${m.content}`;
        return m.content;
      }).join('\n');
    }

    // Apply instruct template wrapping
    const fullPrompt = wrapWithTemplate(systemPrompt, userPrompt, mergedSettings.promptTemplate);

    requestBody = buildTextCompletionRequest(fullPrompt, mergedSettings);

    // Ensure we're hitting the generate endpoint for KoboldCpp
    if (!endpoint.includes('/generate') && !endpoint.includes('/completions')) {
      endpoint = endpoint.replace(/\/?$/, '/api/v1/generate');
    }
  }

  log.info(`Making ${apiType} request to ${endpoint}`);
  log.debug('Request size:', sanitizeForLog(requestBody.prompt || requestBody.messages));

  const response = await makeRequest(endpoint, requestBody);
  log.debug('Response received:', sanitizeForLog(response));

  let generatedText = extractGeneratedText(response, apiType);
  log.debug('Extracted text length:', generatedText ? generatedText.length : 0);

  // Apply sentence trimming if enabled
  if (mergedSettings.trimIncompleteSentences) {
    const beforeTrim = generatedText;
    generatedText = trimIncompleteSentences(generatedText);
    if (beforeTrim !== generatedText) {
      log.debug('Trimmed incomplete sentence. New length:', generatedText.length);
    }
  }

  return {
    text: generatedText.trim(),
    apiType: apiType
  };
}

/**
 * Streaming LLM generation function
 * @param {Object} options
 * @param {string} options.prompt - For text completion mode
 * @param {string} options.systemPrompt - System prompt
 * @param {Object} options.settings - Sampler settings
 * @param {Function} options.onToken - Callback for each token: (token, fullText) => void
 * @returns {Promise<{text: string, apiType: string}>}
 */
async function generateStream(options) {
  const { prompt, messages, systemPrompt, settings = {}, onToken, onChunk } = options;
  const mergedSettings = { ...DEFAULT_SETTINGS, ...settings };

  // Callers are inconsistent: some pass onToken(token, fullText), others pass
  // onChunk(chunk). Invoke whichever is provided so live tokens are never dropped.
  const emitToken = (token, fullText) => {
    if (onToken) onToken(token, fullText);
    if (onChunk) onChunk(token, fullText);
  };

  // AI Horde has no streaming API — generate fully, then emit as a single chunk
  // so the streaming UI path still works. (Checked before the llmUrl guard since
  // Horde is keyed, not URL-based.)
  if (mergedSettings.endpointStandard === 'aihorde') {
    const result = await generateHorde({ prompt, messages, systemPrompt, settings: mergedSettings });
    emitToken(result.text, result.text);
    return result;
  }

  if (!mergedSettings.llmUrl) {
    throw new Error('LLM URL not configured');
  }

  // llama.cpp streaming
  if (mergedSettings.endpointStandard === 'llamacpp') {
    const baseUrl = getLlamaCppBaseUrl(mergedSettings.llmUrl);
    let requestBody;
    let endpoint;

    if (useLlamaCppChat(mergedSettings)) {
      // Jinja mode: stream via /v1/chat/completions
      let effectiveSettings = mergedSettings;
      if (mergedSettings.supportsSystemRole === undefined) {
        const caps = await getLlamaCppCaps(baseUrl);
        effectiveSettings = { ...mergedSettings, supportsSystemRole: caps.supportsSystemRole };
      }
      const chatMessages = buildChatMessages(systemPrompt, prompt, messages, effectiveSettings);
      requestBody = buildChatCompletionRequest(chatMessages, effectiveSettings);
      requestBody.stream = true;
      endpoint = `${baseUrl}/v1/chat/completions`;
    } else {
      // Text completion mode: stream via /completion
      let userPrompt = prompt || '';
      if (!userPrompt && messages && messages.length > 0) {
        userPrompt = messages.map(m => {
          if (m.role === 'system') return m.content;
          if (m.role === 'user') return `User: ${m.content}`;
          if (m.role === 'assistant') return `Assistant: ${m.content}`;
          return m.content;
        }).join('\n');
      }
      // Resolve template — if 'jinja' or 'none', auto-detect from server
      let template = mergedSettings.promptTemplate;
      if (!template || template === 'none' || template === 'jinja') {
        const caps = await getLlamaCppCaps(baseUrl);
        const tmplLower = (caps.chatTemplate || '').toLowerCase();
        if (tmplLower === 'gemma' || caps.chatTemplate.includes('<start_of_turn>')) {
          template = caps.supportsSystemRole ? 'gemma3' : 'gemma2';
        } else if (tmplLower === 'chatml' || caps.chatTemplate.includes('<|im_start|>')) {
          template = 'chatml';
        } else if (tmplLower === 'llama3' || caps.chatTemplate.includes('<|start_header_id|>')) {
          template = 'llama3';
        } else if (tmplLower === 'llama2') {
          template = 'llama';
        } else if (tmplLower === 'mistral-tekken' || caps.chatTemplate.includes('[SYSTEM_PROMPT]')) {
          template = 'mistral-tekken';
        } else if (tmplLower === 'mistral' || caps.chatTemplate.includes('[INST]')) {
          template = 'mistral';
        } else if (tmplLower) {
          template = 'chatml';
        }
        if (template !== mergedSettings.promptTemplate) {
          console.log(`[LLM] Stream: Resolved template '${mergedSettings.promptTemplate}' → '${template}'`);
        }
      }
      const fullPrompt = wrapWithTemplate(systemPrompt, userPrompt, template);
      requestBody = buildLlamaCppRequest(fullPrompt, { ...mergedSettings, promptTemplate: template });
      requestBody.stream = true;
      endpoint = `${baseUrl}/completion`;
    }

    console.log(`[LLM] Making streaming llama.cpp request to ${endpoint} (template: ${mergedSettings.promptTemplate || 'none'})`);
    console.log(`[LLM] Stop tokens: ${JSON.stringify(requestBody.stop || [])}`);

    let generatedText = await makeStreamingRequest(endpoint, requestBody, emitToken);

    if (mergedSettings.trimIncompleteSentences && generatedText) {
      generatedText = trimIncompleteSentences(generatedText);
    }

    return { text: generatedText?.trim() || '', apiType: 'llamacpp' };
  }

  const apiType = detectApiType(mergedSettings.llmUrl, mergedSettings.apiType);
  let requestBody;
  let endpoint = mergedSettings.llmUrl;

  if (apiType === 'chat_completion') {
    // Build messages array, handling models without system role support
    const chatMessages = buildChatMessages(systemPrompt, prompt, messages, mergedSettings);

    requestBody = buildChatCompletionRequest(chatMessages, mergedSettings);
    requestBody.stream = true;

    if (!endpoint.includes('/chat/completions')) {
      endpoint = endpoint.replace(/\/?$/, '/v1/chat/completions');
    }
  } else {
    // Text completion - apply template wrapping
    const fullPrompt = wrapWithTemplate(systemPrompt, prompt, mergedSettings.promptTemplate);
    requestBody = buildTextCompletionRequest(fullPrompt, mergedSettings);

    // KoboldCpp streaming endpoint
    if (endpoint.includes('/api/v1/generate')) {
      endpoint = endpoint.replace('/api/v1/generate', '/api/extra/generate/stream');
    } else if (!endpoint.includes('/stream')) {
      endpoint = endpoint.replace(/\/?$/, '/api/extra/generate/stream');
    }
  }

  console.log(`[LLM] Making streaming ${apiType} request to ${endpoint}`);

  let generatedText = await makeStreamingRequest(endpoint, requestBody, emitToken);

  // Apply sentence trimming if enabled
  if (mergedSettings.trimIncompleteSentences && generatedText) {
    generatedText = trimIncompleteSentences(generatedText);
  }

  return {
    text: generatedText?.trim() || '',
    apiType: apiType
  };
}

/**
 * Test LLM connection
 */
async function testConnection(settings) {
  try {
    // llama.cpp: use /health and /props endpoints
    if (settings.endpointStandard === 'llamacpp') {
      const baseUrl = settings.llmUrl
        .replace(/\/v1\/chat\/completions.*$/, '')
        .replace(/\/v1\/completions.*$/, '')
        .replace(/\/completion.*$/, '')
        .replace(/\/?$/, '');
      let modelName = null;
      let contextSize = null;
      let chatTemplate = null;
      let supportsSystemRole = true;

      // Health check
      const healthUrl = `${baseUrl}/health`;
      console.log('[LLM] llama.cpp health check:', healthUrl);
      const healthResult = await makeRequest(healthUrl, 'GET');
      if (!healthResult || healthResult.status !== 'ok') {
        return { success: false, error: 'llama.cpp health check failed' };
      }

      // Get model info, context size, and chat template from /props
      try {
        const propsUrl = `${baseUrl}/props`;
        console.log('[LLM] llama.cpp props:', propsUrl);
        const propsResult = await makeRequest(propsUrl, 'GET');
        if (propsResult) {
          // Model name: try model_alias (display name) → model_path basename → legacy fields
          modelName = propsResult.model_alias
            || (propsResult.model_path ? propsResult.model_path.split('/').pop().replace(/\.gguf$/i, '') : null)
            || propsResult.default_generation_settings?.model
            || propsResult.model
            || null;
          contextSize = propsResult.default_generation_settings?.n_ctx
            ?? propsResult.n_ctx
            ?? null;
          if (contextSize) {
            console.log(`[LLM] llama.cpp reported context size: ${contextSize}`);
          }

          // Auto-detect chat template from model props
          const tmpl = propsResult.chat_template || propsResult.chatTemplate || '';
          supportsSystemRole = propsResult.chat_template_caps?.supports_system_role
            ?? inferSystemRoleSupport(tmpl);
          if (tmpl) {
            // Log a short summary, not the whole template (can be thousands of chars of Jinja noise).
            console.log(`[LLM] llama.cpp chat_template detected (${tmpl.length} chars), supports_system_role: ${supportsSystemRole}`);
            const tmplLower = tmpl.toLowerCase();
            if (tmplLower === 'gemma' || tmpl.includes('<start_of_turn>')) {
              chatTemplate = supportsSystemRole ? 'gemma3' : 'gemma2';
            } else if (tmplLower === 'chatml' || tmpl.includes('<|im_start|>')) {
              chatTemplate = 'chatml';
            } else if (tmplLower === 'llama2' || (tmpl.includes('[INST]') && tmpl.includes('<<SYS>>'))) {
              chatTemplate = 'llama';
            } else if (tmplLower === 'llama3' || tmpl.includes('<|start_header_id|>')) {
              chatTemplate = 'llama3';
            } else if (tmplLower === 'mistral-tekken' || tmplLower === 'mistral-v7' || tmpl.includes('[SYSTEM_PROMPT]')) {
              // Mistral v7 "Tekken" templates use a dedicated [SYSTEM_PROMPT] block
              // *and* [INST] — check this before the generic [INST] → mistral case.
              chatTemplate = 'mistral-tekken';
            } else if (tmplLower === 'mistral' || tmplLower === 'mistral-v1' || tmpl.includes('[INST]')) {
              chatTemplate = 'mistral';
            } else if (tmplLower === 'vicuna') {
              chatTemplate = 'vicuna';
            } else if (tmplLower === 'alpaca') {
              chatTemplate = 'alpaca';
            } else {
              chatTemplate = 'chatml'; // safe fallback
            }
            console.log(`[LLM] Auto-detected chat template: ${chatTemplate}`);
          }
        }
      } catch (e) {
        console.log('[LLM] Failed to fetch llama.cpp props:', e.message);
      }

      return {
        success: true,
        response: 'Health OK',
        apiType: 'llamacpp',
        modelName: modelName,
        contextSize: contextSize,
        chatTemplate: chatTemplate,
        supportsSystemRole: supportsSystemRole
      };
    }

    // Try to get model info and context size first
    let modelName = null;
    let contextSize = null;
    const apiType = detectApiType(settings.llmUrl, settings.apiType);

    if (apiType === 'chat_completion') {
      // For OpenAI-compatible, try /v1/models endpoint
      const baseUrl = settings.llmUrl.replace(/\/v1\/chat\/completions.*$/, '');
      try {
        const modelsUrl = `${baseUrl}/v1/models`;
        const modelsResult = await makeRequest(modelsUrl, 'GET');
        if (modelsResult.data && modelsResult.data.length > 0) {
          modelName = modelsResult.data[0].id;
          // Some OpenAI-compatible servers report context length in model info
          if (modelsResult.data[0].context_length) {
            contextSize = modelsResult.data[0].context_length;
          }
        }
      } catch (e) {
        // Models endpoint not available, skip
      }
    } else {
      // For KoboldCpp, try /api/v1/model endpoint
      const baseUrl = settings.llmUrl.replace(/\/api\/v1\/generate.*$/, '');
      try {
        const modelUrl = `${baseUrl}/api/v1/model`;
        console.log('[LLM] Fetching model from:', modelUrl);
        const modelResult = await makeRequest(modelUrl, 'GET');
        console.log('[LLM] Model result:', modelResult);

        // KoboldCpp returns { result: "model_name" }
        if (modelResult && modelResult.result) {
          modelName = modelResult.result;
        }
      } catch (e) {
        console.log('[LLM] Failed to fetch model name:', e.message);
      }

      // KoboldCpp: try to get max context length
      try {
        const ctxUrl = `${baseUrl}/api/extra/true_max_context_length`;
        const ctxResult = await makeRequest(ctxUrl, 'GET');
        if (ctxResult && ctxResult.value) {
          contextSize = ctxResult.value;
          console.log(`[LLM] KoboldCpp reported context size: ${contextSize}`);
        }
      } catch (e) {
        // Endpoint not available, skip
      }
    }

    const result = await generate({
      prompt: 'Say "Connection successful!" and nothing else.',
      settings: { ...settings, maxTokens: 20 }
    });

    return {
      success: true,
      response: result.text,
      apiType: result.apiType,
      modelName: modelName,
      contextSize: contextSize
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Abort all active LLM requests
 * Used for emergency stop
 */
function abortAllRequests() {
  const count = activeRequests.size;
  console.log(`[LLM] Aborting ${count} active request(s)`);
  for (const req of activeRequests) {
    try {
      // Flag as an intentional abort so streaming handlers resolve their
      // accumulated partial text instead of rejecting on ECONNRESET.
      req._swellAborted = true;
      req.destroy();
    } catch (e) {
      console.error('[LLM] Error destroying request:', e.message);
    }
  }
  activeRequests.clear();
  return count;
}

// ============================================
// OpenRouter Support
// ============================================

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1';

// Verbose request/response dumps (bodies, headers, raw payloads) are gated
// behind LOG_LEVEL=DEBUG so secrets and prompts never hit production logs.
const LLM_DEBUG = process.env.LOG_LEVEL === 'DEBUG';

/**
 * Mask an API key for logging — never log the key material itself, only a
 * fixed-length redaction that confirms presence.
 */
function maskKey(key) {
  if (!key || typeof key !== 'string') return '(none)';
  return '***redacted***';
}

/**
 * Fetch available models from OpenRouter
 * @param {string} apiKey - OpenRouter API key
 * @returns {Promise<Array>} - Array of model objects with id, name, pricing, context_length
 */
async function fetchOpenRouterModels(apiKey) {
  console.log('[LLM] Fetching OpenRouter models...');

  return new Promise((resolve, reject) => {
    const url = new URL(`${OPENROUTER_API_URL}/models`);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://swelldreams.app',
        'X-Title': 'SwellDreams'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(parsed.error.message || 'OpenRouter API error'));
            return;
          }
          const models = parsed.data || [];
          console.log(`[LLM] Fetched ${models.length} OpenRouter models`);
          resolve(models);
        } catch (e) {
          reject(new Error('Failed to parse OpenRouter response'));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

/**
 * Build request body for OpenRouter chat completion
 * @param {Array} messages - Chat messages array
 * @param {Object} settings - LLM settings
 * @returns {Object} - Request body
 */
function buildOpenRouterRequest(messages, settings) {
  const body = {
    model: settings.openRouterModel || 'openai/gpt-3.5-turbo',
    messages: messages,
    max_tokens: clampMaxTokens(settings.maxTokens),
    temperature: settings.temperature ?? 0.92,
    top_p: settings.topP ?? 0.92,
    frequency_penalty: settings.frequencyPenalty ?? 0,
    presence_penalty: settings.presencePenalty ?? 0
  };

  // Add optional parameters if set
  if (settings.topK > 0) {
    body.top_k = settings.topK;
  }

  // Stop sequences (OpenRouter uses OpenAI format) — prioritize injected
  // cross-role guards over the static defaults before truncating to 4.
  if (settings.stopSequences && settings.stopSequences.length > 0) {
    body.stop = capStopSequences(settings.stopSequences, 4);
  }

  // OpenRouter streaming requires SSE parsing - disable for now
  // TODO: Implement proper SSE streaming for OpenRouter
  body.stream = false;

  // Neutralize samplers if requested
  if (settings.neutralizeSamplers) {
    body.temperature = 1;
    body.top_p = 1;
    body.frequency_penalty = 0;
    body.presence_penalty = 0;
  }

  return body;
}

/**
 * Make a request to OpenRouter API
 * @param {string} endpoint - API endpoint (e.g., '/chat/completions')
 * @param {string} apiKey - OpenRouter API key
 * @param {Object} body - Request body
 * @returns {Promise<Object>} - Response data
 */
function makeOpenRouterRequest(endpoint, apiKey, body) {
  return new Promise((resolve, reject) => {
    // Debug: Check API key
    if (!apiKey) {
      console.error('[OpenRouter DEBUG] API key is missing or undefined!');
      reject(new Error('OpenRouter API key is not configured'));
      return;
    }
    console.log(`[OpenRouter] API key present: ${!!apiKey} (${maskKey(apiKey)})`);

    const url = new URL(`${OPENROUTER_API_URL}${endpoint}`);
    const bodyStr = JSON.stringify(body);

    // Debug: Log request details (gated — may contain prompt content)
    if (LLM_DEBUG) {
      console.log(`[OpenRouter DEBUG] Request URL: ${url.href}`);
      console.log(`[OpenRouter DEBUG] Model: ${body.model || 'NOT SET'}`);
      console.log(`[OpenRouter DEBUG] Messages count: ${body.messages?.length || 0}`);
      console.log(`[OpenRouter DEBUG] Max tokens: ${body.max_tokens || 'default'}`);
    }

    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://swelldreams.app',
        'X-Title': 'SwellDreams'
      }
    };

    log.info(`Making OpenRouter request to ${endpoint}`);

    const req = https.request(options, (res) => {
      let data = '';

      // Debug: Log response status (header/body dumps gated behind DEBUG)
      console.log(`[OpenRouter] Response status: ${res.statusCode} ${res.statusMessage}`);
      if (LLM_DEBUG) {
        console.log(`[OpenRouter DEBUG] Response headers:`, JSON.stringify(res.headers).substring(0, 200));
      }

      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        // Debug: Log raw response (may contain generated content)
        if (LLM_DEBUG) {
          console.log(`[OpenRouter DEBUG] Raw response length: ${data.length} chars`);
          console.log(`[OpenRouter DEBUG] Raw response preview: ${data.substring(0, 500)}`);
        }

        try {
          // Use robust JSON extraction that handles SSE and malformed responses
          const parsed = extractJsonFromResponse(data);

          log.debug('OpenRouter response parsed successfully');

          if (parsed.error) {
            console.error(`[OpenRouter DEBUG] API returned error:`, parsed.error);
            reject(new Error(parsed.error.message || JSON.stringify(parsed.error) || 'OpenRouter API error'));
            return;
          }

          if (LLM_DEBUG) {
            console.log(`[OpenRouter DEBUG] Response parsed successfully, choices: ${parsed.choices?.length || 0}`);
          }
          resolve(parsed);
        } catch (e) {
          log.error('Failed to parse OpenRouter response:', e.message);
          log.debug('Raw response preview:', sanitizeForLog(data, 200));
          console.error(`[OpenRouter] Parse error: ${e.message}`);
          if (LLM_DEBUG) {
            console.error(`[OpenRouter DEBUG] Full raw response: ${data}`);
          }
          reject(new Error(`Failed to parse OpenRouter response: ${e.message}`));
        }
      });
    });

    activeRequests.add(req);
    req.on('close', () => activeRequests.delete(req));
    req.on('error', (err) => {
      console.error(`[OpenRouter] Request error: ${err.message} (code: ${err.code})`);
      if (LLM_DEBUG) console.error(`[OpenRouter DEBUG] Error stack: ${err.stack}`);
      reject(err);
    });
    req.write(bodyStr);
    req.end();
  });
}

/**
 * Generate text using OpenRouter
 * @param {Object} options - Generation options
 * @returns {Promise<{text: string, apiType: string}>}
 */
async function generateOpenRouter(options) {
  const { prompt, messages, systemPrompt, settings } = options;

  if (LLM_DEBUG) {
    console.log('[OpenRouter DEBUG] generateOpenRouter called');
    console.log(`[OpenRouter DEBUG] Has prompt: ${!!prompt}`);
    console.log(`[OpenRouter DEBUG] Has messages: ${!!messages} (${messages?.length || 0})`);
    console.log(`[OpenRouter DEBUG] Has systemPrompt: ${!!systemPrompt}`);
    console.log(`[OpenRouter DEBUG] Settings model: ${settings?.openRouterModel || 'NOT SET'}`);
    console.log(`[OpenRouter DEBUG] Settings API key present: ${!!settings?.openRouterApiKey}`);
  }

  if (!settings?.openRouterApiKey) {
    console.error('[OpenRouter] CRITICAL: No API key in settings!');
    if (LLM_DEBUG) {
      console.error('[OpenRouter DEBUG] Settings object keys:', Object.keys(settings || {}));
    }
    throw new Error('OpenRouter API key not found in settings');
  }

  if (!settings?.openRouterModel) {
    console.error('[OpenRouter DEBUG] WARNING: No model selected, using default');
  }

  // Build messages array — always honor systemPrompt, even when a structured
  // `messages` array is supplied (the builders keep the system prompt separate).
  const chatMessages = buildChatMessages(systemPrompt, prompt, messages, settings);

  if (LLM_DEBUG) console.log(`[OpenRouter DEBUG] Final messages count: ${chatMessages.length}`);

  const body = buildOpenRouterRequest(chatMessages, settings);
  if (LLM_DEBUG) console.log(`[OpenRouter DEBUG] Request body model: ${body.model}`);

  const response = await makeOpenRouterRequest('/chat/completions', settings.openRouterApiKey, body);

  // Extract text from response
  let text = '';
  if (response.choices && response.choices[0]) {
    const message = response.choices[0].message;
    text = message?.content || '';

    // Some models (like DeepSeek R1) return reasoning instead of content
    // Fall back to reasoning if content is empty
    if (!text && message?.reasoning) {
      console.log('[LLM] OpenRouter: Using reasoning field as content (model returned empty content)');
      text = message.reasoning;
    }
  }

  // Strip thinking/reasoning tags from output (common in reasoning models like Qwen, DeepSeek)
  if (text) {
    // Remove <think>...</think> and <thinking>...</thinking> blocks
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
    text = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
    // Clean up any leftover whitespace
    text = text.trim();
  }

  console.log('[LLM] OpenRouter extracted text:', text ? text.substring(0, 200) : '(empty)');

  // Trim incomplete sentences if enabled
  if (settings.trimIncompleteSentences !== false && text) {
    text = trimIncompleteSentences(text);
  }

  return { text, apiType: 'openrouter' };
}

/**
 * Test OpenRouter connection with API key
 * @param {string} apiKey - OpenRouter API key
 * @returns {Promise<{success: boolean, models: Array, error?: string}>}
 */
async function testOpenRouterConnection(apiKey) {
  try {
    const models = await fetchOpenRouterModels(apiKey);
    return { success: true, models };
  } catch (error) {
    console.error('[LLM] OpenRouter connection test failed:', error.message);
    return { success: false, models: [], error: error.message };
  }
}

// ============================================
// AI Horde Support
// ============================================
// AI Horde (aihorde.net) is a crowdsourced inference grid. Text generation is
// ASYNC: submit a job, then poll its status until a volunteer worker finishes.
// It speaks raw text-completion (KoboldAI param names) — not chat — so we flatten
// messages and apply the instruct template, same as the KoboldCpp path.

const HORDE_API_URL = 'https://aihorde.net/api/v2';
const HORDE_CLIENT_AGENT = 'SwellDreams:5.x:https://swelldreams.app';
const HORDE_ANON_KEY = '0000000000';

/**
 * Low-level AI Horde HTTP helper. Resolves { status, body } (body parsed JSON);
 * never throws on non-2xx so callers can branch on status.
 */
function hordeRequest(method, path, apiKey, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${HORDE_API_URL}${path}`);
    const bodyStr = body ? JSON.stringify(body) : null;
    const keyKind = (!apiKey || apiKey === HORDE_ANON_KEY) ? 'anonymous' : 'keyed';
    // Surface the exact upstream URL being hit so connection/generation traffic is
    // visible in the backend log (and whether a request even leaves the machine).
    console.log(`[Horde] → ${method} ${url.href} (${keyKind})`);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'apikey': apiKey || HORDE_ANON_KEY,
        'Client-Agent': HORDE_CLIENT_AGENT
      }
    };
    if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`[Horde] ← ${res.statusCode} ${method} ${url.pathname}`);
        try {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} });
        } catch (e) {
          reject(new Error(`Failed to parse AI Horde response (HTTP ${res.statusCode})`));
        }
      });
    });
    activeRequests.add(req);
    req.on('close', () => activeRequests.delete(req));
    req.on('error', (err) => {
      // A network/DNS/TLS failure means the request never reached Horde — log it
      // explicitly so a blocked egress (firewall, no internet) is obvious.
      console.error(`[Horde] ✗ ${method} ${url.href} failed: ${err.message} (${err.code || 'no code'})`);
      reject(err);
    });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/**
 * Fetch available text models from AI Horde, sorted by worker availability.
 * @returns {Promise<Array>} [{ id, name, count, queued, eta, performance }]
 */
/**
 * Best-effort prompt template inference from an AI Horde model name. Horde does not
 * expose the worker's chat template, but the model name reliably implies its family.
 * Returns one of the app's promptTemplate ids, or null if we can't tell (caller keeps
 * the current template). Order matters — check most-specific families first.
 */
function inferHordeTemplate(name) {
  if (!name || typeof name !== 'string') return null;
  const n = name.toLowerCase();
  // Strip the worker-backend prefix Horde prepends (e.g. "aphrodite/", "koboldcpp/").
  const s = n.includes('/') ? n.slice(n.indexOf('/') + 1) : n;

  if (/gemma[-_ ]?3/.test(s)) return 'gemma3';
  if (/gemma[-_ ]?2/.test(s)) return 'gemma2';
  if (/\bgemma\b/.test(s)) return 'gemma3';
  // Mistral v7 / Tekken-tokenizer models. Cydonia 24B is a Mistral-Small-24B
  // finetune and uses the [SYSTEM_PROMPT] block, unlike the older Cydonia 22B /
  // Nemo finetunes which keep the classic [INST]-only 'mistral' format.
  if (/tekken|mistral[-_ ]?(v?7|small[-_ ]?(3|24b)|2501|2503|2506)|magistral|devstral|cydonia[-_ ]?24b/.test(s)) return 'mistral-tekken';
  // Mistral family + the common Mistral-based RP finetunes
  if (/mistral|mixtral|nemo|cydonia|skyfall|magnum|miqu|codestral|pixtral|rocinante|unslop|patricide|mag[-_ ]?mell|lyra|dolphin[-_ ]?2\.[0-9]/.test(s)) return 'mistral';
  if (/qwen|qwq/.test(s)) return 'chatml';
  if (/llama[-_ ]?3|l3[-_ ]|llama3|hermes[-_ ]?3|hanami|anubis|euryale|nemotron|sao10k|stheno|lumimaid/.test(s)) return 'llama3';
  if (/llama[-_ ]?2|llama2|airoboros|mythomax|xwin/.test(s)) return 'llama';
  if (/vicuna/.test(s)) return 'vicuna';
  if (/alpaca/.test(s)) return 'alpaca';
  if (/chatml|yi[-_ ]|deepseek/.test(s)) return 'chatml';
  return null;
}

async function fetchHordeModels(apiKey) {
  console.log('[LLM] Fetching AI Horde text models...');
  const { status, body } = await hordeRequest('GET', '/status/models?type=text', apiKey);
  if (status !== 200 || !Array.isArray(body)) {
    throw new Error((body && body.message) || `AI Horde returned HTTP ${status}`);
  }
  const models = body
    .filter(m => m && m.name)
    .sort((a, b) => (b.count || 0) - (a.count || 0))
    .map(m => ({
      id: m.name,
      name: m.name,
      count: m.count || 0,
      queued: m.queued || 0,
      eta: m.eta || 0,
      performance: m.performance || 0,
      template: inferHordeTemplate(m.name)  // suggested promptTemplate (may be null)
    }));
  console.log(`[LLM] Fetched ${models.length} AI Horde text models`);
  return models;
}

/**
 * Test an AI Horde key — fetches the model list (always works, even anonymously)
 * and resolves the username for non-anonymous keys.
 */
async function testHordeConnection(apiKey) {
  try {
    const models = await fetchHordeModels(apiKey);
    let username = null;
    if (apiKey && apiKey !== HORDE_ANON_KEY) {
      try {
        const u = await hordeRequest('GET', '/find_user', apiKey);
        if (u.status === 200 && u.body && u.body.username) username = u.body.username;
      } catch (_) { /* key still usable for anonymous-tier gen; non-fatal */ }
    }
    return { success: true, models, username };
  } catch (error) {
    console.error('[LLM] AI Horde connection test failed:', error.message);
    return { success: false, models: [], error: error.message };
  }
}

/**
 * Map internal sampler settings to AI Horde's KoboldAI-style params object.
 */
function buildHordeParams(settings) {
  // AI Horde validates EVERY param against a strict range and rejects the whole
  // request (HTTP 400 "validation failed") if any is out of bounds — including
  // values KoboldCpp / llama.cpp accept happily (max_length < 16, top_k > 100,
  // rep_pen < 1, etc.). Clamp each to Horde's accepted range so a sampler profile
  // borrowed from a local backend can't silently break generation.
  const clamp = (v, lo, hi, dflt) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.min(Math.max(n, lo), hi);
  };

  const params = {
    max_context_length: Math.round(clamp(settings.contextTokens, 80, 32768, 4096)),
    max_length: Math.round(clamp(clampMaxTokens(settings.maxTokens) || 200, 16, 512, 200)),
    n: 1
  };

  if (settings.overrideSamplers !== false) {
    params.temperature = clamp(settings.temperature ?? 0.92, 0, 5, 0.92);
    params.top_p = clamp(settings.topP ?? 0.92, 0.001, 1, 0.92);
    params.top_k = Math.round(clamp(settings.topK ?? 0, 0, 100, 0));
    params.top_a = clamp(settings.topA ?? 0, 0, 1, 0);
    params.typical = clamp(settings.typicalP ?? 1, 0, 1, 1);
    params.tfs = clamp(settings.tfs ?? 1, 0, 1, 1);
    params.min_p = clamp(settings.minP ?? 0, 0, 1, 0);
    params.rep_pen = clamp(settings.repetitionPenalty ?? 1.05, 1, 3, 1.05);
    params.rep_pen_range = Math.round(clamp(settings.repPenRange ?? 1024, 0, 4096, 1024));
    params.rep_pen_slope = clamp(settings.repPenSlope ?? 1, 0, 10, 1);
    if (settings.samplerOrder && settings.samplerOrder.length > 0) {
      params.sampler_order = settings.samplerOrder;
    }
    if (settings.neutralizeSamplers) {
      params.temperature = 1; params.top_p = 1; params.top_k = 0; params.top_a = 0;
      params.typical = 1; params.tfs = 1; params.min_p = 0; params.rep_pen = 1;
    }
  }

  // Stop sequences — merge user-defined + template tokens (KoboldAI naming).
  const templateStops = getTemplateStopTokens(settings.promptTemplate);
  const userStops = settings.stopSequences || [];
  const allStops = [...new Set([...userStops, ...templateStops])];
  if (allStops.length > 0) params.stop_sequence = allStops;

  return params;
}

/**
 * Generate text via AI Horde (submit async job, then poll to completion).
 * @returns {Promise<{text: string, apiType: string}>}
 */
async function generateHorde(options) {
  const { prompt, messages, systemPrompt, settings } = options;
  const apiKey = settings.hordeApiKey || HORDE_ANON_KEY;
  // Entry marker — if you DON'T see this when sending, the request was blocked
  // upstream by the "LLM configured" gate, not by Horde or the network.
  console.log(`[Horde] generateHorde() entered — model="${settings.hordeModel || '(any)'}", key=${apiKey === HORDE_ANON_KEY ? 'anonymous' : 'keyed'}, endpoint=${HORDE_API_URL}`);

  // Flatten chat messages → raw prompt and apply the instruct template.
  let userPrompt = prompt || '';
  if (!userPrompt && messages && messages.length > 0) {
    userPrompt = messages.map(m => {
      if (m.role === 'system') return m.content;
      if (m.role === 'user') return `User: ${m.content}`;
      if (m.role === 'assistant') return `Assistant: ${m.content}`;
      return m.content;
    }).join('\n');
  }
  const fullPrompt = wrapWithTemplate(systemPrompt, userPrompt, settings.promptTemplate);

  const requestBody = {
    prompt: fullPrompt,
    params: buildHordeParams(settings),
    trusted_workers: false
  };
  // Empty/absent models = "any available worker".
  if (settings.hordeModel) requestBody.models = [settings.hordeModel];

  // 1. Submit the async job.
  const submit = await hordeRequest('POST', '/generate/text/async', apiKey, requestBody);
  if (submit.status !== 202 || !submit.body || !submit.body.id) {
    // Horde puts per-field reasons in `errors`; include both so a 400 validation
    // failure names the offending param instead of just "validation failed".
    const parts = [];
    if (submit.body && submit.body.message) parts.push(submit.body.message);
    if (submit.body && submit.body.errors) parts.push(JSON.stringify(submit.body.errors));
    const msg = parts.join(' — ') || `HTTP ${submit.status}`;
    console.error(`[Horde] ✗ generate rejected (HTTP ${submit.status}): ${msg}`);
    console.error(`[Horde] params sent: ${JSON.stringify(requestBody.params)}`);
    throw new Error(`AI Horde request rejected: ${msg}`);
  }
  const jobId = submit.body.id;
  log.info(`[Horde] Submitted text job ${jobId}`);

  // 2. Poll until done / faulted / timeout.
  const POLL_MS = 2000;
  const MAX_MS = (Number(settings.hordeTimeout) || 180) * 1000;
  const started = Date.now();
  let text = '';
  while (true) {
    await new Promise(r => setTimeout(r, POLL_MS));
    const status = await hordeRequest('GET', `/generate/text/status/${jobId}`, apiKey);
    if (status.status === 404) {
      throw new Error('AI Horde job expired or was cancelled');
    } else if (status.status === 200) {
      const s = status.body || {};
      if (s.faulted) throw new Error('AI Horde generation faulted (worker error)');
      if (s.done) {
        const gen = (s.generations && s.generations[0]) || null;
        text = gen ? (gen.text || '') : '';
        if (gen && gen.model) log.info(`[Horde] Job ${jobId} fulfilled by ${gen.model}`);
        break;
      }
    }
    if (Date.now() - started > MAX_MS) {
      try { await hordeRequest('DELETE', `/generate/text/status/${jobId}`, apiKey); } catch (_) {}
      throw new Error(`AI Horde timed out after ${Math.round(MAX_MS / 1000)}s waiting for a worker`);
    }
  }

  // Strip reasoning tags then trim.
  text = (text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .trim();
  if (settings.trimIncompleteSentences !== false && text) {
    text = trimIncompleteSentences(text);
  }

  return { text, apiType: 'aihorde' };
}

// ============================================
// llama.cpp Native Support
// ============================================

/**
 * Build request body for llama.cpp native /completion endpoint
 * Maps internal settings to llama.cpp parameter names
 * @param {string} prompt - The formatted prompt text
 * @param {Object} settings - LLM settings
 * @returns {Object} - Request body for llama.cpp /completion
 */
function buildLlamaCppRequest(prompt, settings) {
  const body = {
    prompt: prompt,
    n_predict: clampMaxTokens(settings.maxTokens),
    cache_prompt: true,
    special: true  // Parse special tokens (e.g. <start_of_turn>) in template-wrapped prompts
  };

  // --- Generation / tokenization controls (NOT samplers) ---
  // EOS control: ignore_eos=true forbids the model's end token (run to limit/stop)
  body.ignore_eos = !!settings.banEosToken;
  if (typeof settings.seed === 'number' && settings.seed >= 0) body.seed = settings.seed;
  if (typeof settings.nKeep === 'number' && (settings.nKeep > 0 || settings.nKeep === -1)) {
    body.n_keep = settings.nKeep; // retain leading prompt tokens (e.g. char card) on overflow
  }

  // Stop sequences — merge user-defined + template-specific stop tokens
  const templateStops = getTemplateStopTokens(settings.promptTemplate);
  const userStops = settings.stopSequences || [];
  const allStops = [...new Set([...userStops, ...templateStops])];
  if (allStops.length > 0) {
    body.stop = allStops;
  }

  // Grammar (GBNF)
  if (settings.grammar && settings.grammar.trim()) {
    body.grammar = settings.grammar.trim();
  }

  // Token bans — llama.cpp uses numeric token IDs via logit_bias (no string bans).
  // Combine the explicit logitBias pairs with any numeric bannedTokens entries.
  const llamaBias = toLlamaLogitBias(settings.logitBias) || [];
  if (Array.isArray(settings.bannedTokens)) {
    for (const t of settings.bannedTokens) {
      if (/^\d+$/.test(String(t).trim())) llamaBias.push([parseInt(t), false]);
    }
  }
  if (llamaBias.length) body.logit_bias = llamaBias;

  // --- Samplers ---
  // Skipped entirely when overrideSamplers is false, so the server's launched
  // sampler profile governs (e.g. llama-server / LlamaHerder configured upstream).
  if (settings.overrideSamplers !== false) {
    body.temperature = settings.temperature ?? 0.92;
    body.top_k = settings.topK ?? 0;
    body.top_p = settings.topP ?? 0.92;
    body.min_p = settings.minP ?? 0.08;
    body.typical_p = settings.typicalP ?? 1;
    body.tfs_z = settings.tfs ?? 1;
    body.top_a = settings.topA ?? 0;
    body.repeat_penalty = settings.repetitionPenalty ?? 1.05;
    body.repeat_last_n = settings.repPenRange ?? 2048;
    body.frequency_penalty = settings.frequencyPenalty ?? 0;
    body.presence_penalty = settings.presencePenalty ?? 0;

    // Top N-Sigma (llama.cpp field: top_n_sigma)
    if (settings.topNsigma && settings.topNsigma > 0) {
      body.top_n_sigma = settings.topNsigma;
    }

    // Mirostat
    if (settings.mirostat && settings.mirostat > 0) {
      body.mirostat = settings.mirostat;
      body.mirostat_tau = settings.mirostatTau || 5;
      body.mirostat_eta = settings.mirostatEta || 0.1;
    }

    // Dynamic Temperature
    if (settings.dynaTempRange && settings.dynaTempRange > 0) {
      body.dynatemp_range = settings.dynaTempRange;
      body.dynatemp_exponent = settings.dynaTempExponent || 1;
    }

    // DRY repetition penalty
    if (settings.dryMultiplier && settings.dryMultiplier > 0) {
      body.dry_multiplier = settings.dryMultiplier;
      body.dry_base = settings.dryBase || 1.75;
      body.dry_allowed_length = settings.dryAllowedLength || 2;
      body.dry_penalty_last_n = settings.dryPenaltyLastN || 0;
      if (settings.drySequenceBreakers && settings.drySequenceBreakers.length > 0) {
        body.dry_sequence_breakers = settings.drySequenceBreakers;
      }
    }

    // XTC (Exclude Top Choices)
    if (settings.xtcProbability && settings.xtcProbability > 0) {
      body.xtc_probability = settings.xtcProbability;
      body.xtc_threshold = settings.xtcThreshold || 0.1;
    }

    // Neutralize samplers if requested
    if (settings.neutralizeSamplers) {
      body.temperature = 1;
      body.top_p = 1;
      body.top_k = 0;
      body.typical_p = 1;
      body.min_p = 0;
      body.tfs_z = 1;
      body.top_a = 0;
      body.top_n_sigma = 0;
      body.repeat_penalty = 1;
      body.frequency_penalty = 0;
      body.presence_penalty = 0;
      delete body.dry_multiplier;
      delete body.xtc_probability;
    }
  }

  return body;
}

/**
 * Check if llama.cpp should use chat completion mode (Jinja server-side templating)
 */
function useLlamaCppChat(settings) {
  // Drive chat-vs-text from the chosen completion type, not just the URL string. detectApiType
  // honors an explicit apiType ('chat_completion' -> /v1/chat/completions so llama.cpp applies the
  // model's native template; 'text_completion' -> /completion with manual wrapping) and only
  // falls back to URL sniffing when apiType is 'auto'. This makes the Model-tab selection actually
  // take effect for llama.cpp instead of requiring the chat path to be hand-typed into the URL.
  return detectApiType(settings.llmUrl, settings.apiType) === 'chat_completion';
}

/**
 * Build chat messages array, handling models that don't support system role
 * (e.g. Gemma 2) by merging system content into the first user message.
 */
function buildChatMessages(systemPrompt, prompt, messages, settings) {
  const supportsSystem = settings.supportsSystemRole === true;
  let chatMessages = [];

  if (systemPrompt) {
    if (supportsSystem) {
      chatMessages.push({ role: 'system', content: systemPrompt });
    } else {
      // Models without system role (e.g. Gemma): send instructions as a user turn
      // with a model acknowledgment, so the model treats them as established context
      chatMessages.push({ role: 'user', content: systemPrompt });
      chatMessages.push({ role: 'assistant', content: 'Understood. I will follow these instructions.' });
    }
  }

  if (messages && messages.length > 0) {
    chatMessages = chatMessages.concat(messages);
  } else if (prompt) {
    chatMessages.push({ role: 'user', content: prompt });
  }

  return chatMessages;
}

/**
 * Get the llama.cpp base URL (strips any endpoint path)
 */
function getLlamaCppBaseUrl(url) {
  return url
    .replace(/\/v1\/chat\/completions.*$/, '')
    .replace(/\/v1\/completions.*$/, '')
    .replace(/\/completion.*$/, '')
    .replace(/\/?$/, '');
}

/**
 * Infer whether a model supports a dedicated system role from its chat
 * template family, used as a fallback when the server's /props does not
 * expose chat_template_caps.supports_system_role. Gemma is the notable
 * family that has NO system role; ChatML / Llama3 / Mistral-v3+ do support it.
 * Defaults to true (the common case) when the template is unknown.
 * @param {string} chatTemplate - Raw chat_template string or family name
 * @returns {boolean}
 */
function inferSystemRoleSupport(chatTemplate) {
  const t = (chatTemplate || '').toLowerCase();
  if (!t) return true; // unknown — assume system role works (most models do)
  // Gemma templates have no system role
  if (t === 'gemma' || t === 'gemma2' || t === 'gemma3' || t.includes('<start_of_turn>')) {
    return false;
  }
  return true;
}

/**
 * Fetch llama.cpp server capabilities from /props (cached per base URL)
 */
async function getLlamaCppCaps(baseUrl) {
  if (llamaCppCapsCache && llamaCppCapsCacheUrl === baseUrl) {
    return llamaCppCapsCache;
  }
  try {
    const propsResult = await makeRequest(`${baseUrl}/props`, 'GET');
    if (propsResult) {
      const tmpl = propsResult.chat_template || propsResult.chatTemplate || '';
      llamaCppCapsCache = {
        // Prefer the server-reported cap; fall back to template-family inference
        // (not a blanket false) when chat_template_caps is absent.
        supportsSystemRole: propsResult.chat_template_caps?.supports_system_role
          ?? inferSystemRoleSupport(tmpl),
        chatTemplate: tmpl,
        modelAlias: propsResult.model_alias || '',
      };
      llamaCppCapsCacheUrl = baseUrl;
      console.log(`[LLM] Cached llama.cpp caps: supportsSystemRole=${llamaCppCapsCache.supportsSystemRole}, template=${llamaCppCapsCache.chatTemplate}`);
      return llamaCppCapsCache;
    }
  } catch (e) {
    console.log(`[LLM] Failed to fetch llama.cpp caps: ${e.message}`);
  }
  // Unknown template — assume system role works (the common case) rather than
  // forcing the system prompt into a user turn for every model.
  return { supportsSystemRole: inferSystemRoleSupport(''), chatTemplate: '', modelAlias: '' };
}

/**
 * Generate text using llama.cpp — routes to /v1/chat/completions (Jinja) or /completion (manual template)
 * @param {Object} options - Generation options
 * @returns {Promise<{text: string, apiType: string}>}
 */
async function generateLlamaCpp(options) {
  const { prompt, messages, systemPrompt, settings } = options;

  if (!settings.llmUrl) {
    throw new Error('llama.cpp URL not configured');
  }

  const baseUrl = getLlamaCppBaseUrl(settings.llmUrl);

  // Jinja mode: use /v1/chat/completions — llama.cpp applies the model's chat template
  if (useLlamaCppChat(settings)) {
    // Auto-detect system role support if not explicitly set
    let effectiveSettings = settings;
    if (settings.supportsSystemRole === undefined) {
      const caps = await getLlamaCppCaps(baseUrl);
      effectiveSettings = { ...settings, supportsSystemRole: caps.supportsSystemRole };
    }
    const chatMessages = buildChatMessages(systemPrompt, prompt, messages, effectiveSettings);

    const requestBody = buildChatCompletionRequest(chatMessages, effectiveSettings);
    const endpoint = `${baseUrl}/v1/chat/completions`;
    log.info(`Making llama.cpp chat request to ${endpoint}`);

    const response = await makeRequest(endpoint, requestBody);
    let text = extractGeneratedText(response, 'chat_completion');

    if (settings.trimIncompleteSentences !== false && text) {
      text = trimIncompleteSentences(text);
    }

    return { text: text?.trim() || '', apiType: 'llamacpp' };
  }

  // Text completion mode: use /completion with manual template wrapping
  let userPrompt = prompt || '';
  if (!userPrompt && messages && messages.length > 0) {
    userPrompt = messages.map(m => {
      if (m.role === 'system') return m.content;
      if (m.role === 'user') return `User: ${m.content}`;
      if (m.role === 'assistant') return `Assistant: ${m.content}`;
      return m.content;
    }).join('\n');
  }

  // Resolve template — if 'jinja' or 'none', auto-detect from server
  let template = settings.promptTemplate;
  if (!template || template === 'none' || template === 'jinja') {
    const caps = await getLlamaCppCaps(baseUrl);
    const tmplLower = (caps.chatTemplate || '').toLowerCase();
    if (tmplLower === 'gemma' || caps.chatTemplate.includes('<start_of_turn>')) {
      template = caps.supportsSystemRole ? 'gemma3' : 'gemma2';
    } else if (tmplLower === 'chatml' || caps.chatTemplate.includes('<|im_start|>')) {
      template = 'chatml';
    } else if (tmplLower === 'llama3' || caps.chatTemplate.includes('<|start_header_id|>')) {
      template = 'llama3';
    } else if (tmplLower === 'llama2') {
      template = 'llama';
    } else if (tmplLower === 'mistral-tekken' || caps.chatTemplate.includes('[SYSTEM_PROMPT]')) {
      template = 'mistral-tekken';
    } else if (tmplLower === 'mistral' || caps.chatTemplate.includes('[INST]')) {
      template = 'mistral';
    } else if (tmplLower) {
      template = 'chatml'; // safe fallback
    }
    if (template !== settings.promptTemplate) {
      console.log(`[LLM] Resolved template '${settings.promptTemplate}' → '${template}' from server props`);
    }
  }

  const fullPrompt = wrapWithTemplate(systemPrompt, userPrompt, template);
  const requestBody = buildLlamaCppRequest(fullPrompt, { ...settings, promptTemplate: template });

  const endpoint = `${baseUrl}/completion`;
  log.info(`Making llama.cpp text request to ${endpoint} (template: ${template || 'none'})`);
  console.log(`[LLM] Stop tokens: ${JSON.stringify(requestBody.stop || [])}`);

  const response = await makeRequest(endpoint, requestBody);

  // llama.cpp returns { content: "generated text", stop: true, ... }
  let text = '';
  if (response.content !== undefined) {
    text = response.content;
  } else {
    throw new Error('Could not extract generated text from llama.cpp response');
  }

  if (settings.trimIncompleteSentences !== false && text) {
    text = trimIncompleteSentences(text);
  }

  return { text: text.trim(), apiType: 'llamacpp' };
}

module.exports = {
  DEFAULT_SETTINGS,
  detectApiType,
  generate,
  generateStream,
  testConnection,
  abortAllRequests,
  // OpenRouter
  OPENROUTER_API_URL,
  fetchOpenRouterModels,
  buildOpenRouterRequest,
  generateOpenRouter,
  testOpenRouterConnection,
  // AI Horde
  HORDE_API_URL,
  fetchHordeModels,
  inferHordeTemplate,
  buildHordeParams,
  generateHorde,
  testHordeConnection,
  // request builders (exported for testing)
  buildTextCompletionRequest,
  // llama.cpp
  buildLlamaCppRequest,
  generateLlamaCpp
};
