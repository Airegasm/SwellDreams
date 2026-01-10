/**
 * Device Service - Multi-brand smart device management
 * Supports: TP-Link Kasa, Govee
 */

const { spawn } = require('child_process');
const path = require('path');
const goveeService = require('./govee-service');

const PYTHON_DIR = path.join(__dirname, '..', 'python');

/**
 * Execute Python script and return JSON result
 */
function executePython(script, args = []) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(PYTHON_DIR, script);
    const process = spawn('python3', [scriptPath, ...args], {
      cwd: PYTHON_DIR
    });

    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('close', (code) => {
      if (code !== 0 && !stdout) {
        reject(new Error(stderr || `Python script exited with code ${code}`));
        return;
      }

      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (e) {
        reject(new Error(`Failed to parse Python output: ${stdout}`));
      }
    });

    process.on('error', (err) => {
      reject(err);
    });
  });
}

class DeviceService {
  constructor() {
    this.devices = new Map(); // ip -> device info
    this.deviceStates = new Map(); // ip -> { state: 'on'|'off', lastUpdate }
    this.activeCycles = new Map(); // ip -> { timer, intervalTimer, settings }
    this.eventEmitter = null;
  }

  /**
   * Set event emitter for device events
   */
  setEventEmitter(emitter) {
    this.eventEmitter = emitter;
  }

  /**
   * Emit device event
   */
  emitEvent(eventType, data) {
    if (this.eventEmitter) {
      this.eventEmitter(eventType, data);
    }
  }

  /**
   * Scan network for Kasa devices
   */
  async scanNetwork(timeout = 10) {
    try {
      const result = await executePython('network_scan.py', [timeout.toString()]);
      return result.devices || [];
    } catch (error) {
      console.error('[DeviceService] Scan error:', error);
      return [];
    }
  }

