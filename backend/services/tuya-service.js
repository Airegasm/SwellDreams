/**
 * Tuya Smart Device Service
 * Communicates with Tuya cloud API for device discovery and control
 * Works with Tuya, Smart Life, Treatlife, Gosund, Teckin, and other Tuya-based brands
 */

const crypto = require('crypto');

// Tuya API regions
const TUYA_REGIONS = {
  us: 'https://openapi.tuyaus.com',
  eu: 'https://openapi.tuyaeu.com',
  cn: 'https://openapi.tuyacn.com',
  in: 'https://openapi.tuyain.com'
};

class TuyaService {
  constructor() {
    this.accessId = null;
    this.accessSecret = null;
    this.region = 'us';
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Set credentials for Tuya API
   */
  setCredentials(accessId, accessSecret, region = 'us') {
    this.accessId = accessId;
    this.accessSecret = accessSecret;
    this.region = region;
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Get current credentials (without secret)
   */
  getCredentials() {
    return {
      accessId: this.accessId,
      region: this.region,
      hasSecret: !!this.accessSecret
    };
  }

  /**
   * Check if credentials are configured
   */
  isConnected() {
    return !!(this.accessId && this.accessSecret);
  }

  /**
   * Get the API base URL for the configured region
   */
  getBaseUrl() {
    return TUYA_REGIONS[this.region] || TUYA_REGIONS.us;
  }

  /**
   * Generate signature for Tuya API request
   */
  generateSign(method, path, timestamp, accessToken = '') {
    const contentHash = crypto.createHash('sha256').update('').digest('hex');
    const stringToSign = [method, contentHash, '', path].join('\n');
    const signStr = this.accessId + accessToken + timestamp + stringToSign;

    return crypto
      .createHmac('sha256', this.accessSecret)
      .update(signStr)
      .digest('hex')
      .toUpperCase();
  }

  /**
   * Get access token (with caching)
   */
  async getAccessToken() {
    // Return cached token if still valid
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const timestamp = Date.now().toString();
    const path = '/v1.0/token?grant_type=1';
    const sign = this.generateSign('GET', path, timestamp);

    const response = await fetch(`${this.getBaseUrl()}${path}`, {
      method: 'GET',
      headers: {
        'client_id': this.accessId,
        'sign': sign,
        'sign_method': 'HMAC-SHA256',
        't': timestamp,
      },
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(`Tuya auth error: ${data.msg || 'Failed to get token'}`);
    }

    this.accessToken = data.result.access_token;
    // Token expires in expire_time seconds, refresh 5 minutes early
    this.tokenExpiry = Date.now() + (data.result.expire_time - 300) * 1000;

    return this.accessToken;
  }

  /**
   * Make authenticated request to Tuya API
   */
  async request(method, path, body = null) {
    if (!this.accessId || !this.accessSecret) {
      throw new Error('Tuya credentials not configured');
    }

    const token = await this.getAccessToken();
    const timestamp = Date.now().toString();
    const sign = this.generateSign(method, path, timestamp, token);

    const options = {
      method,
      headers: {
        'client_id': this.accessId,
        'access_token': token,
        'sign': sign,
        'sign_method': 'HMAC-SHA256',
        't': timestamp,
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${this.getBaseUrl()}${path}`, options);
    const data = await response.json();

    if (!data.success) {
      throw new Error(`Tuya API error: ${data.msg || 'Request failed'}`);
    }

    return data.result;
  }

  /**
   * List all devices
   */
  async listDevices() {
    // First get the user's UID
    const tokenInfo = await this.request('GET', '/v1.0/token/info');
    const uid = tokenInfo.uid;

    // Then get devices for this user
    const devices = await this.request('GET', `/v1.0/users/${uid}/devices`);
    return devices || [];
  }

  /**
   * Get device details
   */
  async getDevice(deviceId) {
    return await this.request('GET', `/v1.0/devices/${deviceId}`);
  }

  /**
   * Get device status (all data points)
   */
  async getDeviceStatus(deviceId) {
    return await this.request('GET', `/v1.0/devices/${deviceId}/status`);
  }

  /**
   * Send command to device
   */
  async sendCommand(deviceId, commands) {
    return await this.request('POST', `/v1.0/devices/${deviceId}/commands`, {
      commands
    });
  }

  /**
   * Turn device on
   */
  async turnOn(deviceId) {
    console.log(`[TuyaService] Turning ON device ${deviceId}`);
    return await this.sendCommand(deviceId, [
      { code: 'switch_1', value: true },
      { code: 'switch', value: true }
    ]);
  }

  /**
   * Turn device off
   */
  async turnOff(deviceId) {
    console.log(`[TuyaService] Turning OFF device ${deviceId}`);
    return await this.sendCommand(deviceId, [
      { code: 'switch_1', value: false },
      { code: 'switch', value: false }
    ]);
  }

  /**
   * Get power state
   */
  async getPowerState(deviceId) {
    const status = await this.getDeviceStatus(deviceId);

    // Look for switch status in the response
    const switchStatus = status.find(s =>
      s.code === 'switch_1' || s.code === 'switch'
    );

    if (switchStatus) {
      return switchStatus.value ? 'on' : 'off';
    }

    return 'unknown';
  }

  /**
   * Test connection with current credentials
   */
  async testConnection() {
    try {
      await this.getAccessToken();
      return true;
    } catch (error) {
      console.error('[TuyaService] Connection test failed:', error.message);
      return false;
    }
  }
}

// Export singleton instance
const tuyaService = new TuyaService();
module.exports = tuyaService;
