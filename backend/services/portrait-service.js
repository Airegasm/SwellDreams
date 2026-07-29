/**
 * Portrait service (F3) — Stable Diffusion API client for auto-generating staged portraits.
 * Speaks the AUTOMATIC1111 / SD.Next REST API (txt2img + img2img); ComfyUI users can expose the
 * same surface via its A1111-compat extension. Config lives at settings.sdApi = { url }.
 * Transport only: callers own storage (imageStorage.savePortraitMedia) and card wiring.
 */
const { createLogger } = require('../utils/logger');
const log = createLogger('PortraitService');

async function sdFetch(baseUrl, route, opts = {}, timeoutMs = 300000) {
  const url = `${String(baseUrl || '').replace(/\/+$/, '')}${route}`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    if (!r.ok) throw new Error(`SD API ${route} → HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// Prove the endpoint is an A1111-compatible API (model list responds).
async function testConnection(baseUrl) {
  if (!baseUrl) throw new Error('No Stable Diffusion URL configured');
  const models = await sdFetch(baseUrl, '/sdapi/v1/sd-models', {}, 15000);
  if (!Array.isArray(models)) throw new Error('Endpoint responded but is not an A1111-compatible API');
  return { success: true, models: models.map(m => m.model_name || m.title).slice(0, 20) };
}

/**
 * Generate ONE image. With refImageBase64 uses img2img (reference pose/identity held via
 * denoising strength); otherwise txt2img. Returns raw base64 PNG (no data: prefix).
 */
async function generate({ url, prompt, negativePrompt, width, height, steps, cfgScale, seed, refImageBase64, denoise }) {
  if (!url) throw new Error('No Stable Diffusion URL configured');
  if (!prompt || !String(prompt).trim()) throw new Error('Empty prompt');
  const body = {
    prompt: String(prompt),
    negative_prompt: String(negativePrompt || ''),
    width: Number(width) || 512,
    height: Number(height) || 768,
    steps: Number(steps) || 28,
    cfg_scale: Number(cfgScale) || 7,
    seed: Number.isFinite(Number(seed)) ? Number(seed) : -1,
    sampler_name: 'DPM++ 2M',
  };
  let route = '/sdapi/v1/txt2img';
  if (refImageBase64) {
    route = '/sdapi/v1/img2img';
    body.init_images = [refImageBase64];
    body.denoising_strength = Number(denoise) || 0.55;
  }
  log.info(`generate via ${route}: ${body.width}x${body.height}, ${body.steps} steps`);
  const out = await sdFetch(url, route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const img = out?.images?.[0];
  if (!img) throw new Error('SD API returned no image');
  return img.includes(',') ? img.split(',').pop() : img; // strip any data:-URI header
}

module.exports = { testConnection, generate };
