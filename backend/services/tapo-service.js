/**
 * TP-Link Tapo Smart Device Service
 * Uses Python plugp100 library for proper KLAP protocol support
 *
 * Supports: P100, P105, P110, P115 smart plugs
 */

const { execFile, spawn } = require('child_process');
const path = require('path');
const { createLogger } = require('../utils/logger');

const log = createLogger('Tapo');
const SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'tapo-control.py');
const PYTHON_CMD = process.platform === 'win32' ? 'python' : 'python3';
const PIP_CMD = process.platform === 'win32' ? 'pip' : 'pip3';

class TapoService {
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
   * Check if Python and tapo library are available, auto-install if needed.
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

    // Check if tapo library is installed
    try {
      const chk = await this._run(PYTHON_CMD, ['-c', 'from tapo import ApiClient'], 15000);
      if (chk.code === 0) {
        log.info('Python tapo library is ready');
        return true;
      }
    } catch (error) {
      // fall through to install attempt
    }

    // Not installed, try to auto-install (async, off the command hot path)
    log.info('tapo library not found, attempting auto-install...');
    try {
      const pipArgs = process.platform === 'linux'
        ? ['install', '--break-system-packages', 'tapo']
        : ['install', 'tapo'];
      const inst = await this._run(PIP_CMD, pipArgs, 120000);
      if (inst.code !== 0) {
        throw new Error(inst.stderr || `pip exited ${inst.code}`);
      }
      log.info('Successfully installed tapo library');
      return true;
    } catch (installError) {
      const msg = `Failed to install tapo: ${installError.message}. Try manually: ${PIP_CMD} install tapo`;
      log.error(msg);
      return msg;
    }
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
   * Execute Python Tapo control script asynchronously (non-blocking).
   * Uses spawn so an offline device can never freeze the event loop.
   * @param {string} command - on, off, state, info
   * @param {string} ip - Device IP address
   * @returns {Promise<object>} Result from Python script
   */
  async _execPython(command, ip) {
    // Clean and validate IP address
    let cleanIp = ip;
    if (typeof ip === 'string') {
      // Strip common prefixes like "IP " or "ip:"
      cleanIp = ip.replace(/^(IP\s*:?\s*)/i, '').trim();
    }

    if (!cleanIp || typeof cleanIp !== 'string' || !cleanIp.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)) {
      throw new Error(`Invalid IP address: "${ip}". Please enter a valid IP like 192.168.1.100`);
    }

    ip = cleanIp;

    // Check Python/tapo ready (async readiness/auto-install boot step)
    const ready = await this.ensurePythonReady();
    if (ready !== true) {
      throw new Error(ready);
    }

    if (!this.email || !this.password) {
      throw new Error('Tapo credentials not configured');
    }

    return new Promise((resolve, reject) => {
      // -B flag disables bytecode caching to ensure fresh script execution after updates
      // Args passed directly (no shell) so special chars in password are safe.
      const child = spawn(PYTHON_CMD, [
        '-B', SCRIPT_PATH, command, ip, this.email, this.password
      ], { windowsHide: true });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { child.kill('SIGKILL'); } catch (e) { /* ignore */ }
        log.error(`Python script timeout for ${command} on ${ip}`);
        reject(new Error('Tapo command failed: timeout'));
      }, 30000);

      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        log.error(`Python script error for ${command} on ${ip}:`, error.message);
        reject(new Error(`Tapo command failed: ${error.message}`));
      });

      child.on('close', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch (e) {
          log.error(`Python script error for ${command} on ${ip}: ${stderr || e.message}`);
          reject(new Error(`Tapo command failed: ${stderr || e.message}`));
        }
      });
    });
  }

  /**
   * Test connection - just validates credentials are set
   * Actual device test requires a specific IP
   * @returns {Promise<boolean>}
   */
  async testConnection() {
    if (!this.email || !this.password) {
      log.warn('Cannot test connection - no credentials set');
      return false;
    }
    // Credentials are set, consider connected
    // Actual device communication happens when a device is added/tested
    log.info('Tapo credentials configured');
    return true;
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

module.exports = new TapoService();
