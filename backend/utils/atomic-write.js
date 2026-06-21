'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Atomically write contents to filePath.
 * Writes to <file>.tmp in the same directory, fsyncs it, rolls one backup
 * (<file>.bak) of any existing target, then renames the tmp over the target.
 * Cleans up the tmp file on failure. Throws on failure.
 *
 * @param {string} filePath
 * @param {string|Buffer} contents
 */
function atomicWriteFileSync(filePath, contents) {
  const tmpPath = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, contents);

    // Flush tmp file contents to disk before rename. Best-effort: the data is already written
    // by writeFileSync — fsync only adds hard crash/power-loss durability. Some filesystems
    // (network/mapped drives, certain Windows setups) reject fsync with EPERM/ENOTSUP/EINVAL;
    // skipping the flush there is far better than failing every save.
    try {
      const fd = fs.openSync(tmpPath, 'r');
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    } catch (e) {
      // fsync unsupported/not permitted on this filesystem — the write itself still succeeded.
    }

    // Roll one backup of the current target before overwriting.
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, filePath + '.bak');
    }

    fs.renameSync(tmpPath, filePath);

    // fsync the containing directory so the rename (directory entry) is durable
    // across a hard crash/power-loss. Best-effort: some platforms (e.g. Windows)
    // don't permit opening a directory for fsync, so ignore failures.
    try {
      const dirFd = fs.openSync(path.dirname(filePath), 'r');
      try {
        fs.fsyncSync(dirFd);
      } finally {
        fs.closeSync(dirFd);
      }
    } catch (e) {
      // Directory fsync unsupported/failed — the rename itself already happened.
    }
  } finally {
    // Clean up the tmp file if it is still around (e.g. rename failed).
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch (e) {
        // Best-effort cleanup; ignore.
      }
    }
  }
}

/**
 * Atomically write obj as pretty-printed JSON to filePath.
 *
 * @param {string} filePath
 * @param {*} obj
 */
function atomicWriteJson(filePath, obj) {
  atomicWriteFileSync(filePath, JSON.stringify(obj, null, 2));
}

module.exports = {
  atomicWriteFileSync,
  atomicWriteJson,
};
