/**
 * Validation Middleware for SwellDreams Backend
 */

const validators = require('../utils/validators');

/**
 * Create validation middleware for request body
 * @param {Function} validatorFn - Validator function that returns errors array or null
 * @returns {Function} Express middleware
 */
function validateBody(validatorFn) {
  return (req, res, next) => {
    const errors = validatorFn(req.body);
    if (errors) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors
      });
    }
    next();
  };
}

/**
 * Validate device in request body
 */
const validateDevice = validateBody(validators.validateDevice);

/**
 * Validate character in request body
 */
const validateCharacter = validateBody(validators.validateCharacter);

/**
 * Validate persona in request body
 */
const validatePersona = validateBody(validators.validatePersona);

/**
 * Validate flow in request body
 */
const validateFlow = validateBody(validators.validateFlow);

/**
 * Validate session state update in request body
 */
const validateSessionState = validateBody(validators.validateSessionState);

/**
 * Validate required fields are present
 * @param {string[]} fields - Array of required field names
 * @returns {Function} Express middleware
 */
function requireFields(...fields) {
  return (req, res, next) => {
    const missing = fields.filter(field => {
      const value = req.body[field];
      return value === undefined || value === null || value === '';
    });

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        details: missing.map(field => ({ field, message: `${field} is required` }))
      });
    }
    next();
  };
}

/**
 * Validate ID parameter is present and non-empty
 */
function validateIdParam(req, res, next) {
  const id = req.params.id;
  if (!id || typeof id !== 'string' || id.trim() === '') {
    return res.status(400).json({
      success: false,
      error: 'Invalid or missing ID parameter'
    });
  }
  next();
}

/**
 * Sanitize string fields in request body
 * @param {string[]} fields - Fields to sanitize
 * @param {number} maxLength - Maximum length for each field
 */
function sanitizeFields(fields, maxLength = 10000) {
  return (req, res, next) => {
    for (const field of fields) {
      if (req.body[field] !== undefined) {
        req.body[field] = validators.sanitizeString(req.body[field], maxLength);
      }
    }
    next();
  };
}

module.exports = {
  validateBody,
  validateDevice,
  validateCharacter,
  validatePersona,
  validateFlow,
  validateSessionState,
  requireFields,
  validateIdParam,
  sanitizeFields
};
