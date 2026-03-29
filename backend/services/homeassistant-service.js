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

    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
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
      log.error(`${method} ${endpoint} - network error after ${elapsed}ms: ${error.message}`);
      if (error.cause) log.error(`  cause: ${error.cause.message || error.cause}`);
      throw new Error(`Home Assistant unreachable: ${error.message}`);
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
    log.info('Discovering switch entities...');
    const states = await this.request('GET', '/states');
    log.info(`Got ${states.length} total entities from HA`);

    // Filter to switch entities (covers smart plugs/outlets)
    const switches = states
      .filter(entity => entity.entity_id.startsWith('switch.'))
      .map(entity => ({
        entityId: entity.entity_id,
        name: entity.attributes.friendly_name || entity.entity_id,
        state: entity.state,
        deviceClass: entity.attributes.device_class || null,
        icon: entity.attributes.icon || null,
      }));

    log.info(`Found ${switches.length} switch entities:`);
    switches.forEach(s => log.info(`  ${s.entityId} "${s.name}" state=${s.state}`));
    return switches;
  }

  /**
   * Turn a switch entity on
   * @param {string} entityId - HA entity ID (e.g. switch.tapo_plug_1)
   */
  async turnOn(entityId) {
    log.info(`Turning ON ${entityId}`);
    try {
      await this.request('POST', '/services/switch/turn_on', {
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
      await this.request('POST', '/services/switch/turn_off', {
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
