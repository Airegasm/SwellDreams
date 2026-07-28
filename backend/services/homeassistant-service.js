/**
 * Home Assistant Smart Device Service
 * Communicates with Home Assistant REST API for device discovery and control
 * Used as a bridge for Tapo devices (KLAP protocol broken on Tapo's end)
 */

const { createLogger } = require('../utils/logger');

const log = createLogger('HomeAssistant');

class HomeAssistantService {
  constructor() {
    this.url = null;   // e.g. http://192.168.1.50:8123
    this.token = null; // Long-lived access token
  }

  /**
   * Set the HA connection info
   */
  setCredentials(url, token) {
    // Normalize URL - strip trailing slash
    this.url = url ? url.replace(/\/+$/, '') : null;
    this.token = token;
    log.info(`Configured for ${this.url || '(not set)'}`);
    log.info(`Token: ${this.token ? this.token.substring(0, 8) + '...' : '(not set)'}`);
  }

  /**
   * Check if credentials are configured
   */
  isConnected() {
    const connected = !!(this.url && this.token);
    log.info(`Connection check: ${connected ? 'configured' : 'not configured'} (url=${!!this.url}, token=${!!this.token})`);
    return connected;
  }

  /**
   * Clear credentials
   */
  clearCredentials() {
    log.info('Clearing credentials');
    this.url = null;
    this.token = null;
  }

  /**
   * Make a request to the HA REST API
   */
  async request(method, endpoint, body = null) {
    if (!this.url || !this.token) {
      log.error(`Request failed - not configured (url=${!!this.url}, token=${!!this.token})`);
      throw new Error('Home Assistant not configured');
    }

    const fullUrl = `${this.url}/api${endpoint}`;
    log.info(`${method} ${fullUrl}${body ? ' body=' + JSON.stringify(body) : ''}`);

    // Hard timeout: an unreachable HA host must not hang a chat turn for the OS TCP timeout
    // (~2 min) — a pump command stalls the whole reply. 10s covers slow Pis comfortably.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const startTime = Date.now();
    let response;
    try {
      response = await fetch(fullUrl, options);
    } catch (error) {
      const elapsed = Date.now() - startTime;
      const msg = error.name === 'AbortError' ? `timed out after ${elapsed}ms` : error.message;
      log.error(`${method} ${endpoint} - network error after ${elapsed}ms: ${msg}`);
      if (error.cause) log.error(`  cause: ${error.cause.message || error.cause}`);
      throw new Error(`Home Assistant unreachable: ${msg}`);
    } finally {
      clearTimeout(timeoutId);
    }

    const elapsed = Date.now() - startTime;

    if (!response.ok) {
      const errorBody = await response.text();
      log.error(`${method} ${endpoint} - HTTP ${response.status} ${response.statusText} (${elapsed}ms)`);
      log.error(`  Response body: ${errorBody.substring(0, 500)}`);
      throw new Error(`Home Assistant API error: ${response.status} - ${errorBody}`);
    }

    const text = await response.text();
    const result = text ? JSON.parse(text) : {};
    const dataSize = Array.isArray(result) ? `${result.length} items` : `${text.length} bytes`;
    log.info(`${method} ${endpoint} - OK (${elapsed}ms, ${dataSize})`);
    return result;
  }

  /**
   * Test connection to Home Assistant
   * @returns {Promise<boolean>}
   */
  async testConnection() {
    log.info(`Testing connection to ${this.url}`);
    try {
      const result = await this.request('GET', '/');
      const success = !!result.message;
      log.info(`Connection test ${success ? 'PASSED' : 'FAILED'}: ${JSON.stringify(result)}`);
      return success;
    } catch (error) {
      log.error(`Connection test FAILED: ${error.message}`);
      return false;
    }
  }

  /**
   * List all switch/outlet entities from HA
   * @returns {Promise<Array>} Array of switch entities
   */
  async listDevices() {
    log.info('Discovering toggleable entities...');
    const states = await this.request('GET', '/states');
    log.info(`Got ${states.length} total entities from HA`);

    // Toggleable domains: switch covers smart plugs/outlets (the pump case); light and fan
    // cover 120V appliances people drive as Custom Devices. Control is domain-agnostic
    // (homeassistant/turn_on), so anything listed here is actually drivable.
    const TOGGLEABLE = ['switch.', 'light.', 'fan.'];
    const devices = states
      .filter(entity => TOGGLEABLE.some(p => entity.entity_id.startsWith(p)))
      .map(entity => ({
        entityId: entity.entity_id,
        name: entity.attributes.friendly_name || entity.entity_id,
        state: entity.state,
        domain: entity.entity_id.split('.')[0],
        deviceClass: entity.attributes.device_class || null,
        icon: entity.attributes.icon || null,
      }));

    log.info(`Found ${devices.length} toggleable entities:`);
    devices.forEach(s => log.info(`  ${s.entityId} "${s.name}" state=${s.state}`));
    return devices;
  }

  /**
   * Turn a switch entity on
   * @param {string} entityId - HA entity ID (e.g. switch.tapo_plug_1)
   */
  async turnOn(entityId) {
    log.info(`Turning ON ${entityId}`);
    try {
      // Domain-agnostic service: works for switch/light/fan/... entities alike (the old
      // hardcoded switch/turn_on failed for any non-switch entity).
      await this.request('POST', '/services/homeassistant/turn_on', {
        entity_id: entityId,
      });
      log.info(`Turn ON ${entityId} - success`);
    } catch (error) {
      log.error(`Turn ON ${entityId} - FAILED: ${error.message}`);
      throw error;
    }
  }

  /**
   * Turn a switch entity off
   * @param {string} entityId - HA entity ID (e.g. switch.tapo_plug_1)
   */
  async turnOff(entityId) {
    log.info(`Turning OFF ${entityId}`);
    try {
      await this.request('POST', '/services/homeassistant/turn_off', {
        entity_id: entityId,
      });
      log.info(`Turn OFF ${entityId} - success`);
    } catch (error) {
      log.error(`Turn OFF ${entityId} - FAILED: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get power state of an entity
   * @param {string} entityId - HA entity ID
   * @returns {Promise<string>} 'on' or 'off'
   */
  async getPowerState(entityId) {
    log.info(`Getting power state for ${entityId}`);
    try {
      const data = await this.request('GET', `/states/${entityId}`);
      const state = data.state === 'on' ? 'on' : 'off';
      log.info(`${entityId} state=${state} (raw=${data.state})`);
      return state;
    } catch (error) {
      log.error(`Get power state ${entityId} - FAILED: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get entity info/attributes
   * @param {string} entityId - HA entity ID
   * @returns {Promise<Object>}
   */
  async getEntityInfo(entityId) {
    log.info(`Getting entity info for ${entityId}`);
    try {
      const data = await this.request('GET', `/states/${entityId}`);
      const info = {
        entityId: data.entity_id,
        name: data.attributes.friendly_name || data.entity_id,
        state: data.state,
        attributes: data.attributes,
      };
      log.info(`${entityId} info: name="${info.name}" state=${info.state} attrs=${Object.keys(data.attributes).join(',')}`);
      return info;
    } catch (error) {
      log.error(`Get entity info ${entityId} - FAILED: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new HomeAssistantService();
