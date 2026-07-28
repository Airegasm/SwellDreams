# Device Driver Registry (F1 — scaffold)

Target architecture for collapsing the 5-file brand-add process (documented in CLAUDE.md) into
one folder-loaded driver module per brand.

## Contract

Each `backend/services/drivers/<brand>.js` exports:

```js
module.exports = {
  id: 'kasa',                    // brand key used in device.brand
  label: 'TP-Link Kasa',         // UI label
  transport: 'local',            // 'local' | 'cloud' — cloud brands are pulse-gated (rate limits)
  configFields: [                // rendered generically by DeviceTab's brand config UI
    // { key, label, type: 'text'|'password', required }
  ],
  setCredentials(cfg) {},        // called at boot (decrypted settings) + on config save
  async discover() {},           // -> [{ id, label, ip?, deviceId?, meta }]
  async turnOn(id, device, opts) {},
  async turnOff(id, device) {},
  async test(device) {},         // brief on/off blink
  async getPowerState(device) {} // optional -> 'on' | 'off'
};
```

## Migration order (fresh session; one brand per commit, boot + Test after each)
1. `simulated` (trivial — proves the registry)
2. `kasa` (local, no creds)
3. `homeassistant` (already service-shaped; thinnest wrapper)
4. `shelly` / `esphome` / `tasmota` (local HTTP)
5. `tuya` / `govee` / `wyze` (cloud, credentialed)
6. `tapo` / `kasa-klap` (python-bridge — LAST; excluded on platforms without python, per the
   no-brand-blockers ruling)

## Wiring points to replace
- `device-service.js` brand `if/switch` chains → `registry[device.brand]` dispatch
- server.js boot credential block (~`[Startup] ... credentials loaded`) → loop over drivers
- DeviceTab per-brand test-button conditional → generic `driver.test`
- DeviceTab per-brand connect forms → generic `configFields` renderer

Registry loader sketch: read this dir, `require` each .js, key by `id`; unknown `device.brand`
falls back with a loud log (never a throw — devices must degrade gracefully).
