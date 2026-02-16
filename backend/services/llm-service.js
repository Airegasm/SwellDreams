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
  promptTemplate: 'none',  // 'none', 'chatml', 'llama', 'llama3', 'mistral', 'alpaca', 'vicuna', 'gemma2', 'gemma3', 'jinja'
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
  // Stop sequences and token control (defaults help prevent role confusion)
  stopSequences: ['\n[Player]:', '\n[Char]:', '\nUser:', '\nAssistant:'],
  bannedTokens: [],        // Banned token strings
  grammar: ''              // GBNF grammar string (empty = disabled)
};

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
      vicuna += `USER: ${prompt}\nASSISTANT:`;
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
      return ['</s>'];
    default:
      return [];
  }
}

/**
 * Build request body for KoboldCpp (text completion)
 */
function buildTextCompletionRequest(prompt, settings) {
  const body = {
    prompt: prompt,
    max_length: settings.maxTokens,
    max_context_length: settings.contextTokens,
    temperature: settings.temperature,
    top_p: settings.topP,
    top_k: settings.topK,
    typical: settings.typicalP,
    min_p: settings.minP,
    tfs: settings.tfs,
    top_a: settings.topA,
    rep_pen: settings.repetitionPenalty,
    rep_pen_range: settings.repPenRange,
    rep_pen_slope: settings.repPenSlope
  };

  // Add sampler order if specified
  if (settings.samplerOrder && settings.samplerOrder.length > 0) {
    body.sampler_order = settings.samplerOrder;
  }

  // KoboldCpp advanced samplers - DRY repetition penalty
  if (settings.dryMultiplier && settings.dryMultiplier > 0) {
    body.dry_multiplier = settings.dryMultiplier;
    body.dry_base = settings.dryBase || 1.75;
    body.dry_allowed_length = settings.dryAllowedLength || 2;
    body.dry_penalty_last_n = settings.dryPenaltyLastN || 0;
    if (settings.drySequenceBreakers && settings.drySequenceBreakers.length > 0) {
      body.dry_sequence_breakers = settings.drySequenceBreakers;
    }
  }

  // KoboldCpp XTC (Exclude Top Choices)
  if (settings.xtcProbability && settings.xtcProbability > 0) {
    body.xtc_threshold = settings.xtcThreshold || 0.1;
    body.xtc_probability = settings.xtcProbability;
  }

  // KoboldCpp Smoothing
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

  // Stop sequences
  if (settings.stopSequences && settings.stopSequences.length > 0) {
    body.stop_sequence = settings.stopSequences;
  }

  // Banned tokens
  if (settings.bannedTokens && settings.bannedTokens.length > 0) {
    body.banned_tokens = settings.bannedTokens;
  }

  // Grammar (GBNF)
  if (settings.grammar && settings.grammar.trim()) {
    body.grammar = settings.grammar.trim();
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
    // Also disable advanced samplers
    delete body.dry_multiplier;
    delete body.xtc_probability;
    delete body.smoothing_factor;
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
    max_tokens: settings.maxTokens,
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
    // OpenAI allows up to 4 stop sequences
    body.stop = settings.stopSequences.slice(0, 4);
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
          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (e) {
            reject(new Error(`Failed to parse response: ${data.substring(0, 200)}`));
          }
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

      const req = client.request(options, (res) => {
        let fullText = '';
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
        reject(e);
      });
      req.on('timeout', () => {
        activeRequests.delete(req);
        req.destroy();
        reject(new Error('Streaming request timeout'));
      });

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
function trimIncompleteSentences(text) {
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
    // Build messages array
    let chatMessages = [];

    if (systemPrompt) {
      chatMessages.push({ role: 'system', content: systemPrompt });
    }

    if (messages && messages.length > 0) {
      chatMessages = chatMessages.concat(messages);
    } else if (prompt) {
      chatMessages.push({ role: 'user', content: prompt });
    }

    requestBody = buildChatCompletionRequest(chatMessages, mergedSettings);
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
  const { prompt, messages, systemPrompt, settings = {}, onToken } = options;
  const mergedSettings = { ...DEFAULT_SETTINGS, ...settings };

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

    let generatedText = await makeStreamingRequest(endpoint, requestBody, onToken);

    if (mergedSettings.trimIncompleteSentences && generatedText) {
      generatedText = trimIncompleteSentences(generatedText);
    }

    return { text: generatedText?.trim() || '', apiType: 'llamacpp' };
  }

  const apiType = detectApiType(mergedSettings.llmUrl, mergedSettings.apiType);
  let requestBody;
  let endpoint = mergedSettings.llmUrl;

  if (apiType === 'chat_completion') {
    // Build messages array for chat completion
    let chatMessages = [];
    if (systemPrompt) {
      chatMessages.push({ role: 'system', content: systemPrompt });
    }
    if (messages && messages.length > 0) {
      chatMessages = chatMessages.concat(messages);
    } else if (prompt) {
      chatMessages.push({ role: 'user', content: prompt });
    }

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

  let generatedText = await makeStreamingRequest(endpoint, requestBody, onToken);

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
            || null;
          if (contextSize) {
            console.log(`[LLM] llama.cpp reported context size: ${contextSize}`);
          }

          // Auto-detect chat template from model props
          const tmpl = propsResult.chat_template || propsResult.chatTemplate || '';
          supportsSystemRole = propsResult.chat_template_caps?.supports_system_role ?? false;
          if (tmpl) {
            console.log(`[LLM] llama.cpp chat_template: "${tmpl}" (${tmpl.length} chars), supports_system_role: ${supportsSystemRole}`);
            const tmplLower = tmpl.toLowerCase();
            if (tmplLower === 'gemma' || tmpl.includes('<start_of_turn>')) {
              chatTemplate = supportsSystemRole ? 'gemma3' : 'gemma2';
            } else if (tmplLower === 'chatml' || tmpl.includes('<|im_start|>')) {
              chatTemplate = 'chatml';
            } else if (tmplLower === 'llama2' || (tmpl.includes('[INST]') && tmpl.includes('<<SYS>>'))) {
              chatTemplate = 'llama';
            } else if (tmplLower === 'llama3' || tmpl.includes('<|start_header_id|>')) {
              chatTemplate = 'llama3';
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
    max_tokens: settings.maxTokens || 150,
    temperature: settings.temperature ?? 0.92,
    top_p: settings.topP ?? 0.92,
    frequency_penalty: settings.frequencyPenalty ?? 0,
    presence_penalty: settings.presencePenalty ?? 0
  };

  // Add optional parameters if set
  if (settings.topK > 0) {
    body.top_k = settings.topK;
  }

  // Stop sequences (OpenRouter uses OpenAI format)
  if (settings.stopSequences && settings.stopSequences.length > 0) {
    body.stop = settings.stopSequences.slice(0, 4);
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
    console.log(`[OpenRouter DEBUG] API key present: ${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 4)}`);

    const url = new URL(`${OPENROUTER_API_URL}${endpoint}`);
    const bodyStr = JSON.stringify(body);

    // Debug: Log request details
    console.log(`[OpenRouter DEBUG] Request URL: ${url.href}`);
    console.log(`[OpenRouter DEBUG] Model: ${body.model || 'NOT SET'}`);
    console.log(`[OpenRouter DEBUG] Messages count: ${body.messages?.length || 0}`);
    console.log(`[OpenRouter DEBUG] Max tokens: ${body.max_tokens || 'default'}`);

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

      // Debug: Log response status
      console.log(`[OpenRouter DEBUG] Response status: ${res.statusCode} ${res.statusMessage}`);
      console.log(`[OpenRouter DEBUG] Response headers:`, JSON.stringify(res.headers).substring(0, 200));

      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        // Debug: Log raw response
        console.log(`[OpenRouter DEBUG] Raw response length: ${data.length} chars`);
        console.log(`[OpenRouter DEBUG] Raw response preview: ${data.substring(0, 500)}`);

        try {
          // Use robust JSON extraction that handles SSE and malformed responses
          const parsed = extractJsonFromResponse(data);

          log.debug('OpenRouter response parsed successfully');

          if (parsed.error) {
            console.error(`[OpenRouter DEBUG] API returned error:`, parsed.error);
            reject(new Error(parsed.error.message || JSON.stringify(parsed.error) || 'OpenRouter API error'));
            return;
          }

          console.log(`[OpenRouter DEBUG] Response parsed successfully, choices: ${parsed.choices?.length || 0}`);
          resolve(parsed);
        } catch (e) {
          log.error('Failed to parse OpenRouter response:', e.message);
          log.debug('Raw response preview:', sanitizeForLog(data, 200));
          console.error(`[OpenRouter DEBUG] Parse error: ${e.message}`);
          console.error(`[OpenRouter DEBUG] Full raw response: ${data}`);
          reject(new Error(`Failed to parse OpenRouter response: ${e.message}`));
        }
      });
    });

    activeRequests.add(req);
    req.on('close', () => activeRequests.delete(req));
    req.on('error', (err) => {
      console.error(`[OpenRouter DEBUG] Request error: ${err.message}`);
      console.error(`[OpenRouter DEBUG] Error code: ${err.code}`);
      console.error(`[OpenRouter DEBUG] Error stack: ${err.stack}`);
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

  console.log('[OpenRouter DEBUG] generateOpenRouter called');
  console.log(`[OpenRouter DEBUG] Has prompt: ${!!prompt}`);
  console.log(`[OpenRouter DEBUG] Has messages: ${!!messages} (${messages?.length || 0})`);
  console.log(`[OpenRouter DEBUG] Has systemPrompt: ${!!systemPrompt}`);
  console.log(`[OpenRouter DEBUG] Settings model: ${settings?.openRouterModel || 'NOT SET'}`);
  console.log(`[OpenRouter DEBUG] Settings API key present: ${!!settings?.openRouterApiKey}`);

  if (!settings?.openRouterApiKey) {
    console.error('[OpenRouter DEBUG] CRITICAL: No API key in settings!');
    console.error('[OpenRouter DEBUG] Settings object keys:', Object.keys(settings || {}));
    throw new Error('OpenRouter API key not found in settings');
  }

  if (!settings?.openRouterModel) {
    console.error('[OpenRouter DEBUG] WARNING: No model selected, using default');
  }

  // Build messages array
  let chatMessages = messages;
  if (!chatMessages) {
    chatMessages = [];
    if (systemPrompt) {
      chatMessages.push({ role: 'system', content: systemPrompt });
    }
    if (prompt) {
      chatMessages.push({ role: 'user', content: prompt });
    }
  }

  console.log(`[OpenRouter DEBUG] Final messages count: ${chatMessages.length}`);

  const body = buildOpenRouterRequest(chatMessages, settings);
  console.log(`[OpenRouter DEBUG] Request body model: ${body.model}`);

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
    n_predict: settings.maxTokens || 150,
    temperature: settings.temperature ?? 0.92,
    top_k: settings.topK ?? 0,
    top_p: settings.topP ?? 0.92,
    min_p: settings.minP ?? 0.08,
    typical_p: settings.typicalP ?? 1,
    tfs_z: settings.tfs ?? 1,
    top_a: settings.topA ?? 0,
    repeat_penalty: settings.repetitionPenalty ?? 1.05,
    repeat_last_n: settings.repPenRange ?? 2048,
    frequency_penalty: settings.frequencyPenalty ?? 0,
    presence_penalty: settings.presencePenalty ?? 0,
    cache_prompt: true,
    special: true  // Parse special tokens (e.g. <start_of_turn>) in template-wrapped prompts
  };

  // Mirostat
  if (settings.mirostat && settings.mirostat > 0) {
    body.mirostat = settings.mirostat;
    body.mirostat_tau = settings.mirostatTau || 5;
    body.mirostat_eta = settings.mirostatEta || 0.1;
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
    body.repeat_penalty = 1;
    body.frequency_penalty = 0;
    body.presence_penalty = 0;
    delete body.dry_multiplier;
    delete body.xtc_probability;
  }

  return body;
}

/**
 * Check if llama.cpp should use chat completion mode (Jinja server-side templating)
 */
function useLlamaCppChat(settings) {
  // Only use /v1/chat/completions if the user explicitly put it in their URL
  return settings.llmUrl && settings.llmUrl.includes('/v1/chat/completions');
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
 * Fetch llama.cpp server capabilities from /props (cached per base URL)
 */
async function getLlamaCppCaps(baseUrl) {
  if (llamaCppCapsCache && llamaCppCapsCacheUrl === baseUrl) {
    return llamaCppCapsCache;
  }
  try {
    const propsResult = await makeRequest(`${baseUrl}/props`, 'GET');
    if (propsResult) {
      llamaCppCapsCache = {
        supportsSystemRole: propsResult.chat_template_caps?.supports_system_role ?? false,
        chatTemplate: propsResult.chat_template || '',
        modelAlias: propsResult.model_alias || '',
      };
      llamaCppCapsCacheUrl = baseUrl;
      console.log(`[LLM] Cached llama.cpp caps: supportsSystemRole=${llamaCppCapsCache.supportsSystemRole}, template=${llamaCppCapsCache.chatTemplate}`);
      return llamaCppCapsCache;
    }
  } catch (e) {
    console.log(`[LLM] Failed to fetch llama.cpp caps: ${e.message}`);
  }
  return { supportsSystemRole: false, chatTemplate: '', modelAlias: '' };
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
  // llama.cpp
  buildLlamaCppRequest,
  generateLlamaCpp
};
