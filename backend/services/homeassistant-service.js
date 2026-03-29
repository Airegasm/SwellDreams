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
  }

  /**
   * Check if credentials are configured
   */
  isConnected() {
    return !!(this.url && this.token);
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
      throw new Error('Home Assistant not configured');
    }

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

    const response = await fetch(`${this.url}/api${endpoint}`, options);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Home Assistant API error: ${response.status} - ${error}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }

  /**
   * Test connection to Home Assistant
   * @returns {Promise<boolean>}
   */
  async testConnection() {
    try {
      const result = await this.request('GET', '/');
      return !!result.message; // HA returns { "message": "API running." }
    } catch (error) {
      log.error('Connection test failed:', error.message);
      return false;
    }
  }

  /**
   * List all switch/outlet entities from HA
   * @returns {Promise<Array>} Array of switch entities
   */
  async listDevices() {
    const states = await this.request('GET', '/states');

    // Filter to switch entities (covers smart plugs/outlets)
    return states
      .filter(entity => entity.entity_id.startsWith('switch.'))
      .map(entity => ({
        entityId: entity.entity_id,
        name: entity.attributes.friendly_name || entity.entity_id,
        state: entity.state,
        deviceClass: entity.attributes.device_class || null,
        icon: entity.attributes.icon || null,
      }));
  }

  /**
   * Turn a switch entity on
   * @param {string} entityId - HA entity ID (e.g. switch.tapo_plug_1)
   */
  async turnOn(entityId) {
    log.info(`Turning ON ${entityId}`);
    await this.request('POST', '/services/switch/turn_on', {
      entity_id: entityId,
    });
  }

  /**
   * Turn a switch entity off
   * @param {string} entityId - HA entity ID (e.g. switch.tapo_plug_1)
   */
  async turnOff(entityId) {
    log.info(`Turning OFF ${entityId}`);
    await this.request('POST', '/services/switch/turn_off', {
      entity_id: entityId,
    });
  }

  /**
   * Get power state of an entity
   * @param {string} entityId - HA entity ID
   * @returns {Promise<string>} 'on' or 'off'
   */
  async getPowerState(entityId) {
    const states = await this.request('GET', `/states/${entityId}`);
    return states.state === 'on' ? 'on' : 'off';
  }

  /**
   * Get entity info/attributes
   * @param {string} entityId - HA entity ID
   * @returns {Promise<Object>}
   */
  async getEntityInfo(entityId) {
    const state = await this.request('GET', `/states/${entityId}`);
    return {
      entityId: state.entity_id,
      name: state.attributes.friendly_name || state.entity_id,
      state: state.state,
      attributes: state.attributes,
    };
  }
}

module.exports = new HomeAssistantService();
