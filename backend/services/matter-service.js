/**
 * Matter Smart Device Service
 * Uses native chip-tool binary for Matter protocol support
 *
 * Supports any Matter-compatible smart plug (including Tapo P115 as Matter device)
 */

const { exec, spawn } = require('child_process');
const path = require('path');
const { promisify } = require('util');
const fs = require('fs');
const https = require('https');
const { createLogger } = require('../utils/logger');
const log = createLogger('Matter');

const execAsync = promisify(exec);

// Path to chip-tool binary
const CHIP_TOOL_DIR = path.resolve(__dirname, '..', 'bin', 'chip-tool');
const CHIP_TOOL_PATH = path.join(CHIP_TOOL_DIR, 'chip-tool.exe');

// Multiple potential download sources
const CHIP_TOOL_DOWNLOAD_URLS = [
  'https://github.com/project-chip/connectedhomeip/releases/latest/download/chip-tool-windows.exe',
  'https://github.com/project-chip/connectedhomeip/releases/latest/download/chip-tool.exe',
  'https://github.com/project-chip/connectedhomeip/releases/download/v1.3.0.0/chip-tool-windows-x64.exe'
];

/**
 * Check if chip-tool binary is available
 */
function checkMatterController() {
  if (!fs.existsSync(CHIP_TOOL_PATH)) {
    return false;
  }
  return true;
}

/**
 * Try downloading from a single URL
 */
function tryDownloadFromUrl(url, filePath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filePath);

    const handleResponse = (response) => {
      // Handle redirects
      if (response.statusCode === 302 || response.statusCode === 301 || response.statusCode === 307 || response.statusCode === 308) {
        https.get(response.headers.location, handleResponse).on('error', reject);
        return;
      }

      // Check for success
      if (response.statusCode !== 200) {
        file.close();
        fs.unlink(filePath, () => {});
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(true);
      });
    };

    https.get(url, handleResponse).on('error', (err) => {
      file.close();
      fs.unlink(filePath, () => {});
      reject(err);
    });

    file.on('error', (err) => {
      file.close();
      fs.unlink(filePath, () => {});
      reject(err);
    });
  });
}

/**
 * Download chip-tool binary automatically
 */
async function downloadChipTool() {
  log.info('Downloading chip-tool binary...');

  // Ensure directory exists
  if (!fs.existsSync(CHIP_TOOL_DIR)) {
    fs.mkdirSync(CHIP_TOOL_DIR, { recursive: true });
  }

  // Try each download URL in sequence
  const errors = [];
  for (const url of CHIP_TOOL_DOWNLOAD_URLS) {
    try {
      log.info(`Trying download from: ${url}`);
      await tryDownloadFromUrl(url, CHIP_TOOL_PATH);
      log.info('✓ chip-tool downloaded successfully');
      return true;
    } catch (error) {
      log.warn(`Download failed from ${url}: ${error.message}`);
      errors.push(`${url}: ${error.message}`);
    }
  }

  // All downloads failed
  throw new Error(
    `Failed to download chip-tool from any source.\n` +
    `Errors:\n${errors.join('\n')}\n\n` +
    `Please download manually from:\n` +
    `https://github.com/project-chip/connectedhomeip/releases\n` +
    `Place the file at: ${CHIP_TOOL_PATH}`
  );
}

class MatterService {
  constructor() {
    this.devices = new Map(); // nodeId -> device info
    this.ready = false;
    this.nextNodeId = 1; // Track next available node ID for commissioning
    this.installing = false; // Track if chip-tool is being installed
    this.storagePath = path.join(__dirname, '..', 'data', 'matter-storage');
  }

