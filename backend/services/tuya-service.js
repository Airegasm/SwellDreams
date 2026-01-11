/**
 * Tuya Smart Device Service
 * Communicates with Tuya cloud API for device discovery and control
 * Works with Tuya, Smart Life, Treatlife, Gosund, Teckin, and other Tuya-based brands
 *
 * Based on official tuya-connector-nodejs SDK signature implementation
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
    this.refreshToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Set credentials for Tuya API
   */
  setCredentials(accessId, accessSecret, region = 'us') {
    console.log(`[Tuya] Setting credentials - Access ID: ${accessId ? accessId.substring(0, 8) + '...' : 'null'}, Region: ${region}`);
    this.accessId = accessId;
    this.accessSecret = accessSecret;
    this.region = region;
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;
    console.log(`[Tuya] Credentials ${accessId ? 'set' : 'cleared'}, token cache cleared`);
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
   * Calculate HMAC-SHA256 signature (matches official SDK)
   */
  calcSign(str) {
    return crypto
      .createHmac('sha256', this.accessSecret)
      .update(str, 'utf8')
      .digest('hex')
      .toUpperCase();
  }

  /**
   * Get access token
   */
  async getAccessToken() {
    // Return cached token if still valid
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      console.log('[Tuya] Using cached token');
      return this.accessToken;
    }

    console.log('[Tuya] Requesting new access token...');
    const t = Date.now().toString();

    // V1 token signature: accessKey + t (from official SDK refreshSign method)
    const signStr = this.accessId + t;
    const sign = this.calcSign(signStr);

    console.log(`[Tuya] Sign string: ${this.accessId} + ${t}`);
    console.log(`[Tuya] Signature: ${sign.substring(0, 16)}...`);

    const url = `${this.getBaseUrl()}/v1.0/token?grant_type=1`;
    console.log(`[Tuya] Fetching: ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        't': t,
        'sign': sign,
        'client_id': this.accessId,
        'sign_method': 'HMAC-SHA256',
        'Dev_lang': 'javascript',
        'Dev_channel': 'SwellDreams',
      },
    });

    const data = await response.json();
    console.log(`[Tuya] Response: success=${data.success}, code=${data.code}, msg=${data.msg || 'none'}`);

    if (!data.success) {
      console.error(`[Tuya] AUTH FAILED - Code: ${data.code}, Message: ${data.msg}`);
      throw new Error(`Tuya auth error: ${data.msg || 'Failed to get token'} (code: ${data.code})`);
    }

    this.accessToken = data.result.access_token;
    this.refreshToken = data.result.refresh_token;
    // Token expires in expire_time seconds, refresh 5 minutes early
    this.tokenExpiry = Date.now() + (data.result.expire_time - 300) * 1000;

    console.log(`[Tuya] Token obtained successfully, expires in ${data.result.expire_time} seconds`);
    return this.accessToken;
  }

  /**
   * Make authenticated request to Tuya API (V1 format)
   */
  async request(method, path, body = null) {
    if (!this.accessId || !this.accessSecret) {
      throw new Error('Tuya credentials not configured');
    }

    console.log(`[Tuya] ---- API Request: ${method} ${path} ----`);

    const token = await this.getAccessToken();
    const t = Date.now().toString();

    // V1 authenticated signature: accessKey + accessToken + t (from official SDK requestSign method)
    const signStr = this.accessId + token + t;
    const sign = this.calcSign(signStr);

    console.log(`[Tuya] Sign string: accessId + token + ${t}`);
    console.log(`[Tuya] Signature: ${sign.substring(0, 16)}...`);

    const headers = {
      't': t,
      'sign': sign,
      'client_id': this.accessId,
      'sign_method': 'HMAC-SHA256',
      'access_token': token,
      'Dev_lang': 'javascript',
      'Dev_channel': 'SwellDreams',
    };

    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const options = {
      method,
      headers,
    };

    if (body) {
      options.body = JSON.stringify(body);
      console.log(`[Tuya] Body: ${options.body.substring(0, 100)}`);
    }

    const url = `${this.getBaseUrl()}${path}`;
    console.log(`[Tuya] Full URL: ${url}`);

    const response = await fetch(url, options);
    const data = await response.json();

    console.log(`[Tuya] Response: success=${data.success}, code=${data.code}, msg=${data.msg || 'none'}`);

    if (!data.success) {
      console.error(`[Tuya] API ERROR - Code: ${data.code}, Message: ${data.msg}`);
      throw new Error(`Tuya API error: ${data.msg || 'Request failed'} (code: ${data.code})`);
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
    console.log('[Tuya] ========== CONNECTION TEST START ==========');
    try {
      await this.getAccessToken();
      console.log('[Tuya] ========== CONNECTION TEST SUCCESS ==========');
      return true;
    } catch (error) {
      console.error('[Tuya] ========== CONNECTION TEST FAILED ==========');
      console.error('[Tuya] Error:', error.message);
      return false;
    }
  }
}

// Export singleton instance
const tuyaService = new TuyaService();
module.exports = tuyaService;
