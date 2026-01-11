/**
 * API Utilities for SwellDreams Frontend
 * Provides error handling, timeouts, and consistent fetch behavior
 */

/**
 * Custom error class for API errors
 */
export class ApiError extends Error {
  constructor(message, status, code = 'API_ERROR') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  /**
   * Check if error is a timeout
   */
  isTimeout() {
    return this.code === 'TIMEOUT';
  }

  /**
   * Check if error is a network/connection error
   */
  isNetworkError() {
    return this.code === 'NETWORK_ERROR';
  }

  /**
   * Check if error is a server error (5xx)
   */
  isServerError() {
    return this.status >= 500 && this.status < 600;
  }

  /**
   * Check if error is a client error (4xx)
   */
  isClientError() {
    return this.status >= 400 && this.status < 500;
  }
}

/**
 * Default configuration for API requests
 */
const DEFAULT_CONFIG = {
  timeout: 30000, // 30 seconds default
  headers: {
    'Content-Type': 'application/json',
  },
};

/**
 * Fetch wrapper with timeout, error handling, and response validation
 *
 * @param {string} url - The URL to fetch
 * @param {Object} options - Fetch options plus custom options
 * @param {number} options.timeout - Request timeout in ms (default: 30000)
 * @returns {Promise<any>} Parsed JSON response
 * @throws {ApiError} On timeout, network error, or non-OK response
 */
export async function apiFetch(url, options = {}) {
  const { timeout = DEFAULT_CONFIG.timeout, ...fetchOptions } = options;

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        ...DEFAULT_CONFIG.headers,
        ...fetchOptions.headers,
      },
    });

    clearTimeout(timeoutId);

    // Check if response is OK (status 200-299)
    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}`;
      let errorCode = 'HTTP_ERROR';

      // Try to extract error details from response body
      try {
        const errorBody = await response.json();
        errorMessage = errorBody.error || errorBody.message || errorMessage;
        errorCode = errorBody.code || errorCode;
      } catch {
        // Response wasn't JSON, use status text
        errorMessage = response.statusText || errorMessage;
      }

      throw new ApiError(errorMessage, response.status, errorCode);
    }

    // Handle empty responses
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      // Return empty object for non-JSON responses
      const text = await response.text();
      return text ? { data: text } : {};
    }

    return response.json();
  } catch (error) {
    clearTimeout(timeoutId);

    // Handle abort/timeout
    if (error.name === 'AbortError') {
      throw new ApiError(
        `Request timeout after ${timeout}ms`,
        408,
        'TIMEOUT'
      );
    }

    // Re-throw ApiError as-is
    if (error instanceof ApiError) {
      throw error;
    }

    // Handle network errors
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new ApiError(
        'Network error - server may be unavailable',
        0,
        'NETWORK_ERROR'
      );
    }

    // Wrap other errors
    throw new ApiError(
      error.message || 'Unknown error',
      0,
      'UNKNOWN_ERROR'
    );
  }
}

/**
 * Convenience methods for common HTTP methods
 */
export const api = {
  /**
   * GET request
   */
  get: (url, options = {}) => apiFetch(url, { ...options, method: 'GET' }),

  /**
   * POST request with JSON body
   */
  post: (url, data, options = {}) =>
    apiFetch(url, {
      ...options,
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /**
   * PUT request with JSON body
   */
  put: (url, data, options = {}) =>
    apiFetch(url, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  /**
   * DELETE request
   */
  delete: (url, options = {}) =>
    apiFetch(url, { ...options, method: 'DELETE' }),

  /**
   * PATCH request with JSON body
   */
  patch: (url, data, options = {}) =>
    apiFetch(url, {
      ...options,
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
};

/**
 * Validate IPv4 address format (for device IP validation)
 * @param {string} ip - IP address to validate
 * @returns {boolean} True if valid
 */
export function isValidIPv4(ip) {
  if (!ip || typeof ip !== 'string') return false;

  const parts = ip.split('.');
  if (parts.length !== 4) return false;

  return parts.every((p) => {
    const num = parseInt(p, 10);
    return !isNaN(num) && num >= 0 && num <= 255 && p === num.toString();
  });
}

/**
 * Format error for display
 * @param {Error} error - Error to format
 * @returns {string} User-friendly error message
 */
export function formatError(error) {
  if (error instanceof ApiError) {
    if (error.isTimeout()) {
      return 'Request timed out. Please try again.';
    }
    if (error.isNetworkError()) {
      return 'Cannot connect to server. Check if backend is running.';
    }
    if (error.isServerError()) {
      return `Server error: ${error.message}`;
    }
    return error.message;
  }

  return error.message || 'An unexpected error occurred';
}

export default apiFetch;