  /**
   * Install chip-tool binary if missing
   */
  async installChipTool() {
    if (this.installing) {
      log.info('chip-tool installation already in progress...');
      // Wait for existing installation
      while (this.installing) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      return checkMatterController();
    }

    try {
      this.installing = true;
      log.info('Setting up Matter support...');

      // Ensure storage directory exists
      if (!fs.existsSync(this.storagePath)) {
        fs.mkdirSync(this.storagePath, { recursive: true });
        log.info(`Created Matter storage directory: ${this.storagePath}`);
      }

      // Download chip-tool if missing
      await downloadChipTool();

      log.info('Matter binary installed successfully');
      return true;
    } catch (error) {
      log.error('Failed to install Matter binary:', error.message);
      throw new Error(`Failed to install Matter binary: ${error.message}`);
    } finally {
      this.installing = false;
    }
  }

  /**
   * Initialize Matter service (check/install chip-tool binary)
   */
  async initialize() {
    if (this.ready) return true;

    try {
      // Check if chip-tool exists
      if (!checkMatterController()) {
        log.info('Matter binary not found, installing automatically...');
        await this.installChipTool();
      }

      // Verify binary exists and is executable
      if (!fs.existsSync(CHIP_TOOL_PATH)) {
        throw new Error('chip-tool binary not found after installation');
      }

      log.info('✓ Matter protocol support enabled (chip-tool available)');
      this.ready = true;
      return true;
    } catch (error) {
      log.error('✗ Matter protocol initialization failed:', error.message);
      log.error('');
      log.error('⚠ IMPORTANT: Tapo devices REQUIRE Matter (firmware blocks third-party APIs)');
      log.error('Matter binary installation failed. Please check your internet connection.');
      log.error('You can manually download chip-tool from: https://github.com/project-chip/connectedhomeip/releases');
      log.error(`Place it at: ${CHIP_TOOL_PATH}`);
      log.error('');
      this.ready = false;
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
   * Start the Matter server (stub for backwards compatibility)
   * chip-tool doesn't need a persistent server process
   */
  async startServer() {
    log.info('Matter binary ready (no server process needed)');
    return { success: true, message: 'Matter binary ready', running: true };
  }

  /**
   * Stop the Matter server (stub for backwards compatibility)
   */
  async stopServer() {
    log.info('No server process to stop (using native binary)');
    return { success: true, message: 'No server process', running: false };
  }

  /**
   * Get Matter server status
   */
  getServerStatus() {
    return {
      running: this.ready,
      autoStart: true, // Always available when ready
      storagePath: this.storagePath,
      processId: null, // No persistent process
      binaryPath: CHIP_TOOL_PATH,
      binaryExists: fs.existsSync(CHIP_TOOL_PATH)
    };
  }

  /**
   * Set auto-start preference (stub for backwards compatibility)
   */
  setAutoStart(enabled) {
    log.info('Matter binary is always available when installed');
    return { success: true, autoStart: true };
  }

  /**
   * Ensure server is running (stub - just check if binary exists)
   */
  async ensureServerRunning() {
    if (!this.ready) {
      await this.initialize();
    }
    return { success: this.ready };
  }

  /**
   * Execute chip-tool command
   * @param {string} action - Action: 'commission', 'on', 'off', 'state'
   * @param {Object} params - Action parameters
   * @returns {Promise<Object>} - Standardized JSON response
   */
  async executeChipTool(action, params) {
    return new Promise((resolve, reject) => {
      let chipToolArgs = [];
      let nodeId = params.nodeId;

      // Build chip-tool command based on action
      switch (action) {
        case 'commission':
          // chip-tool pairing code <node-id> <pairing-code>
          chipToolArgs = ['pairing', 'code', nodeId, params.pairingCode];
          break;

        case 'on':
          // chip-tool onoff on <node-id> 1
          chipToolArgs = ['onoff', 'on', nodeId, '1'];
          break;

        case 'off':
          // chip-tool onoff off <node-id> 1
          chipToolArgs = ['onoff', 'off', nodeId, '1'];
          break;

        case 'state':
          // chip-tool onoff read on-off <node-id> 1
          chipToolArgs = ['onoff', 'read', 'on-off', nodeId, '1'];
          break;

        default:
          reject(new Error(`Unknown action: ${action}`));
          return;
      }

      const command = `"${CHIP_TOOL_PATH}" ${chipToolArgs.join(' ')}`;
      log.info(`Executing: ${command}`);

      exec(command, {
        timeout: 60000,
        cwd: CHIP_TOOL_DIR // Run in chip-tool directory for proper storage
      }, (error, stdout, stderr) => {
        if (error) {
          log.error(`chip-tool error:`);
          log.error(`STDERR: ${stderr}`);
          log.error(`STDOUT: ${stdout}`);
          log.error(`Exit code: ${error.code}`);

          // Parse chip-tool errors
          let errorMsg = 'Command failed';
          if (stderr.includes('Pairing failed') || stdout.includes('Pairing failed')) {
            errorMsg = 'Device pairing failed. Check pairing code and ensure device is in pairing mode.';
          } else if (stderr.includes('Timeout') || stdout.includes('Timeout')) {
            errorMsg = 'Device connection timeout. Ensure device is powered on and on the same network.';
          } else if (stderr || stdout) {
            errorMsg = stderr || stdout;
          }

          reject(new Error(errorMsg));
          return;
        }

        // Parse chip-tool output and convert to our JSON format
        try {
          let result;

          switch (action) {
            case 'commission':
              // Check if commissioning succeeded
              if (stdout.includes('Commissioning complete') || stdout.includes('success')) {
                result = {
                  success: true,
                  nodeId: parseInt(nodeId),
                  name: params.name || `Matter Device ${nodeId}`
                };
              } else {
                reject(new Error('Commissioning may have failed. Check output.'));
                return;
              }
              break;

            case 'on':
            case 'off':
              // Check if command succeeded
              if (stdout.includes('success') || !error) {
                result = {
                  success: true,
                  nodeId: parseInt(nodeId),
                  state: action
                };
              } else {
                reject(new Error('Command failed'));
                return;
              }
              break;

            case 'state':
              // Parse OnOff attribute value
              // Look for "value: true" or "value: false" in output
              const onMatch = stdout.match(/value:\s*(true|false|1|0)/i);
              if (onMatch) {
                const isOn = onMatch[1] === 'true' || onMatch[1] === '1';
                result = {
                  success: true,
                  nodeId: parseInt(nodeId),
                  state: isOn ? 'on' : 'off'
                };
              } else {
                reject(new Error('Could not parse device state from output'));
                return;
              }
              break;

            default:
              reject(new Error(`Unknown action: ${action}`));
              return;
          }

          resolve(result);
        } catch (parseError) {
          log.error(`Failed to parse chip-tool output: ${stdout}`);
          reject(new Error(`Failed to parse output: ${parseError.message}`));
        }
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
      log.info(`Commissioning Matter device with pairing code...`);

      // Use next available node ID
      const nodeId = this.nextNodeId;
      this.nextNodeId++;

      const result = await this.executeChipTool('commission', {
        nodeId: nodeId,
        pairingCode: pairingCode,
        name: deviceName || `Matter Device ${nodeId}`
      });

      const deviceInfo = {
        deviceId: result.nodeId.toString(),
        nodeId: result.nodeId,
        name: result.name,
        commissioned: true,
        pairingCode: pairingCode
      };

      this.devices.set(result.nodeId.toString(), deviceInfo);
      log.info(`Successfully commissioned device as node ${result.nodeId}`);
      return deviceInfo;
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
      const result = await this.executeChipTool('on', { nodeId: deviceId });
      log.info(`Device ${deviceId} turned ON`);
      return { success: true, state: 'on' };
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
      const result = await this.executeChipTool('off', { nodeId: deviceId });
      log.info(`Device ${deviceId} turned OFF`);
      return { success: true, state: 'off' };
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
      const result = await this.executeChipTool('state', { nodeId: deviceId });
      return result.state;
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
      // Just remove from our tracking - Matter server handles device removal
      this.devices.delete(deviceId);
      log.info(`Removed device ${deviceId}`);
      return { success: true };
    } catch (error) {
      log.error(`Failed to remove device ${deviceId}:`, error.message);
      // Even if removal fails, delete from our tracking
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
