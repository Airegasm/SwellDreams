/**
 * Tasmota Smart Plug Service
 * Local-only control via the Tasmota HTTP command API — no cloud, no account.
 * Used for Athom plugs sold pre-flashed with Tasmota, and any Tasmota device.
 */

const TIMEOUT_MS = 5000;

async function tasmotaCmd(ip, cmnd) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`http://${ip}/cm?cmnd=${encodeURIComponent(cmnd)}`, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

class TasmotaService {
  async turnOn(ip) {
    console.log(`[TasmotaService] Turning ON ${ip}`);
    await tasmotaCmd(ip, 'Power ON');
  }

  async turnOff(ip) {
    console.log(`[TasmotaService] Turning OFF ${ip}`);
    await tasmotaCmd(ip, 'Power OFF');
  }

  async getPowerState(ip) {
    const d = await tasmotaCmd(ip, 'Power');
    // Single-relay devices answer { "POWER": "ON" }; multi-relay use POWER1.
    const v = d.POWER != null ? d.POWER : d.POWER1;
    return String(v).toUpperCase() === 'ON' ? 'on' : 'off';
  }
}

const tasmotaService = new TasmotaService();
module.exports = tasmotaService;
