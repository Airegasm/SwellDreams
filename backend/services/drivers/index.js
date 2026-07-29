/**
 * Device driver registry (F1). Folder-loaded transport modules, one per brand — see README.md
 * for the contract. device-service checks this registry FIRST when routing; brands not yet
 * migrated fall through to their legacy if-chain arms, so migration can proceed one brand at
 * a time with hardware testing between commits.
 */
const fs = require('fs');
const path = require('path');

const registry = new Map();

for (const f of fs.readdirSync(__dirname)) {
  if (!f.endsWith('.js') || f === 'index.js') continue;
  try {
    const drv = require(path.join(__dirname, f));
    if (drv && drv.id && typeof drv.turnOn === 'function' && typeof drv.turnOff === 'function') {
      registry.set(drv.id, drv);
      console.log(`[Drivers] registered '${drv.id}' (${drv.label || f})`);
    } else {
      console.warn(`[Drivers] ${f} does not export a valid driver (need id/turnOn/turnOff) — skipped`);
    }
  } catch (e) {
    console.error(`[Drivers] failed to load ${f}: ${e.message}`);
  }
}

module.exports = {
  get: (brand) => registry.get(brand) || null,
  has: (brand) => registry.has(brand),
  all: () => [...registry.values()],
};
