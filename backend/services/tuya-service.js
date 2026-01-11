/**
 * Tuya Smart Device Service - V2 API Implementation
 * Based on official tuya-connector-nodejs SDK
 */

const crypto = require('crypto');

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

  setCredentials(accessId, accessSecret, region = 'us') {
    console.log(`[Tuya] Setting credentials - Access ID: ${accessId ? accessId.substring(0, 8) + '...' : 'null'}, Region: ${region}`);
    this.accessId = accessId;
    this.accessSecret = accessSecret;
    this.region = region;
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;
  }

  isConnected() {
    return !!(this.accessId && this.accessSecret);
  }

  getBaseUrl() {
    return TUYA_REGIONS[this.region] || TUYA_REGIONS.us;
  }

  /**
   * HMAC-SHA256 signature
   */
  sign(str) {
    return crypto
      .createHmac('sha256', this.accessSecret)
      .update(str, 'utf8')
      .digest('hex')
      .toUpperCase();
  }

  /**
   * Get access token - V2 format
   * Sign: accessKey + t + nonce + stringToSign
   */
  async getAccessToken() {
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      console.log('[Tuya] Using cached token');
      return this.accessToken;
    }

    console.log('[Tuya] Requesting new access token (V2 format)...');
    const t = Date.now().toString();
    const nonce = '';
    const method = 'GET';
    const path = '/v1.0/token?grant_type=1';

    // V2: hash empty string for token request (no body)
    const contentHash = crypto.createHash('sha256').update('').digest('hex');
    const stringToSign = [method, contentHash, '', path].join('\n');
    const signStr = this.accessId + t + nonce + stringToSign;
    const signature = this.sign(signStr);

    console.log(`[Tuya] Sign: accessId + ${t} + "" + stringToSign`);
    console.log(`[Tuya] Signature: ${signature.substring(0, 16)}...`);

    const url = `${this.getBaseUrl()}${path}`;
    console.log(`[Tuya] Fetching: ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        't': t,
        'sign': signature,
        'client_id': this.accessId,
        'sign_method': 'HMAC-SHA256',
        'nonce': nonce,
      },
    });

    const data = await response.json();
    console.log(`[Tuya] Response: success=${data.success}, code=${data.code}, msg=${data.msg || 'none'}`);

    if (!data.success) {
      throw new Error(`Tuya auth error: ${data.msg} (code: ${data.code})`);
    }

    this.accessToken = data.result.access_token;
    this.refreshToken = data.result.refresh_token;
    this.tokenExpiry = Date.now() + (data.result.expire_time - 300) * 1000;

    console.log(`[Tuya] Token obtained, expires in ${data.result.expire_time}s`);
    return this.accessToken;
  }

  /**
   * Make authenticated request - V2 format
   * Based on official tuya-connector-nodejs SDK getSignHeaders method
   */
  async request(method, path, body = {}) {
    if (!this.accessId || !this.accessSecret) {
      throw new Error('Tuya credentials not configured');
    }

    console.log(`[Tuya] ---- API Request: ${method} ${path} ----`);

    const token = await this.getAccessToken();
    const t = Date.now().toString();
    const nonce = '';

    // SDK uses JSON.stringify(body) for all requests
    const bodyStr = JSON.stringify(body);
    const contentHash = crypto.createHash('sha256').update(bodyStr).digest('hex');
    const stringToSign = [method, contentHash, '', path].join('\n');
    // Try with nonce per official docs: client_id + access_token + t + nonce + stringToSign
    const signStr = this.accessId + token + t + nonce + stringToSign;
    const signature = this.sign(signStr);

    console.log(`[Tuya] Body: ${bodyStr}`);
    console.log(`[Tuya] ContentHash: ${contentHash.substring(0, 16)}...`);
    console.log(`[Tuya] StringToSign: ${method}\\n${contentHash.substring(0,16)}...\\n\\n${path}`);
    console.log(`[Tuya] Sign: accessId + token + ${t} + nonce + stringToSign`);
    console.log(`[Tuya] Signature: ${signature.substring(0, 16)}...`);

    const headers = {
      't': t,
      'sign': signature,
      'client_id': this.accessId,
      'sign_method': 'HMAC-SHA256',
      'nonce': nonce,
      'access_token': token,
      'Content-Type': 'application/json',
      'Dev_lang': 'javascript',
      'Dev_channel': 'SaaSFramework',
    };

    const options = { method, headers };

    // Only send body for non-GET requests
    if (method !== 'GET' && Object.keys(body).length > 0) {
      options.body = bodyStr;
    }

    const url = `${this.getBaseUrl()}${path}`;
    console.log(`[Tuya] Full URL: ${url}`);

    const response = await fetch(url, options);
    const data = await response.json();

    console.log(`[Tuya] Response: success=${data.success}, code=${data.code}, msg=${data.msg || 'none'}`);

    if (!data.success) {
      throw new Error(`Tuya API error: ${data.msg} (code: ${data.code})`);
    }

    return data.result;
  }

  async listDevices() {
    const tokenInfo = await this.request('GET', '/v1.0/token/info');
    const uid = tokenInfo.uid;
    const devices = await this.request('GET', `/v1.0/users/${uid}/devices`);
    return devices || [];
  }

  async getDeviceStatus(deviceId) {
    return await this.request('GET', `/v1.0/devices/${deviceId}/status`);
  }

  async sendCommand(deviceId, commands) {
    return await this.request('POST', `/v1.0/devices/${deviceId}/commands`, { commands });
  }

  async turnOn(deviceId) {
    console.log(`[Tuya] Turning ON device ${deviceId}`);
    return await this.sendCommand(deviceId, [
      { code: 'switch_1', value: true },
      { code: 'switch', value: true }
    ]);
  }

  async turnOff(deviceId) {
    console.log(`[Tuya] Turning OFF device ${deviceId}`);
    return await this.sendCommand(deviceId, [
      { code: 'switch_1', value: false },
      { code: 'switch', value: false }
    ]);
  }

  async getPowerState(deviceId) {
    const status = await this.getDeviceStatus(deviceId);
    const switchStatus = status.find(s => s.code === 'switch_1' || s.code === 'switch');
    return switchStatus ? (switchStatus.value ? 'on' : 'off') : 'unknown';
  }

  async testConnection() {
    console.log('[Tuya] ========== CONNECTION TEST ==========');
    try {
      await this.getAccessToken();
      console.log('[Tuya] ========== SUCCESS ==========');
      return true;
    } catch (error) {
      console.error('[Tuya] ========== FAILED ==========');
      console.error('[Tuya] Error:', error.message);
      return false;
    }
  }
}

module.exports = new TuyaService();
