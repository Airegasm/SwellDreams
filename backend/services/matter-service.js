/**
 * Matter Smart Device Service
 * Uses chip-tool (Matter's reference CLI controller) for Matter protocol support
 *
 * Supports any Matter-compatible smart plug (including Tapo P115 as Matter device)
 */

const { exec, spawn } = require('child_process');
const path = require('path');
const { promisify } = require('util');
const { createLogger } = require('../utils/logger');
const log = createLogger('Matter');

const execAsync = promisify(exec);

// Path to chip-tool binary (bundled in repo)
const CHIP_TOOL_PATH = path.join(__dirname, '..', 'bin', 'chip-tool', 'chip-tool.exe');

/**
 * Check if chip-tool is available
 */
function checkChipTool() {
  const fs = require('fs');
  if (!fs.existsSync(CHIP_TOOL_PATH)) {
    throw new Error(`chip-tool not found at ${CHIP_TOOL_PATH}. Please ensure it's installed in backend/bin/chip-tool/`);
  }
  return true;
}

class MatterService {
  constructor() {
    this.devices = new Map(); // nodeId -> device info
    this.ready = false;
    this.nextNodeId = 1; // Track next available node ID for commissioning
  }

  /**
   * Initialize Matter service (check chip-tool availability)
   */
  async initialize() {
    if (this.ready) return true;

    try {
      checkChipTool();
      log.info('chip-tool found and ready');
      this.ready = true;
      return true;
    } catch (error) {
      log.error('Failed to initialize Matter service:', error.message);
      return false;
    }
  }

  /**
   * Check if service is ready
   */
  isReady() {
    return this.ready;
  }

  /**
   * Execute chip-tool command
   * @param {Array<string>} args - Command arguments
   * @returns {Promise<string>} - Command output
   */
  async executeChipTool(args) {
    return new Promise((resolve, reject) => {
      const command = `"${CHIP_TOOL_PATH}" ${args.join(' ')}`;
      log.info(`Executing: ${command}`);

      exec(command, { timeout: 60000 }, (error, stdout, stderr) => {
        if (error) {
          log.error(`chip-tool error: ${stderr}`);
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout);
      });
    });
  }

  /**
   * Commission a Matter device using pairing code
   * @param {string} pairingCode - Manual pairing code (11 digits)
   * @param {string} deviceName - Optional friendly name
   * @returns {Promise<Object>} Commissioned device info
   */
  async commission(pairingCode, deviceName = null) {
    if (!this.ready) {
      await this.initialize();
    }

    try {
      const nodeId = this.nextNodeId++;
      log.info(`Commissioning Matter device with pairing code to node ${nodeId}...`);

      // Commission using chip-tool: chip-tool pairing code <nodeId> <pairingCode>
      // Example: chip-tool pairing code 1 34970112332
      const output = await this.executeChipTool([
        'pairing',
        'code',
        nodeId.toString(),
        pairingCode
      ]);

      // Check if successful
      if (output.includes('Device commissioning completed') || output.includes('Secure Session')) {
        const deviceInfo = {
          deviceId: nodeId.toString(),
          nodeId: nodeId,
          name: deviceName || `Matter Device ${nodeId}`,
          commissioned: true,
          pairingCode: pairingCode
        };

        this.devices.set(nodeId.toString(), deviceInfo);
        log.info(`Successfully commissioned device as node ${nodeId}`);
        return deviceInfo;
      } else {
        throw new Error('Commissioning did not complete successfully');
      }
    } catch (error) {
      log.error('Commission failed:', error.message);
      throw new Error(`Failed to commission device: ${error.message}`);
    }
  }

  /**
   * Turn device on using OnOff cluster
   * @param {string} deviceId - Device ID (nodeId)
   */
  async turnOn(deviceId) {
    log.info(`Turning ON Matter device ${deviceId}`);

    try {
      // chip-tool onoff on <nodeId> <endpoint>
      // Endpoint 1 is typically the main outlet
      const output = await this.executeChipTool([
        'onoff',
        'on',
        deviceId,
        '1'
      ]);

      if (output.includes('status 0x00') || output.includes('SUCCESS')) {
        log.info(`Device ${deviceId} turned ON`);
        return { success: true, state: 'on' };
      } else {
        throw new Error('Turn on command did not report success');
      }
    } catch (error) {
      log.error(`Failed to turn on device ${deviceId}:`, error.message);
      throw error;
    }
  }

  /**
   * Turn device off using OnOff cluster
   * @param {string} deviceId - Device ID (nodeId)
   */
  async turnOff(deviceId) {
    log.info(`Turning OFF Matter device ${deviceId}`);

    try {
      // chip-tool onoff off <nodeId> <endpoint>
      const output = await this.executeChipTool([
        'onoff',
        'off',
        deviceId,
        '1'
      ]);

      if (output.includes('status 0x00') || output.includes('SUCCESS')) {
        log.info(`Device ${deviceId} turned OFF`);
        return { success: true, state: 'off' };
      } else {
        throw new Error('Turn off command did not report success');
      }
    } catch (error) {
      log.error(`Failed to turn off device ${deviceId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get device power state
   * @param {string} deviceId - Device ID (nodeId)
   * @returns {Promise<string>} 'on' or 'off'
   */
  async getPowerState(deviceId) {
    try {
      // chip-tool onoff read on-off <nodeId> <endpoint>
      const output = await this.executeChipTool([
        'onoff',
        'read',
        'on-off',
        deviceId,
        '1'
      ]);

      // Parse output for attribute value
      // Output format: [timestamp] CHIP:DMG: Data = true/false
      if (output.includes('Data = true') || output.includes('Attribute = 1')) {
        return 'on';
      } else if (output.includes('Data = false') || output.includes('Attribute = 0')) {
        return 'off';
      } else {
        log.warn('Could not parse power state, assuming off');
        return 'off';
      }
    } catch (error) {
      log.error(`Failed to get state for device ${deviceId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get commissioned devices list
   */
  getDevices() {
    return Array.from(this.devices.values());
  }

  /**
   * Get specific device info
   */
  getDeviceInfo(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new Error(`Device ${deviceId} not found`);
    }
    return device;
  }

  /**
   * Remove a commissioned device
   * @param {string} deviceId - Device ID to remove
   */
  async removeDevice(deviceId) {
    try {
      // chip-tool pairing unpair <nodeId>
      await this.executeChipTool([
        'pairing',
        'unpair',
        deviceId
      ]);

      this.devices.delete(deviceId);
      log.info(`Removed device ${deviceId}`);
      return { success: true };
    } catch (error) {
      log.error(`Failed to remove device ${deviceId}:`, error.message);
      // Even if chip-tool fails, remove from our tracking
      this.devices.delete(deviceId);
      throw error;
    }
  }

  /**
   * Get power state (for device-service.js compatibility)
   */
  async getState(deviceId) {
    return await this.getPowerState(deviceId);
  }
}

module.exports = new MatterService();
