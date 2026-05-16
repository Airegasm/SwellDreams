/**
 * Shelly Smart Plug Service
 * Local-only control over the plug's HTTP API — no cloud, no account.
 * Gen2+ devices (Shelly Plug US Gen4, Plus Plug US) use the JSON-RPC endpoint
 * at /rpc; Gen1 devices fall back to the legacy /relay/0 API.
 */

const TIMEOUT_MS = 5000;

async function fetchJson(url, opts) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

class ShellyService {
  async rpc(ip, method, params) {
    return fetchJson(`http://${ip}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 0, method, params }),
    });
  }

  async setState(ip, on) {
    try {
      await this.rpc(ip, 'Switch.Set', { id: 0, on });
    } catch {
      // Gen1 fallback — older Shelly devices have no /rpc endpoint.
      await fetchJson(`http://${ip}/relay/0?turn=${on ? 'on' : 'off'}`, { method: 'GET' });
    }
  }

  async turnOn(ip) {
    console.log(`[ShellyService] Turning ON ${ip}`);
    return this.setState(ip, true);
  }

  async turnOff(ip) {
    console.log(`[ShellyService] Turning OFF ${ip}`);
    return this.setState(ip, false);
  }

  async getPowerState(ip) {
    try {
      const r = await this.rpc(ip, 'Switch.GetStatus', { id: 0 });
      return r?.result?.output ? 'on' : 'off';
    } catch {
      const r = await fetchJson(`http://${ip}/relay/0`, { method: 'GET' });
      return r?.ison ? 'on' : 'off';
    }
  }
}

const shellyService = new ShellyService();
module.exports = shellyService;
