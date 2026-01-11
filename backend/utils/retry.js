/**
 * Retry Utility for SwellDreams Backend
 * Provides exponential backoff retry logic for unreliable operations
 */

const { createLogger } = require('./logger');
const log = createLogger('Retry');

/**
 * Sleep for a given number of milliseconds
 * @param {number} ms - Milliseconds to sleep
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic and exponential backoff
 *
 * @param {Function} fn - Async function to execute
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum number of retries (default: 3)
 * @param {number} options.baseDelay - Base delay in ms (default: 1000)
 * @param {number} options.maxDelay - Maximum delay in ms (default: 30000)
 * @param {number} options.backoffFactor - Exponential backoff factor (default: 2)
 * @param {boolean} options.jitter - Add random jitter to delay (default: true)
 * @param {Function} options.shouldRetry - Function to determine if error is retryable (default: all errors)
 * @param {Function} options.onRetry - Callback on each retry: (error, attempt) => void
 * @returns {Promise<*>} Result of the function
 * @throws {Error} Last error if all retries fail
 */
async function withRetry(fn, options = {}) {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 30000,
    backoffFactor = 2,
    jitter = true,
    shouldRetry = () => true,
    onRetry = null,
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt > maxRetries || !shouldRetry(error)) {
        throw error;
      }

      // Calculate delay with exponential backoff
      let delay = Math.min(baseDelay * Math.pow(backoffFactor, attempt - 1), maxDelay);

      // Add jitter (0-25% of delay)
      if (jitter) {
        delay += Math.random() * delay * 0.25;
      }

      log.debug(`Attempt ${attempt} failed: ${error.message}. Retrying in ${Math.round(delay)}ms...`);

      if (onRetry) {
        onRetry(error, attempt);
      }

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Determine if an error is likely transient and worth retrying
 * @param {Error} error - The error to check
 * @returns {boolean} True if the error appears transient
 */
function isTransientError(error) {
  const transientPatterns = [
    /timeout/i,
    /ECONNRESET/i,
    /ECONNREFUSED/i,
    /ETIMEDOUT/i,
    /network/i,
    /socket hang up/i,
    /EPIPE/i,
    /EHOSTUNREACH/i,
    /rate limit/i,
    /429/,
    /503/,
    /502/,
    /504/,
  ];

  const errorStr = error.message || error.toString();
  return transientPatterns.some(pattern => pattern.test(errorStr));
}

/**
 * Create a retryable version of a function
 * @param {Function} fn - Function to wrap
 * @param {Object} options - Retry options
 * @returns {Function} Wrapped function with retry
 */
function retryable(fn, options = {}) {
  return async (...args) => {
    return withRetry(() => fn(...args), options);
  };
}

/**
 * Retry specifically for LLM operations
 * Uses longer delays and fewer retries
 */
async function withLLMRetry(fn, onRetry = null) {
  return withRetry(fn, {
    maxRetries: 2,
    baseDelay: 2000,
    maxDelay: 10000,
    shouldRetry: isTransientError,
    onRetry,
  });
}

/**
 * Retry specifically for device operations
 * Uses shorter delays but more retries
 */
async function withDeviceRetry(fn, onRetry = null) {
  return withRetry(fn, {
    maxRetries: 3,
    baseDelay: 500,
    maxDelay: 5000,
    shouldRetry: isTransientError,
    onRetry,
  });
}

module.exports = {
  withRetry,
  isTransientError,
  retryable,
  withLLMRetry,
  withDeviceRetry,
  sleep,
};
