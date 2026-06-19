'use strict';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Return true when id is a safe identifier usable in filesystem paths.
 *
 * @param {*} id
 * @returns {boolean}
 */
function isSafeId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

/**
 * Throw when id is not a safe identifier.
 *
 * @param {*} id
 */
function assertSafeId(id) {
  if (!isSafeId(id)) {
    throw new Error('Invalid id');
  }
}

module.exports = {
  isSafeId,
  assertSafeId,
};
