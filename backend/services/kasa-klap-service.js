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

const { execFile, spawn } = require('child_process');
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
    this._readyPromise = null; // in-flight readiness/install promise
  }

  /**
   * Run a helper command asynchronously and resolve { code, stdout, stderr }.
   * Never rejects for non-zero exit; only rejects if the process can't spawn.
   */
  _run(cmd, args, timeout = 120000) {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, { encoding: 'utf8', timeout }, (error, stdout, stderr) => {
        if (error && (error.code === 'ENOENT' || error.killed)) {
          return reject(error);
        }
        resolve({ code: error ? (error.code || 1) : 0, stdout: stdout || '', stderr: stderr || '' });
      });
    });
  }

  /**
   * Check if Python and python-kasa library are available, auto-install if needed.
   * ASYNC boot step - never blocks the command hot path.
   * @returns {Promise<boolean|string>} true if ready, error message string if not
   */
  async ensurePythonReady() {
    if (this.pythonReady !== null) {
      return this.pythonReady;
    }
    if (this._readyPromise) {
      return this._readyPromise;
    }
    this._readyPromise = this._doEnsurePythonReady().then((result) => {
      this.pythonReady = result;
      this._readyPromise = null;
      return result;
    });
    return this._readyPromise;
  }

  async _doEnsurePythonReady() {
    // Check if Python is available
    try {
      const v = await this._run(PYTHON_CMD, ['--version'], 15000);
      if (v.code !== 0) throw new Error('python check failed');
    } catch (error) {
      const msg = 'Python is not installed. Please install Python 3.8+ from python.org';
      log.error(msg);
      return msg;
    }

    // Check if python-kasa library is installed
    try {
      const chk = await this._run(PYTHON_CMD, ['-c', 'from kasa import Discover'], 15000);
      if (chk.code === 0) {
        log.info('Python python-kasa library is ready');
        return true;
      }
    } catch (error) {
      // fall through to install attempt
    }

    // Not installed, try to auto-install (async, off the command hot path)
    log.info('python-kasa library not found, attempting auto-install...');
    try {
      const pipArgs = process.platform === 'linux'
        ? ['install', '--break-system-packages', 'python-kasa']
        : ['install', 'python-kasa'];
      const inst = await this._run(PIP_CMD, pipArgs, 120000);
      if (inst.code !== 0) {
        throw new Error(inst.stderr || `pip exited ${inst.code}`);
      }
      log.info('Successfully installed python-kasa library');
      return true;
    } catch (installError) {
      const msg = `Failed to install python-kasa: ${installError.message}. Try manually: ${PIP_CMD} install python-kasa`;
      log.error(msg);
      return msg;
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
  async _execPython(command, arg) {
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

    // Check Python/python-kasa ready (async readiness/auto-install boot step)
    const ready = await this.ensurePythonReady();
    if (ready !== true) {
      throw new Error(ready);
    }

    if (!this.email || !this.password) {
      throw new Error('Kasa 1.1.x+ credentials not configured');
    }

    return new Promise((resolve, reject) => {
      // -B flag disables bytecode caching to ensure fresh script execution after updates
      // Args passed directly (no shell) so special chars in password are safe.
      const child = spawn(PYTHON_CMD, [
        '-B', SCRIPT_PATH, command, String(arg), this.email, this.password
      ], { windowsHide: true });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { child.kill('SIGKILL'); } catch (e) { /* ignore */ }
        log.error(`Python script timeout for ${command} on ${arg}`);
        reject(new Error('Kasa 1.1.x+ command failed: timeout'));
      }, 30000);

      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        log.error(`Python script error for ${command} on ${arg}:`, error.message);
        reject(new Error(`Kasa 1.1.x+ command failed: ${error.message}`));
      });

      child.on('close', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch (e) {
          log.error(`Python script error for ${command} on ${arg}: ${stderr || e.message}`);
          reject(new Error(`Kasa 1.1.x+ command failed: ${stderr || e.message}`));
        }
      });
    });
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
    const result = await this._execPython('discover', timeout);
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
    // Throws on failure so device-service catches it into { ok:false, error }.
    const result = await this._execPython('on', ip);
    if (!result.success) {
      throw new Error(result.error || 'Failed to turn on device');
    }
    return { ok: true, ...result };
  }

  /**
   * Turn device off
   * @param {string} ip - Device IP address
   * @returns {Promise<{ok:boolean,error?:string}>} resolves on success; throws on failure
   */
  async turnOff(ip) {
    log.info(`Turning OFF device at ${ip}`);
    // Throws on failure so device-service catches it into { ok:false, error }.
    const result = await this._execPython('off', ip);
    if (!result.success) {
      throw new Error(result.error || 'Failed to turn off device');
    }
    return { ok: true, ...result };
  }

  /**
   * Get device info
   * @param {string} ip - Device IP address
   * @returns {Promise<object>} Device info object
   */
  async getDeviceInfo(ip) {
    const result = await this._execPython('info', ip);
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
    const result = await this._execPython('state', ip);
    if (!result.success) {
      throw new Error(result.error || 'Failed to get power state');
    }
    return result.state;
  }
}

module.exports = new KasaKlapService();
