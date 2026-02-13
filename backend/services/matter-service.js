/**
 * Matter Smart Device Service
 * Uses python-matter-server for Matter protocol support
 *
 * Supports any Matter-compatible smart plug (including Tapo P115 as Matter device)
 */

const { exec, spawn } = require('child_process');
const path = require('path');
const { promisify } = require('util');
const { createLogger } = require('../utils/logger');
const log = createLogger('Matter');

const execAsync = promisify(exec);

// Path to Python Matter control script
const PYTHON_PATH = 'python';
const MATTER_SCRIPT_PATH = path.resolve(__dirname, '..', 'bin', 'matter-control.py').replace(/\\/g, '/');

/**
 * Check if Python Matter controller is available
 */
function checkMatterController() {
  const fs = require('fs');
  if (!fs.existsSync(MATTER_SCRIPT_PATH)) {
    throw new Error(`Matter control script not found at ${MATTER_SCRIPT_PATH}`);
  }
  return true;
}

class MatterService {
  constructor() {
    this.devices = new Map(); // nodeId -> device info
    this.ready = false;
    this.nextNodeId = 1; // Track next available node ID for commissioning
    this.serverProcess = null; // Matter server process
    this.serverRunning = false;
    this.autoStart = true; // Auto-start server when needed
    this.storagePath = path.join(__dirname, '..', 'data', 'matter-storage');
  }

  /**
   * Check if Python and required dependencies are available
   */
  async checkPythonDependencies() {
    try {
      // Check Python is available
      const { stdout: pythonVersion } = await execAsync('python --version');
      log.info(`Python found: ${pythonVersion.trim()}`);

      // Check python-matter-server is installed
      const { stdout: matterCheck } = await execAsync('python -m matter_server.server --version').catch(() => ({ stdout: '' }));
      if (!matterCheck) {
        throw new Error('python-matter-server not installed. Run: pip install python-matter-server>=8.1.2');
      }
      log.info('python-matter-server package found');

      return true;
    } catch (error) {
      throw new Error(`Python dependency check failed: ${error.message}`);
    }
  }

  /**
   * Initialize Matter service (check Python Matter controller availability)
   */
  async initialize() {
    if (this.ready) return true;

    try {
      checkMatterController();
      await this.checkPythonDependencies();
      log.info('Python Matter controller found and ready');
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
   * Start the Matter server
   */
  async startServer() {
    if (this.serverRunning) {
      log.info('Matter server already running');
      return { success: true, message: 'Server already running' };
    }

    try {
      const fs = require('fs');

      // Ensure storage directory exists
      if (!fs.existsSync(this.storagePath)) {
        fs.mkdirSync(this.storagePath, { recursive: true });
        log.info(`Created Matter storage directory: ${this.storagePath}`);
      }

      log.info('Starting Matter server...');

      // Start python-matter-server
      this.serverProcess = spawn(PYTHON_PATH, [
        '-m', 'matter_server.server',
        '--storage-path', this.storagePath
      ], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.serverProcess.stdout.on('data', (data) => {
        log.info(`[Matter Server] ${data.toString().trim()}`);
      });

      this.serverProcess.stderr.on('data', (data) => {
        log.error(`[Matter Server] ${data.toString().trim()}`);
      });

      this.serverProcess.on('close', (code) => {
        log.info(`Matter server exited with code ${code}`);
        this.serverRunning = false;
        this.serverProcess = null;
      });

      // Wait a moment for server to start
      await new Promise(resolve => setTimeout(resolve, 2000));

      this.serverRunning = true;
      log.info('Matter server started successfully');

      return { success: true, message: 'Matter server started', running: true };
    } catch (error) {
      log.error('Failed to start Matter server:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Stop the Matter server
   */
  async stopServer() {
    if (!this.serverRunning || !this.serverProcess) {
      log.info('Matter server not running');
      return { success: true, message: 'Server not running' };
    }

    try {
      log.info('Stopping Matter server...');
      this.serverProcess.kill('SIGTERM');

      // Wait for process to exit
      await new Promise(resolve => setTimeout(resolve, 1000));

      this.serverRunning = false;
      this.serverProcess = null;

      log.info('Matter server stopped');
      return { success: true, message: 'Matter server stopped', running: false };
    } catch (error) {
      log.error('Failed to stop Matter server:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get Matter server status
   */
  getServerStatus() {
    return {
      running: this.serverRunning,
      autoStart: this.autoStart,
      storagePath: this.storagePath,
      processId: this.serverProcess ? this.serverProcess.pid : null
    };
  }

  /**
   * Set auto-start preference
   */
  setAutoStart(enabled) {
    this.autoStart = enabled;
    log.info(`Matter server auto-start ${enabled ? 'enabled' : 'disabled'}`);
    return { success: true, autoStart: this.autoStart };
  }

  /**
   * Ensure server is running (auto-start if enabled)
   */
  async ensureServerRunning() {
    if (this.serverRunning) {
      return true;
    }

    if (this.autoStart) {
      log.info('Auto-starting Matter server...');
      const result = await this.startServer();
      return result.success;
    }

    return false;
  }

  /**
   * Execute Python Matter control command
   * @param {Array<string>} args - Command arguments
   * @returns {Promise<Object>} - Parsed JSON response
   */
  async executeMatterCommand(args) {
    return new Promise((resolve, reject) => {
      log.info(`MATTER_SCRIPT_PATH resolved to: ${MATTER_SCRIPT_PATH}`);
      log.info(`__dirname is: ${__dirname}`);
      const command = `${PYTHON_PATH} "${MATTER_SCRIPT_PATH}" ${args.join(' ')}`;
      log.info(`Executing: ${command}`);

      exec(command, { timeout: 60000 }, (error, stdout, stderr) => {
        if (error) {
          log.error(`Matter control error:`);
          log.error(`STDERR: ${stderr}`);
          log.error(`STDOUT: ${stdout}`);
          log.error(`Exit code: ${error.code}`);

          // Build comprehensive error message
          const errorDetails = [];
          if (stderr) errorDetails.push(`Error output: ${stderr.trim()}`);
          if (stdout) errorDetails.push(`Standard output: ${stdout.trim()}`);
          if (error.code) errorDetails.push(`Exit code: ${error.code}`);

          const errorMsg = errorDetails.length > 0
            ? errorDetails.join('\n')
            : error.message;

          reject(new Error(`Python Matter script failed:\n${errorMsg}`));
          return;
        }

        try {
          const result = JSON.parse(stdout.trim());
          if (result.success === false) {
            reject(new Error(result.error || 'Command failed'));
          } else {
            resolve(result);
          }
        } catch (parseError) {
          log.error(`Failed to parse output: ${stdout}`);
          reject(new Error(`Invalid JSON response: ${parseError.message}\nOutput: ${stdout}`));
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

    // Ensure Matter server is running
    await this.ensureServerRunning();

    try {
      log.info(`Commissioning Matter device with pairing code...`);

      // Commission using Python script: python matter-control.py commission <pairingCode> <deviceName>
      const args = ['commission', pairingCode];
      if (deviceName) args.push(deviceName);

      const result = await this.executeMatterCommand(args);

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
      const result = await this.executeMatterCommand(['on', deviceId]);
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
      const result = await this.executeMatterCommand(['off', deviceId]);
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
      const result = await this.executeMatterCommand(['state', deviceId]);
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
