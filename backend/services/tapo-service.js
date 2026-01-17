/**
 * TP-Link Tapo Smart Device Service
 * Uses Python plugp100 library for proper KLAP protocol support
 *
 * Supports: P100, P105, P110, P115 smart plugs
 */

const { execSync } = require('child_process');
const path = require('path');
const { createLogger } = require('../utils/logger');

const log = createLogger('Tapo');
const SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'tapo-control.py');

class TapoService {
  constructor() {
    this.email = null;
    this.password = null;
  }

  /**
   * Set credentials for Tapo/TP-Link account
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
   * Execute Python Tapo control script
   * @param {string} command - on, off, state, info
   * @param {string} ip - Device IP address
   * @returns {object} Result from Python script
   */
  _execPython(command, ip) {
    if (!this.email || !this.password) {
      throw new Error('Tapo credentials not configured');
    }

    try {
      const result = execSync(
        `python3 "${SCRIPT_PATH}" ${command} ${ip} "${this.email}" "${this.password}"`,
        { encoding: 'utf8', timeout: 30000 }
      );
      return JSON.parse(result.trim());
    } catch (error) {
      log.error(`Python script error for ${command} on ${ip}:`, error.message);
      // Try to parse any JSON in stdout
      if (error.stdout) {
        try {
          return JSON.parse(error.stdout.trim());
        } catch (e) {
          // Ignore parse error
        }
      }
      throw new Error(`Tapo command failed: ${error.message}`);
    }
  }

  /**
   * Test connection by attempting to get device info
   * @param {string} ip - Test device IP
   * @returns {Promise<boolean>}
   */
  async testConnection(ip = '192.168.1.1') {
    if (!this.email || !this.password) {
      log.warn('Cannot test connection - no credentials set');
      return false;
    }
    try {
      const result = this._execPython('info', ip);
      return result.success === true;
    } catch (error) {
      log.error('Connection test failed:', error.message);
      return false;
    }
  }

  /**
   * List devices - not available via local API, return empty
   * Use the TP-Link/Tapo app to find device IPs
   */
  async listDevices() {
    log.info('Cloud device listing not supported - use manual IP entry');
    return [];
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

module.exports = new TapoService();
