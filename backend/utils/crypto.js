/**
 * Cryptographic Utilities for SwellDreams Backend
 * Provides AES-256-GCM encryption for sensitive data like API keys
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const ENCRYPTED_PREFIX = 'enc:v1:';
const KEY_FILE = path.join(__dirname, '..', 'data', '.machine-key');

/**
 * Get or create the machine encryption key
 * Generates a new key if one doesn't exist
 * @returns {Buffer} 32-byte encryption key
 */
function getOrCreateMachineKey() {
  try {
    if (fs.existsSync(KEY_FILE)) {
      const keyHex = fs.readFileSync(KEY_FILE, 'utf8').trim();
      return Buffer.from(keyHex, 'hex');
    }

    // Generate new random key
    const key = crypto.randomBytes(32);
    const keyHex = key.toString('hex');

    // Ensure data directory exists
    const dataDir = path.dirname(KEY_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Write key with restrictive permissions
    fs.writeFileSync(KEY_FILE, keyHex, { mode: 0o600 });

    console.log('[Crypto] Generated new machine encryption key');
    return key;
  } catch (error) {
    console.error('[Crypto] Error with machine key:', error.message);
    throw new Error('Failed to initialize encryption key');
  }
}

// Cache the key in memory after first load
let cachedKey = null;

function getMachineKey() {
  if (!cachedKey) {
    cachedKey = getOrCreateMachineKey();
  }
  return cachedKey;
}

/**
 * Encrypt a plaintext string
 * @param {string} plaintext - The text to encrypt
 * @returns {string} Encrypted string with prefix (enc:v1:base64data)
 */
function encrypt(plaintext) {
  if (!plaintext || typeof plaintext !== 'string') {
    return plaintext;
  }

  // Don't double-encrypt
  if (isEncrypted(plaintext)) {
    return plaintext;
  }

  try {
    const key = getMachineKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    const authTag = cipher.getAuthTag();

    // Combine: IV + AuthTag + Ciphertext
    const combined = Buffer.concat([iv, authTag, encrypted]);
    const base64 = combined.toString('base64');

    return ENCRYPTED_PREFIX + base64;
  } catch (error) {
    console.error('[Crypto] Encryption error:', error.message);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypt an encrypted string
 * @param {string} ciphertext - The encrypted string (with enc:v1: prefix)
 * @returns {string} Decrypted plaintext
 */
function decrypt(ciphertext) {
  if (!ciphertext || typeof ciphertext !== 'string') {
    return ciphertext;
  }

  // Only decrypt if it has our prefix
  if (!isEncrypted(ciphertext)) {
    return ciphertext;
  }

  try {
    const key = getMachineKey();
    const base64Data = ciphertext.slice(ENCRYPTED_PREFIX.length);
    const combined = Buffer.from(base64Data, 'base64');

    // Extract: IV + AuthTag + Ciphertext
    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString('utf8');
  } catch (error) {
    console.error('[Crypto] Decryption error:', error.message);
    throw new Error('Failed to decrypt data - key may have changed');
  }
}

/**
 * Check if a value is encrypted (has our prefix)
 * @param {string} value - Value to check
 * @returns {boolean} True if encrypted
 */
function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Mask an API key for display (show first/last few chars)
 * @param {string} key - API key to mask
 * @param {number} showChars - Number of characters to show at start/end
 * @returns {string} Masked key or indicator
 */
function maskApiKey(key, showChars = 4) {
  if (!key || typeof key !== 'string') {
    return '';
  }

  // Decrypt if needed to get actual length
  const plainKey = isEncrypted(key) ? decrypt(key) : key;

  if (plainKey.length <= showChars * 2 + 3) {
    return '***';
  }

  const start = plainKey.substring(0, showChars);
  const end = plainKey.substring(plainKey.length - showChars);
  return `${start}...${end}`;
}

/**
 * Check if an API key is set (non-empty after decryption)
 * @param {string} key - API key (possibly encrypted)
 * @returns {boolean} True if key is set and non-empty
 */
function hasApiKey(key) {
  if (!key || typeof key !== 'string') {
    return false;
  }

  const plainKey = isEncrypted(key) ? decrypt(key) : key;
  return plainKey.length > 0;
}

/**
 * Encrypt all sensitive fields in a settings object
 * @param {Object} settings - Settings object
 * @returns {Object} Settings with encrypted keys
 */
function encryptSettings(settings) {
  if (!settings) return settings;

  const encrypted = { ...settings };

  // Encrypt API keys
  if (encrypted.openRouterApiKey) {
    encrypted.openRouterApiKey = encrypt(encrypted.openRouterApiKey);
  }
  if (encrypted.goveeApiKey) {
    encrypted.goveeApiKey = encrypt(encrypted.goveeApiKey);
  }

  // Encrypt Tuya credentials
  if (encrypted.tuyaAccessId) {
    encrypted.tuyaAccessId = encrypt(encrypted.tuyaAccessId);
  }
  if (encrypted.tuyaAccessSecret) {
    encrypted.tuyaAccessSecret = encrypt(encrypted.tuyaAccessSecret);
  }

  // Encrypt Wyze credentials
  if (encrypted.wyzePassword) {
    encrypted.wyzePassword = encrypt(encrypted.wyzePassword);
  }
  if (encrypted.wyzeApiKey) {
    encrypted.wyzeApiKey = encrypt(encrypted.wyzeApiKey);
  }
  if (encrypted.wyzeTotpKey) {
    encrypted.wyzeTotpKey = encrypt(encrypted.wyzeTotpKey);
  }

  return encrypted;
}

/**
 * Decrypt all sensitive fields in a settings object
 * @param {Object} settings - Settings object with encrypted keys
 * @returns {Object} Settings with decrypted keys
 */
function decryptSettings(settings) {
  if (!settings) return settings;

  const decrypted = { ...settings };

  // Decrypt API keys
  if (decrypted.openRouterApiKey) {
    decrypted.openRouterApiKey = decrypt(decrypted.openRouterApiKey);
  }
  if (decrypted.goveeApiKey) {
    decrypted.goveeApiKey = decrypt(decrypted.goveeApiKey);
  }

  // Decrypt Tuya credentials
  if (decrypted.tuyaAccessId) {
    decrypted.tuyaAccessId = decrypt(decrypted.tuyaAccessId);
  }
  if (decrypted.tuyaAccessSecret) {
    decrypted.tuyaAccessSecret = decrypt(decrypted.tuyaAccessSecret);
  }

  // Decrypt Wyze credentials
  if (decrypted.wyzePassword) {
    decrypted.wyzePassword = decrypt(decrypted.wyzePassword);
  }
  if (decrypted.wyzeApiKey) {
    decrypted.wyzeApiKey = decrypt(decrypted.wyzeApiKey);
  }
  if (decrypted.wyzeTotpKey) {
    decrypted.wyzeTotpKey = decrypt(decrypted.wyzeTotpKey);
  }

  return decrypted;
}

/**
 * Prepare settings for API response (mask sensitive fields)
 * @param {Object} settings - Settings object
 * @returns {Object} Settings safe for client with masked keys
 */
function maskSettingsForResponse(settings) {
  if (!settings) return settings;

  const masked = { ...settings };

  // Replace keys with masked versions and add hasKey indicators
  if (masked.openRouterApiKey) {
    masked.openRouterApiKeyMasked = maskApiKey(masked.openRouterApiKey);
    masked.hasOpenRouterApiKey = hasApiKey(masked.openRouterApiKey);
    masked.openRouterApiKey = ''; // Don't send actual key
  }
  if (masked.goveeApiKey) {
    masked.goveeApiKeyMasked = maskApiKey(masked.goveeApiKey);
    masked.hasGoveeApiKey = hasApiKey(masked.goveeApiKey);
    masked.goveeApiKey = ''; // Don't send actual key
  }
  if (masked.tuyaAccessId) {
    masked.tuyaAccessIdMasked = maskApiKey(masked.tuyaAccessId);
    masked.hasTuyaCredentials = hasApiKey(masked.tuyaAccessId);
    masked.tuyaAccessId = '';
    masked.tuyaAccessSecret = '';
  }
  if (masked.wyzeApiKey) {
    masked.wyzeApiKeyMasked = maskApiKey(masked.wyzeApiKey);
    masked.hasWyzeCredentials = hasApiKey(masked.wyzeApiKey);
    masked.wyzeEmail = '';
    masked.wyzePassword = '';
    masked.wyzeKeyId = '';
    masked.wyzeApiKey = '';
    masked.wyzeTotpKey = '';
  }

  return masked;
}

/**
 * Encrypt sensitive fields in a connection profile
 * @param {Object} profile - Connection profile
 * @returns {Object} Profile with encrypted keys
 */
function encryptConnectionProfile(profile) {
  if (!profile) return profile;

  const encrypted = { ...profile };

  if (encrypted.openRouterApiKey) {
    encrypted.openRouterApiKey = encrypt(encrypted.openRouterApiKey);
  }

  return encrypted;
}

/**
 * Decrypt sensitive fields in a connection profile
 * @param {Object} profile - Connection profile with encrypted keys
 * @returns {Object} Profile with decrypted keys
 */
function decryptConnectionProfile(profile) {
  if (!profile) return profile;

  const decrypted = { ...profile };

  if (decrypted.openRouterApiKey) {
    decrypted.openRouterApiKey = decrypt(decrypted.openRouterApiKey);
  }

  return decrypted;
}

module.exports = {
  encrypt,
  decrypt,
  isEncrypted,
  maskApiKey,
  hasApiKey,
  encryptSettings,
  decryptSettings,
  maskSettingsForResponse,
  encryptConnectionProfile,
  decryptConnectionProfile,
  ENCRYPTED_PREFIX
};