  /**
   * Get device info
   */
  async getDeviceInfo(ip) {
    try {
      return await executePython('kasa_api.py', ['info', ip]);
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * Get device state (routes by brand)
   * @param {string} ipOrDeviceId - IP address for TPLink, deviceId for Govee
   * @param {Object} device - Optional device object with brand info
   */
  async getDeviceState(ipOrDeviceId, device = null) {
    // Try to get device from registered devices if not provided
    if (!device) {
      device = this.devices.get(ipOrDeviceId);
    }

    try {
      // Route by brand
      if (device?.brand === 'govee') {
        const state = await goveeService.getPowerState(device.deviceId, device.sku);
        const result = {
          state,
          relay_state: state === 'on' ? 1 : 0
        };
        this.deviceStates.set(device.deviceId, {
          state: result.state,
          relayState: result.relay_state,
          lastUpdate: Date.now()
        });
        return result;
      }

      // Default: TPLink
      const result = await executePython('kasa_api.py', ['state', ipOrDeviceId]);
      if (!result.error) {
        this.deviceStates.set(ipOrDeviceId, {
          state: result.state,
          relayState: result.relay_state,
          lastUpdate: Date.now()
        });
      }
      return result;
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * Turn device on (routes by brand)
   * @param {string} ipOrDeviceId - IP address for TPLink, deviceId for Govee
   * @param {Object} device - Optional device object with brand info
   */
  async turnOn(ipOrDeviceId, device = null) {
    // Try to get device from registered devices if not provided
    if (!device) {
      device = this.devices.get(ipOrDeviceId);
    }

    try {
      // Route by brand
      if (device?.brand === 'govee') {
        await goveeService.turnOn(device.deviceId, device.sku);
        this.deviceStates.set(device.deviceId, {
          state: 'on',
          relayState: 1,
          lastUpdate: Date.now()
        });
        this.emitEvent('device_on', { ip: device.deviceId, device });
        return { success: true, state: 'on' };
      }

      // Default: TPLink
      const result = await executePython('kasa_api.py', ['on', ipOrDeviceId]);
      if (!result.error) {
        this.deviceStates.set(ipOrDeviceId, {
          state: 'on',
          relayState: 1,
          lastUpdate: Date.now()
        });
        this.emitEvent('device_on', { ip: ipOrDeviceId, device: this.devices.get(ipOrDeviceId) });
      }
      return result;
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * Turn device off (routes by brand)
   * @param {string} ipOrDeviceId - IP address for TPLink, deviceId for Govee
   * @param {Object} device - Optional device object with brand info
   */
  async turnOff(ipOrDeviceId, device = null) {
    // Try to get device from registered devices if not provided
    if (!device) {
      device = this.devices.get(ipOrDeviceId);
    }

    try {
      // Route by brand
      if (device?.brand === 'govee') {
        await goveeService.turnOff(device.deviceId, device.sku);
        this.deviceStates.set(device.deviceId, {
          state: 'off',
          relayState: 0,
          lastUpdate: Date.now()
        });
        this.emitEvent('device_off', { ip: device.deviceId, device });
        return { success: true, state: 'off' };
      }

      // Default: TPLink
      const result = await executePython('kasa_api.py', ['off', ipOrDeviceId]);
      if (!result.error) {
        this.deviceStates.set(ipOrDeviceId, {
          state: 'off',
          relayState: 0,
          lastUpdate: Date.now()
        });
        this.emitEvent('device_off', { ip: ipOrDeviceId, device: this.devices.get(ipOrDeviceId) });
      }
      return result;
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * Toggle device state
   */
  async toggle(ip) {
    try {
      return await executePython('kasa_api.py', ['toggle', ip]);
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * Start device cycling
   * @param {string} ip - Device IP
   * @param {Object} options
   * @param {number} options.duration - Seconds device stays on per cycle
   * @param {number} options.interval - Seconds between cycles
   * @param {number} options.cycles - Number of cycles (0 = infinite)
   * @param {boolean} options.repeat - Whether to repeat
   */
  async startCycle(ip, options = {}) {
    const { duration = 5, interval = 10, cycles = 0, repeat = false } = options;

    // Stop existing cycle if any
    this.stopCycle(ip);

    let currentCycle = 0;
    const maxCycles = cycles > 0 ? cycles : Infinity;

    const runCycle = async () => {
      if (currentCycle >= maxCycles) {
        this.stopCycle(ip);
        this.emitEvent('cycle_complete', { ip, cycles: currentCycle });
        return;
      }

      currentCycle++;

      // Turn on
      await this.turnOn(ip);
      this.emitEvent('cycle_on', { ip, cycle: currentCycle, duration });

      // Schedule turn off
      const offTimer = setTimeout(async () => {
        await this.turnOff(ip);
        this.emitEvent('cycle_off', { ip, cycle: currentCycle });

        // Schedule next cycle if not done
        if (currentCycle < maxCycles || repeat) {
          const nextTimer = setTimeout(runCycle, interval * 1000);
          const cycleInfo = this.activeCycles.get(ip);
          if (cycleInfo) {
            cycleInfo.intervalTimer = nextTimer;
          }
        } else {
          this.stopCycle(ip);
          this.emitEvent('cycle_complete', { ip, cycles: currentCycle });
        }
      }, duration * 1000);

      this.activeCycles.set(ip, {
        timer: offTimer,
        intervalTimer: null,
        settings: options,
        currentCycle,
        startTime: Date.now()
      });
    };

    // Start first cycle
    await runCycle();

    return { success: true, message: 'Cycle started' };
  }

  /**
   * Stop device cycling
   */
  async stopCycle(ip) {
    const cycleInfo = this.activeCycles.get(ip);
    if (cycleInfo) {
      if (cycleInfo.timer) clearTimeout(cycleInfo.timer);
      if (cycleInfo.intervalTimer) clearTimeout(cycleInfo.intervalTimer);
      const cycleCount = cycleInfo.currentCycle || 0;
      this.activeCycles.delete(ip);

      // Turn off the device first
      await this.turnOff(ip);

      // Emit cycle_complete when manually stopped
      this.emitEvent('cycle_complete', { ip, cycles: cycleCount, manual: true });

      return { success: true, message: 'Cycle stopped' };
    }
    return { success: false, message: 'No active cycle' };
  }

  /**
   * Check if device is cycling
   */
  isCycling(ip) {
    return this.activeCycles.has(ip);
  }

  /**
   * Get cycle status
   */
  getCycleStatus(ip) {
    const cycleInfo = this.activeCycles.get(ip);
    if (cycleInfo) {
      return {
        cycling: true,
        currentCycle: cycleInfo.currentCycle,
        settings: cycleInfo.settings,
        elapsedTime: Date.now() - cycleInfo.startTime
      };
    }
    return { cycling: false };
  }

  /**
   * Register a device (supports both TPLink and Govee)
   */
  registerDevice(device) {
    // Use ip for TPLink, deviceId for Govee
    const key = device.brand === 'govee' ? device.deviceId : device.ip;
    this.devices.set(key, device);
  }

  /**
   * Unregister a device
   * @param {string} ipOrDeviceId - IP for TPLink, deviceId for Govee
   */
  unregisterDevice(ipOrDeviceId) {
    this.stopCycle(ipOrDeviceId);
    this.devices.delete(ipOrDeviceId);
    this.deviceStates.delete(ipOrDeviceId);
  }

  /**
   * Get all registered devices
   */
  getDevices() {
    return Array.from(this.devices.values());
  }

  /**
   * Get all device states
   */
  getAllStates() {
    const states = {};
    for (const [ip, state] of this.deviceStates) {
      states[ip] = state;
    }
    return states;
  }
}

module.exports = DeviceService;
