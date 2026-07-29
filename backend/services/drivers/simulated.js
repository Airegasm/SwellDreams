/**
 * Simulated outlet driver — no hardware. Proves the registry contract end-to-end and gives
 * authors a safe brand for testing cards, trees, and calibration flows without a real pump.
 * State is in-memory per process; the gauge machinery runs exactly as it would for hardware
 * (device-service does the shared bookkeeping — this module is transport only).
 */
const states = new Map(); // deviceKey -> 'on' | 'off'

module.exports = {
  id: 'simulated',
  label: 'Simulated (no hardware)',
  transport: 'local',
  configFields: [],

  setCredentials() { /* none */ },

  async discover() {
    // Nothing to scan — simulated devices are created by hand in the Devices tab.
    return [];
  },

  async turnOn(id /* deviceKey */) {
    states.set(id, 'on');
    console.log(`[SimulatedDriver] ${id} → ON`);
    return { ok: true };
  },

  async turnOff(id) {
    states.set(id, 'off');
    console.log(`[SimulatedDriver] ${id} → OFF`);
    return { ok: true };
  },

  async test(device) {
    const id = device?.ip || device?.deviceId || 'sim';
    await this.turnOn(id);
    await new Promise(r => setTimeout(r, 400));
    await this.turnOff(id);
    return { success: true, message: 'Simulated blink OK' };
  },

  async getPowerState(device) {
    return states.get(device?.ip || device?.deviceId || 'sim') || 'off';
  },
};
