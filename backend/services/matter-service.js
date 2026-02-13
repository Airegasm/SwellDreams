/**
 * Matter Smart Device Service
 * Uses @project-chip/matter-node.js for Matter protocol support
 *
 * Supports any Matter-compatible smart plug (including Tapo P115 as Matter device)
 */

const { createLogger } = require('../utils/logger');
const log = createLogger('Matter');

// Matter will be lazily imported when needed
let matterImported = false;
let MatterServer, CommissioningController, OnOffCluster;

/**
 * Lazy import Matter libraries (they're heavy)
 */
async function importMatter() {
  if (matterImported) return;

  try {
    // Try to import Matter libraries
    const matter = await import('@project-chip/matter-node.js');
    MatterServer = matter.MatterServer;
    CommissioningController = matter.CommissioningController;
    OnOffCluster = matter.OnOffCluster;
    matterImported = true;
    log.info('Matter libraries loaded successfully');
  } catch (error) {
    throw new Error('Matter library not installed. Run: npm install @project-chip/matter-node.js');
  }
}

class MatterService {
  constructor() {
    this.controller = null;
    this.devices = new Map(); // deviceId -> commissioned device
    this.ready = false;
  }

  /**
   * Initialize Matter controller
   */
  async initialize() {
    if (this.ready) return true;

    try {
      await importMatter();

      // Initialize Matter controller
      // This manages the Matter fabric and commissioned devices
      this.controller = await CommissioningController.create({
        // Storage path for Matter credentials
        storageLocation: './backend/data/matter-storage'
      });

      log.info('Matter controller initialized');
      this.ready = true;
      return true;
    } catch (error) {
      log.error('Failed to initialize Matter controller:', error.message);
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
   * Discover Matter devices on network
   * @param {number} timeout - Discovery timeout in seconds
   * @returns {Promise<Array>} List of discovered devices
   */
  async discover(timeout = 30) {
    if (!this.ready) {
      await this.initialize();
    }

    try {
      log.info(`Discovering Matter devices (timeout: ${timeout}s)...`);

      // Scan for commissionable devices
      const discovered = await this.controller.discoverCommissionableDevices({
        timeout: timeout * 1000
      });

      const devices = discovered.map(device => ({
        deviceId: device.instanceId,
        name: device.deviceName || 'Unknown Matter Device',
        vendorId: device.vendorId,
        productId: device.productId,
        discriminator: device.discriminator,
        pairingCode: device.pairingCode, // Manual pairing code
        qrCode: device.qrCode, // QR code data
        commissioned: false
      }));

      log.info(`Discovered ${devices.length} Matter devices`);
      return devices;
    } catch (error) {
      log.error('Matter discovery failed:', error.message);
      return [];
    }
  }

  /**
   * Commission a Matter device (pair it to your fabric)
   * @param {string} pairingCode - 11-digit pairing code or QR code data
   * @param {string} deviceName - Optional friendly name
   * @returns {Promise<Object>} Commissioned device info
   */
  async commission(pairingCode, deviceName = null) {
    if (!this.ready) {
      await this.initialize();
    }

    try {
      log.info(`Commissioning Matter device with pairing code...`);

      // Commission the device
      const device = await this.controller.commissionDevice({
        pairingCode,
        deviceName: deviceName || 'Matter Device'
      });

      const deviceId = device.nodeId.toString();
      this.devices.set(deviceId, device);

      log.info(`Successfully commissioned device: ${deviceId}`);

      return {
        deviceId,
        name: deviceName || device.deviceName || 'Matter Device',
        nodeId: device.nodeId,
        commissioned: true
      };
    } catch (error) {
      log.error('Commission failed:', error.message);
      throw new Error(`Failed to commission device: ${error.message}`);
    }
  }

  /**
   * Get commissioned device
   * @param {string} deviceId - Device ID (nodeId)
   */
  async getDevice(deviceId) {
    if (this.devices.has(deviceId)) {
      return this.devices.get(deviceId);
    }

    // Try to load from storage
    if (this.controller) {
      try {
        const device = await this.controller.getCommissionedDevice(deviceId);
        if (device) {
          this.devices.set(deviceId, device);
          return device;
        }
      } catch (error) {
        log.error(`Failed to load device ${deviceId}:`, error.message);
      }
    }

    throw new Error(`Device ${deviceId} not found or not commissioned`);
  }

  /**
   * Turn device on
   * @param {string} deviceId - Device ID (nodeId)
   */
  async turnOn(deviceId) {
    log.info(`Turning ON Matter device ${deviceId}`);

    try {
      const device = await this.getDevice(deviceId);

      // Get OnOff cluster (endpoint 1 is typically the main outlet)
      const onOffCluster = device.getClusterClient(OnOffCluster, 1);

      if (!onOffCluster) {
        throw new Error('Device does not support OnOff cluster');
      }

      await onOffCluster.on();
      log.info(`Device ${deviceId} turned ON`);

      return { success: true, state: 'on' };
    } catch (error) {
      log.error(`Failed to turn on device ${deviceId}:`, error.message);
      throw error;
    }
  }

  /**
   * Turn device off
   * @param {string} deviceId - Device ID (nodeId)
   */
  async turnOff(deviceId) {
    log.info(`Turning OFF Matter device ${deviceId}`);

    try {
      const device = await this.getDevice(deviceId);

      // Get OnOff cluster
      const onOffCluster = device.getClusterClient(OnOffCluster, 1);

      if (!onOffCluster) {
        throw new Error('Device does not support OnOff cluster');
      }

      await onOffCluster.off();
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
      const device = await this.getDevice(deviceId);

      // Get OnOff cluster
      const onOffCluster = device.getClusterClient(OnOffCluster, 1);

      if (!onOffCluster) {
        throw new Error('Device does not support OnOff cluster');
      }

      // Read the onOff attribute
      const state = await onOffCluster.attributes.onOff.get();

      return state ? 'on' : 'off';
    } catch (error) {
      log.error(`Failed to get state for device ${deviceId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get device info
   * @param {string} deviceId - Device ID (nodeId)
   */
  async getDeviceInfo(deviceId) {
    try {
      const device = await this.getDevice(deviceId);

      // Try to get basic information cluster
      const basicInfo = device.getClusterClient('basicInformation', 0);

      const info = {
        deviceId,
        nodeId: device.nodeId,
        name: device.deviceName || 'Matter Device',
        commissioned: true
      };

      if (basicInfo) {
        try {
          info.vendorName = await basicInfo.attributes.vendorName?.get();
          info.productName = await basicInfo.attributes.productName?.get();
          info.hardwareVersion = await basicInfo.attributes.hardwareVersion?.get();
          info.softwareVersion = await basicInfo.attributes.softwareVersion?.get();
        } catch (e) {
          log.warn('Could not read all basic info attributes:', e.message);
        }
      }

      return info;
    } catch (error) {
      log.error(`Failed to get info for device ${deviceId}:`, error.message);
      throw error;
    }
  }

  /**
   * List all commissioned devices
   */
  async listDevices() {
    if (!this.ready) {
      await this.initialize();
    }

    try {
      const deviceIds = await this.controller.getCommissionedDevices();
      const devices = [];

      for (const deviceId of deviceIds) {
        try {
          const info = await this.getDeviceInfo(deviceId);
          devices.push(info);
        } catch (error) {
          log.warn(`Could not get info for device ${deviceId}:`, error.message);
          devices.push({
            deviceId,
            name: 'Unknown Device',
            error: error.message
          });
        }
      }

      return devices;
    } catch (error) {
      log.error('Failed to list devices:', error.message);
      return [];
    }
  }

  /**
   * Remove a commissioned device
   * @param {string} deviceId - Device ID to remove
   */
  async removeDevice(deviceId) {
    try {
      await this.controller.removeCommissionedDevice(deviceId);
      this.devices.delete(deviceId);
      log.info(`Removed device ${deviceId}`);
      return { success: true };
    } catch (error) {
      log.error(`Failed to remove device ${deviceId}:`, error.message);
      throw error;
    }
  }

  /**
   * Shutdown Matter controller
   */
  async shutdown() {
    if (this.controller) {
      await this.controller.close();
      this.ready = false;
      log.info('Matter controller shutdown');
    }
  }
}

module.exports = new MatterService();
