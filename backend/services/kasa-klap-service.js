/**
 * Kasa 1.1.x+ Smart Device Service
 *
 * Handles TP-Link Kasa devices on firmware 1.1.x and newer, where TP-Link
 * disabled the legacy unauthenticated port-9999 protocol in favour of the
 * authenticated KLAP protocol. Uses the Python 'python-kasa' library for
 * proper KLAP handshake support.
 *
 * For older devices/firmware that still speak the legacy XOR protocol on
 * port 9999, use kasa-service.js ("Kasa Legacy") instead.
 *
 * Supports: HS103, HS105, KP125, EP25, etc. on KLAP firmware.
 */

const { execSync, execFileSync } = require('child_process');
const path = require('path');
const { createLogger } = require('../utils/logger');

const log = createLogger('Kasa 1.1.x+');
const SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'kasa-klap-control.py');
const PYTHON_CMD = process.platform === 'win32' ? 'python' : 'python3';
const PIP_CMD = process.platform === 'win32' ? 'pip' : 'pip3';

class KasaKlapService {
  constructor() {
    this.email = null;
    this.password = null;
    this.pythonReady = null; // null = unchecked, true = ready, string = error message
  }

  /**
   * Check if Python and python-kasa library are available, auto-install if needed
   * @returns {boolean|string} true if ready, error message string if not
   */
  _ensurePythonReady() {
    if (this.pythonReady !== null) {
      return this.pythonReady;
    }

    // Check if Python is available
    try {
      execSync(`${PYTHON_CMD} --version`, { encoding: 'utf8', stdio: 'pipe' });
    } catch (error) {
      this.pythonReady = 'Python is not installed. Please install Python 3.8+ from python.org';
      log.error(this.pythonReady);
      return this.pythonReady;
    }

    // Check if python-kasa library is installed
    try {
      execSync(`${PYTHON_CMD} -c "from kasa import Discover"`, { encoding: 'utf8', stdio: 'pipe' });
      log.info('Python python-kasa library is ready');
      this.pythonReady = true;
      return true;
    } catch (error) {
      // Not installed, try to auto-install
      log.info('python-kasa library not found, attempting auto-install...');
      try {
        const pipFlags = process.platform === 'linux' ? '--break-system-packages' : '';
        execSync(`${PIP_CMD} install ${pipFlags} python-kasa`, {
          encoding: 'utf8',
          stdio: 'pipe',
          timeout: 120000
        });
        log.info('Successfully installed python-kasa library');
        this.pythonReady = true;
        return true;
      } catch (installError) {
        this.pythonReady = `Failed to install python-kasa: ${installError.message}. Try manually: ${PIP_CMD} install python-kasa`;
        log.error(this.pythonReady);
        return this.pythonReady;
      }
    }
  }

  /**
   * Set credentials for the TP-Link account (same login as the Kasa app)
   */
  setCredentials(email, password) {
    const masked = email ? email.substring(0, 4) + '***' : 'null';
    log.info(`Setting credentials for ${masked}`);
    this.email = email;
    this.password = password;
  }

  /**
   * Check if credentials are configured
   */
  isConnected() {
    return !!(this.email && this.password);
  }

  /**
   * Clear all credentials
   */
  clearCredentials() {
    log.info('Clearing credentials');
    this.email = null;
    this.password = null;
  }

  /**
   * Execute the Python KLAP control script
   * @param {string} command - on, off, state, info, discover
   * @param {string} arg - device IP (or discovery timeout for the discover command)
   * @returns {object} Result from the Python script
   */
  _execPython(command, arg) {
    // Validate IP for device-targeted commands (discover takes a timeout instead)
    if (command !== 'discover') {
      let cleanIp = arg;
      if (typeof arg === 'string') {
        cleanIp = arg.replace(/^(IP\s*:?\s*)/i, '').trim();
      }
      if (!cleanIp || typeof cleanIp !== 'string' || !cleanIp.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)) {
        throw new Error(`Invalid IP address: "${arg}". Please enter a valid IP like 192.168.1.100`);
      }
      arg = cleanIp;
    }

    // Check Python/python-kasa ready (auto-installs if needed)
    const ready = this._ensurePythonReady();
    if (ready !== true) {
      throw new Error(ready);
    }

    if (!this.email || !this.password) {
      throw new Error('Kasa 1.1.x+ credentials not configured');
    }

    try {
      // Use execFileSync to avoid shell interpretation of special characters in password
      // -B flag disables bytecode caching to ensure fresh script execution after updates
      const result = execFileSync(PYTHON_CMD, [
        '-B', SCRIPT_PATH, command, String(arg), this.email, this.password
      ], { encoding: 'utf8', timeout: 30000 });
      return JSON.parse(result.trim());
    } catch (error) {
      log.error(`Python script error for ${command} on ${arg}:`, error.message);
      // Try to parse any JSON in stdout
      if (error.stdout) {
        try {
          return JSON.parse(error.stdout.trim());
        } catch (e) {
          // Ignore parse error
        }
      }
      throw new Error(`Kasa 1.1.x+ command failed: ${error.message}`);
    }
  }

  /**
   * Test connection - validates credentials are set
   * Actual device communication happens when a device is added/tested
   * @returns {Promise<boolean>}
   */
  async testConnection() {
    if (!this.email || !this.password) {
      log.warn('Cannot test connection - no credentials set');
      return false;
    }
    log.info('Kasa 1.1.x+ credentials configured');
    return true;
  }

  /**
   * Discover KLAP-protocol Kasa devices on the local network
   * @param {number} timeout - Discovery timeout in seconds
   * @returns {Promise<Array>} Array of discovered devices
   */
  async listDevices(timeout = 5) {
    const result = this._execPython('discover', timeout);
    if (!result.success) {
      throw new Error(result.error || 'Discovery failed');
    }
    return result.devices || [];
  }

  /**
   * Turn device on
   * @param {string} ip - Device IP address
   */
  async turnOn(ip) {
    log.info(`Turning ON device at ${ip}`);
    const result = this._execPython('on', ip);
    if (!result.success) {
      throw new Error(result.error || 'Failed to turn on device');
    }
    return result;
  }

  /**
   * Turn device off
   * @param {string} ip - Device IP address
   */
  async turnOff(ip) {
    log.info(`Turning OFF device at ${ip}`);
    const result = this._execPython('off', ip);
    if (!result.success) {
      throw new Error(result.error || 'Failed to turn off device');
    }
    return result;
  }

  /**
   * Get device info
   * @param {string} ip - Device IP address
   * @returns {Promise<object>} Device info object
   */
  async getDeviceInfo(ip) {
    const result = this._execPython('info', ip);
    if (!result.success) {
      throw new Error(result.error || 'Failed to get device info');
    }
    return result.info;
  }

  /**
   * Get power state of device
   * @param {string} ip - Device IP address
   * @returns {Promise<string>} 'on' or 'off'
   */
  async getPowerState(ip) {
    const result = this._execPython('state', ip);
    if (!result.success) {
      throw new Error(result.error || 'Failed to get power state');
    }
    return result.state;
  }
}

module.exports = new KasaKlapService();
