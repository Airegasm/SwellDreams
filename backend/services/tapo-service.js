/**
 * TP-Link Tapo Smart Device Service
 * Uses tp-link-tapo-connect npm package for KLAP protocol communication
 *
 * Supports: P100, P105, P110, P115 smart plugs
 */

const { cloudLogin, loginDeviceByIp } = require('tp-link-tapo-connect');
const { createLogger } = require('../utils/logger');

const log = createLogger('Tapo');

class TapoService {
  constructor() {
    this.email = null;
    this.password = null;
    this.cloudApi = null;
    this.deviceSessions = new Map(); // ip -> { device, lastUsed }
    this.SESSION_TTL = 5 * 60 * 1000; // 5 minute session cache
  }

  /**
   * Set credentials for Tapo/TP-Link account
   */
  setCredentials(email, password) {
    const masked = email ? email.substring(0, 4) + '***' : 'null';
    log.info(`Setting credentials for ${masked}`);
    this.email = email;
    this.password = password;
    this.cloudApi = null;
    this.deviceSessions.clear();
  }

  /**
   * Check if credentials are configured
   */
  isConnected() {
    return !!(this.email && this.password);
  }

  /**
   * Clear all credentials and sessions
   */
  clearCredentials() {
    log.info('Clearing credentials');
    this.email = null;
    this.password = null;
    this.cloudApi = null;
    this.deviceSessions.clear();
  }

  /**
   * Test connection by attempting cloud login
   * @returns {Promise<boolean>}
   */
  async testConnection() {
    if (!this.email || !this.password) {
      log.warn('Cannot test connection - no credentials set');
      return false;
    }
    try {
      this.cloudApi = await cloudLogin(this.email, this.password);
      log.info('Cloud login successful');
      return true;
    } catch (error) {
      log.error('Cloud login failed:', error.message);
      this.cloudApi = null;
      return false;
    }
  }

  /**
   * List all Tapo plug devices from cloud account
   * @returns {Promise<Array>}
   */
  async listDevices() {
    if (!this.email || !this.password) {
      throw new Error('Tapo credentials not configured');
    }

    try {
      if (!this.cloudApi) {
        this.cloudApi = await cloudLogin(this.email, this.password);
      }
      const devices = await this.cloudApi.listDevicesByType('SMART.TAPOPLUG');
      log.info(`Found ${devices.length} Tapo plug(s)`);
      return devices;
    } catch (error) {
      log.error('Failed to list devices:', error.message);
      // Reset cloud API on failure
      this.cloudApi = null;
      throw error;
    }
  }

  /**
   * Get or create a device session for local control
   * Sessions are cached for SESSION_TTL milliseconds
   * @param {string} ip - Device IP address
   * @returns {Promise<object>} Device session
   */
  async getDeviceSession(ip) {
    if (!this.email || !this.password) {
      throw new Error('Tapo credentials not configured');
    }

    const cached = this.deviceSessions.get(ip);
    const now = Date.now();

    // Return cached session if still valid
    if (cached && (now - cached.lastUsed) < this.SESSION_TTL) {
      cached.lastUsed = now;
      return cached.device;
    }

    // Create new session
    log.info(`Creating new session for ${ip}`);
    try {
      const device = await loginDeviceByIp(this.email, this.password, ip);
      this.deviceSessions.set(ip, { device, lastUsed: now });
      return device;
    } catch (error) {
      log.error(`Failed to create session for ${ip}:`, error.message);
      this.deviceSessions.delete(ip);
      throw error;
    }
  }

  /**
   * Turn device on
   * @param {string} ip - Device IP address
   */
  async turnOn(ip) {
    log.info(`Turning ON device at ${ip}`);
    try {
      const device = await this.getDeviceSession(ip);
      await device.turnOn();
      return { success: true };
    } catch (error) {
      // Session may have expired, retry once with fresh session
      log.warn(`First attempt failed for ${ip}, retrying with fresh session`);
      this.deviceSessions.delete(ip);
      try {
        const device = await this.getDeviceSession(ip);
        await device.turnOn();
        return { success: true };
      } catch (retryError) {
        log.error(`Failed to turn on ${ip}:`, retryError.message);
        throw retryError;
      }
    }
  }

  /**
   * Turn device off
   * @param {string} ip - Device IP address
   */
  async turnOff(ip) {
    log.info(`Turning OFF device at ${ip}`);
    try {
      const device = await this.getDeviceSession(ip);
      await device.turnOff();
      return { success: true };
    } catch (error) {
      // Session may have expired, retry once with fresh session
      log.warn(`First attempt failed for ${ip}, retrying with fresh session`);
      this.deviceSessions.delete(ip);
      try {
        const device = await this.getDeviceSession(ip);
        await device.turnOff();
        return { success: true };
      } catch (retryError) {
        log.error(`Failed to turn off ${ip}:`, retryError.message);
        throw retryError;
      }
    }
  }

  /**
   * Get device info
   * @param {string} ip - Device IP address
   * @returns {Promise<object>} Device info object
   */
  async getDeviceInfo(ip) {
    try {
      const device = await this.getDeviceSession(ip);
      const info = await device.getDeviceInfo();
      return info;
    } catch (error) {
      // Retry with fresh session
      this.deviceSessions.delete(ip);
      const device = await this.getDeviceSession(ip);
      return await device.getDeviceInfo();
    }
  }

  /**
   * Get power state of device
   * @param {string} ip - Device IP address
   * @returns {Promise<string>} 'on' or 'off'
   */
  async getPowerState(ip) {
    const info = await this.getDeviceInfo(ip);
    // device_on is the standard Tapo field for power state
    return info.device_on ? 'on' : 'off';
  }
}

module.exports = new TapoService();
