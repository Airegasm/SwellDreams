/**
 * Custom Devices (E1 extraction): named 120V appliances plugged into a "Custom Device Control"
 * outlet. Store: data/custom-devices.json — { devices: [{ id, name, boundDeviceId }] }.
 * Actuated by the custom_device trigger action and the [CustomDevice:name:on|off|timed:secs]
 * LLM tag. Extracted verbatim from server.js; deps are injected via the shared ctx object so
 * this module owns no global state beyond its own timer map.
 */
const fs = require('fs');
const path = require('path');

module.exports = function initCustomDevices(ctx) {
  const { app, readJsonCached, loadData, DATA_FILES, resolveControlId, MAX_ON_SECONDS, deviceService, aiDeviceControl } = ctx;

  const CUSTOM_DEVICES_PATH = path.join(__dirname, '..', 'data', 'custom-devices.json');
  function loadCustomDevices() {
    try { return readJsonCached(CUSTOM_DEVICES_PATH) ?? { devices: [] }; } catch (e) { return { devices: [] }; }
  }
  function saveCustomDevices(data) { fs.writeFileSync(CUSTOM_DEVICES_PATH, JSON.stringify(data, null, 2)); }

  const customDeviceTimers = new Map(); // customDeviceId -> timeout (timed mode auto-off)
  function clearAllCustomDeviceTimers() {
    for (const t of customDeviceTimers.values()) { try { clearTimeout(t); } catch (e) { /* ignore */ } }
    customDeviceTimers.clear();
  }

  // Actuate a custom device by NAME (case-insensitive). action: 'on' | 'off' | 'timed' (+seconds).
  // Resolves the bound outlet and drives it via deviceService; timed mode arms a tracked auto-off
  // (cleared by emergency stop) clamped to the 30-minute hard ceiling. Returns true when actuated.
  async function executeCustomDeviceControl(nameRaw, action, seconds, source = 'custom-device') {
    const name = String(nameRaw || '').trim();
    if (!name) { console.warn(`[CustomDevice/${source}] no device name given`); return false; }
    const cd = (loadCustomDevices().devices || []).find(d => (d.name || '').trim().toLowerCase() === name.toLowerCase());
    if (!cd) { console.warn(`[CustomDevice/${source}] no custom device named "${name}"`); return false; }
    const devices = loadData(DATA_FILES.devices) || [];
    const outlet = devices.find(d => d.id === cd.boundDeviceId);
    if (!outlet) { console.warn(`[CustomDevice/${source}] "${name}" has no outlet attached`); return false; }
    const outletId = resolveControlId(outlet);
    const prior = customDeviceTimers.get(cd.id);
    if (prior) { clearTimeout(prior); customDeviceTimers.delete(cd.id); }
    if (action === 'off') {
      await deviceService.turnOff(outletId, outlet);
      console.log(`[CustomDevice/${source}] "${name}" OFF (outlet ${outlet.label || outletId})`);
      return true;
    }
    if (action === 'timed') {
      const secs = Math.max(1, Math.min(Number(seconds) || 0, MAX_ON_SECONDS));
      if (!(Number(seconds) > 0)) { console.warn(`[CustomDevice/${source}] timed needs positive seconds — got "${seconds}"`); return false; }
      await deviceService.turnOn(outletId, outlet, { untilType: 'timer', untilValue: secs });
      customDeviceTimers.set(cd.id, setTimeout(() => {
        customDeviceTimers.delete(cd.id);
        deviceService.turnOff(outletId, outlet).catch(err => console.error(`[CustomDevice] auto-off failed for "${name}":`, err?.message || err));
      }, secs * 1000));
      console.log(`[CustomDevice/${source}] "${name}" ON for ${secs}s (outlet ${outlet.label || outletId})`);
      return true;
    }
    await deviceService.turnOn(outletId, outlet);
    console.log(`[CustomDevice/${source}] "${name}" ON (outlet ${outlet.label || outletId})`);
    return true;
  }

  // LLM-tag hook: ai-device-control parses [CustomDevice:...] tags out of model output and
  // routes them here (its pump gates don't apply to generic appliances; the master
  // allowLlmDeviceControl switch is enforced on the parsing side for ON/timed).
  aiDeviceControl.setCustomDeviceHook((cmd) => executeCustomDeviceControl(cmd.name, cmd.action, cmd.duration, 'llm-tag'));

  // ---- Routes ----
  app.get('/api/custom-devices', (req, res) => res.json(loadCustomDevices()));

  app.post('/api/custom-devices', (req, res) => {
    const data = loadCustomDevices();
    if (!Array.isArray(data.devices)) data.devices = [];
    const dev = { id: `cd-${Date.now()}`, name: String(req.body?.name || `Device ${data.devices.length + 1}`), boundDeviceId: req.body?.boundDeviceId || '' };
    data.devices.push(dev);
    saveCustomDevices(data);
    res.json({ success: true, device: dev });
  });

  app.put('/api/custom-devices/:id', (req, res) => {
    const data = loadCustomDevices();
    const dev = (data.devices || []).find(d => d.id === req.params.id);
    if (!dev) return res.status(404).json({ error: 'Custom device not found' });
    if (req.body?.name !== undefined) dev.name = String(req.body.name);
    if (req.body?.boundDeviceId !== undefined) dev.boundDeviceId = req.body.boundDeviceId;
    saveCustomDevices(data);
    res.json({ success: true, device: dev });
  });

  app.delete('/api/custom-devices/:id', (req, res) => {
    const data = loadCustomDevices();
    data.devices = (data.devices || []).filter(d => d.id !== req.params.id);
    saveCustomDevices(data);
    res.json({ success: true });
  });

  return { loadCustomDevices, executeCustomDeviceControl, clearAllCustomDeviceTimers };
};
