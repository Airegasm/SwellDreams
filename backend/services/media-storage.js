/**
 * Media Storage Service
 * Handles storing images, videos, and audio files for the Media Album feature
 *
 * Folder structure:
 * backend/data/media/
 * ├── images/
 * │   ├── images-index.json
 * │   └── {uuid}.jpg
 * ├── videos/
 * │   ├── videos-index.json
 * │   └── {uuid}.{ext}
 * └── audio/
 *     ├── audio-index.json
 *     └── {uuid}.{ext}
 */

const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '..', 'data');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const IMAGES_DIR = path.join(MEDIA_DIR, 'images');
const VIDEOS_DIR = path.join(MEDIA_DIR, 'videos');
const AUDIO_DIR = path.join(MEDIA_DIR, 'audio');

const IMAGES_INDEX_FILE = path.join(IMAGES_DIR, 'images-index.json');
const VIDEOS_INDEX_FILE = path.join(VIDEOS_DIR, 'videos-index.json');
const AUDIO_INDEX_FILE = path.join(AUDIO_DIR, 'audio-index.json');

// Folder index files (store empty folders that have no items)
const IMAGES_FOLDERS_FILE = path.join(IMAGES_DIR, 'images-folders.json');
const VIDEOS_FOLDERS_FILE = path.join(VIDEOS_DIR, 'videos-folders.json');
const AUDIO_FOLDERS_FILE = path.join(AUDIO_DIR, 'audio-folders.json');

// Allowed formats
const ALLOWED_VIDEO_FORMATS = ['mp4', 'webm', 'mov'];
const ALLOWED_AUDIO_FORMATS = ['mp3', 'wav', 'ogg', 'm4a'];

// Size limits in bytes
const VIDEO_SIZE_LIMIT = 500 * 1024 * 1024; // 500MB
const AUDIO_SIZE_LIMIT = 100 * 1024 * 1024; // 100MB

/**
 * Ensure directory exists
 */
async function ensureDir(dirPath) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

/**
 * Initialize media directories
 */
async function initMediaDirectories() {
  await ensureDir(IMAGES_DIR);
  await ensureDir(VIDEOS_DIR);
  await ensureDir(AUDIO_DIR);
}

/**
 * Check if a string is a base64 data URI for an image
 */
function isBase64ImageDataUri(str) {
  return str && typeof str === 'string' && str.startsWith('data:image/');
}

/**
 * Extract image format and data from base64 data URI
 */
function parseBase64DataUri(dataUri) {
  const match = dataUri.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) return null;
  return {
    format: match[1] === 'jpeg' ? 'jpg' : match[1],
    data: match[2]
  };
}

/**
 * Get file extension from original filename or mimetype
 */
function getExtension(originalName, mimetype) {
  // Try to get from original filename
  if (originalName) {
    const ext = path.extname(originalName).toLowerCase().slice(1);
    if (ext) return ext;
  }
  // Fallback to mimetype
  if (mimetype) {
    const parts = mimetype.split('/');
    if (parts.length === 2) return parts[1];
  }
  return null;
}

// ==================== FOLDER HELPERS ====================

/**
 * Normalize folder path - ensure consistent format
 * null, undefined, empty string, "/" all become null (root)
 */
function normalizeFolder(folder) {
  if (!folder || folder === '/' || folder.trim() === '') return null;
  // Remove leading/trailing slashes and normalize
  return folder.replace(/^\/+|\/+$/g, '').trim() || null;
}

/**
 * Load folders index file
 */
async function loadFoldersIndex(file) {
  try {
    const data = await fs.readFile(file, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

/**
 * Save folders index file
 */
async function saveFoldersIndex(file, folders) {
  const dir = path.dirname(file);
  await ensureDir(dir);
  await fs.writeFile(file, JSON.stringify(folders, null, 2));
}

/**
 * Get all unique folders from items index + explicit folders
 */
function getAllFolders(itemsIndex, explicitFolders) {
  const folderSet = new Set(explicitFolders || []);
  for (const item of itemsIndex) {
    if (item.folder) {
      folderSet.add(item.folder);
      // Also add parent folders
      const parts = item.folder.split('/');
      for (let i = 1; i < parts.length; i++) {
        folderSet.add(parts.slice(0, i).join('/'));
      }
    }
  }
  return Array.from(folderSet).sort();
}

/**
 * Get subfolders of a given folder
 */
function getSubfolders(allFolders, parentFolder) {
  const parent = normalizeFolder(parentFolder);
  const prefix = parent ? parent + '/' : '';

  return allFolders.filter(f => {
    if (parent === null) {
      // Root level - folders without any slash
      return !f.includes('/');
    }
    // Subfolders - start with parent/ and don't have additional slashes after
    if (!f.startsWith(prefix)) return false;
    const remainder = f.slice(prefix.length);
    return remainder && !remainder.includes('/');
  });
}

// ==================== IMAGES ====================

/**
 * Load images index
 */
async function loadImagesIndex() {
  try {
    const data = await fs.readFile(IMAGES_INDEX_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

/**
 * Save images index
 */
async function saveImagesIndex(index) {
  await ensureDir(IMAGES_DIR);
  await fs.writeFile(IMAGES_INDEX_FILE, JSON.stringify(index, null, 2));
}

/**
 * Check if image tag is unique
 */
async function isImageTagUnique(tag, excludeId = null) {
  const index = await loadImagesIndex();
  return !index.some(img => img.tag === tag && img.id !== excludeId);
}

/**
 * Save a media image from base64 data
 * @param {string} base64Data - The base64 data URI
 * @param {string} orientation - 'portrait' or 'landscape'
 * @param {string} tag - Unique tag for the image
 * @param {string} description - Description of the image
 * @param {string} folder - Optional folder path
 * @returns {Object} The created image metadata
 */
async function saveMediaImage(base64Data, orientation, tag, description, folder = null) {
  // Validate tag uniqueness
  if (!(await isImageTagUnique(tag))) {
    throw new Error(`Tag "${tag}" already exists`);
  }

  if (!isBase64ImageDataUri(base64Data)) {
    throw new Error('Invalid image data');
  }

  const parsed = parseBase64DataUri(base64Data);
  if (!parsed) {
    throw new Error('Failed to parse image data');
  }

  const id = uuidv4();
  const filename = `${id}.${parsed.format}`;
  const filePath = path.join(IMAGES_DIR, filename);

  // Save file
  const buffer = Buffer.from(parsed.data, 'base64');
  await ensureDir(IMAGES_DIR);
  await fs.writeFile(filePath, buffer);

  // Create metadata
  const normalizedFolder = normalizeFolder(folder);
  const metadata = {
    id,
    tag,
    description,
    orientation,
    filename,
    folder: normalizedFolder,
    createdAt: new Date().toISOString()
  };

  // Update index
  const index = await loadImagesIndex();
  index.push(metadata);
  await saveImagesIndex(index);

  return metadata;
}

/**
 * Update image metadata (tag, description, and optionally folder)
 */
async function updateMediaImage(id, tag, description, folder = undefined) {
  const index = await loadImagesIndex();
  const imageIndex = index.findIndex(img => img.id === id);

  if (imageIndex === -1) {
    throw new Error('Image not found');
  }

  // Check tag uniqueness if tag changed
  if (tag !== index[imageIndex].tag && !(await isImageTagUnique(tag, id))) {
    throw new Error(`Tag "${tag}" already exists`);
  }

  index[imageIndex].tag = tag;
  index[imageIndex].description = description;
  // Only update folder if explicitly provided (allows moving to root with null)
  if (folder !== undefined) {
    index[imageIndex].folder = normalizeFolder(folder);
  }
  await saveImagesIndex(index);

  return index[imageIndex];
}

/**
 * Get all image folders
 */
async function getImageFolders() {
  const index = await loadImagesIndex();
  const explicitFolders = await loadFoldersIndex(IMAGES_FOLDERS_FILE);
  return getAllFolders(index, explicitFolders);
}

/**
 * Create an image folder
 */
async function createImageFolder(folderPath) {
  const normalized = normalizeFolder(folderPath);
  if (!normalized) throw new Error('Invalid folder path');

  const folders = await loadFoldersIndex(IMAGES_FOLDERS_FILE);
  if (!folders.includes(normalized)) {
    folders.push(normalized);
    folders.sort();
    await saveFoldersIndex(IMAGES_FOLDERS_FILE, folders);
  }
  return normalized;
}

/**
 * Rename an image folder (updates all items in that folder)
 */
async function renameImageFolder(oldPath, newPath) {
  const oldNorm = normalizeFolder(oldPath);
  const newNorm = normalizeFolder(newPath);
  if (!oldNorm || !newNorm) throw new Error('Invalid folder path');

  // Update all items in the folder (and subfolders)
  const index = await loadImagesIndex();
  for (const item of index) {
    if (item.folder === oldNorm) {
      item.folder = newNorm;
    } else if (item.folder && item.folder.startsWith(oldNorm + '/')) {
      item.folder = newNorm + item.folder.slice(oldNorm.length);
    }
  }
  await saveImagesIndex(index);

  // Update explicit folders list
  const folders = await loadFoldersIndex(IMAGES_FOLDERS_FILE);
  const newFolders = folders.map(f => {
    if (f === oldNorm) return newNorm;
    if (f.startsWith(oldNorm + '/')) return newNorm + f.slice(oldNorm.length);
    return f;
  });
  await saveFoldersIndex(IMAGES_FOLDERS_FILE, [...new Set(newFolders)].sort());

  return newNorm;
}

/**
 * Delete an image folder (moves items to root)
 */
async function deleteImageFolder(folderPath) {
  const normalized = normalizeFolder(folderPath);
  if (!normalized) throw new Error('Invalid folder path');

  // Move all items in folder to root
  const index = await loadImagesIndex();
  for (const item of index) {
    if (item.folder === normalized || (item.folder && item.folder.startsWith(normalized + '/'))) {
      item.folder = null;
    }
  }
  await saveImagesIndex(index);

  // Remove from explicit folders
  const folders = await loadFoldersIndex(IMAGES_FOLDERS_FILE);
  const newFolders = folders.filter(f => f !== normalized && !f.startsWith(normalized + '/'));
  await saveFoldersIndex(IMAGES_FOLDERS_FILE, newFolders);
}

/**
 * Delete a media image
 */
async function deleteMediaImage(id) {
  const index = await loadImagesIndex();
  const imageIndex = index.findIndex(img => img.id === id);

  if (imageIndex === -1) {
    throw new Error('Image not found');
  }

  const image = index[imageIndex];
  const filePath = path.join(IMAGES_DIR, image.filename);

  // Delete file
  try {
    await fs.unlink(filePath);
  } catch (err) {
    console.error(`Failed to delete image file: ${err.message}`);
  }

  // Update index
  index.splice(imageIndex, 1);
  await saveImagesIndex(index);
}

/**
 * Get image by ID
 */
async function getMediaImage(id) {
  const index = await loadImagesIndex();
  return index.find(img => img.id === id);
}

/**
 * Get image file path
 */
function getMediaImageFilePath(filename) {
  return path.join(IMAGES_DIR, filename);
}

// ==================== VIDEOS ====================

/**
 * Load videos index
 */
async function loadVideosIndex() {
  try {
    const data = await fs.readFile(VIDEOS_INDEX_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

/**
 * Save videos index
 */
async function saveVideosIndex(index) {
  await ensureDir(VIDEOS_DIR);
  await fs.writeFile(VIDEOS_INDEX_FILE, JSON.stringify(index, null, 2));
}

/**
 * Check if video tag is unique
 */
async function isVideoTagUnique(tag, excludeId = null) {
  const index = await loadVideosIndex();
  return !index.some(vid => vid.tag === tag && vid.id !== excludeId);
}

/**
 * Save a media video
 * @param {Buffer} buffer - The video file buffer
 * @param {string} originalName - Original filename
 * @param {string} mimetype - File mimetype
 * @param {string} tag - Unique tag for the video
 * @param {string} description - Description of the video
 * @param {string} folder - Optional folder path
 * @returns {Object} The created video metadata
 */
async function saveMediaVideo(buffer, originalName, mimetype, tag, description, folder = null) {
  // Validate tag uniqueness
  if (!(await isVideoTagUnique(tag))) {
    throw new Error(`Tag "${tag}" already exists`);
  }

  // Validate size
  if (buffer.length > VIDEO_SIZE_LIMIT) {
    throw new Error('Video exceeds 500MB size limit');
  }

  // Get and validate extension
  const ext = getExtension(originalName, mimetype);
  if (!ext || !ALLOWED_VIDEO_FORMATS.includes(ext.toLowerCase())) {
    throw new Error(`Invalid video format. Allowed: ${ALLOWED_VIDEO_FORMATS.join(', ')}`);
  }

  const id = uuidv4();
  const filename = `${id}.${ext.toLowerCase()}`;
  const filePath = path.join(VIDEOS_DIR, filename);

  // Save file
  await ensureDir(VIDEOS_DIR);
  await fs.writeFile(filePath, buffer);

  // Create metadata
  const normalizedFolder = normalizeFolder(folder);
  const metadata = {
    id,
    tag,
    description,
    filename,
    folder: normalizedFolder,
    createdAt: new Date().toISOString()
  };

  // Update index
  const index = await loadVideosIndex();
  index.push(metadata);
  await saveVideosIndex(index);

  return metadata;
}

/**
 * Update video metadata (tag, description, and optionally folder)
 */
async function updateMediaVideo(id, tag, description, folder = undefined) {
  const index = await loadVideosIndex();
  const videoIndex = index.findIndex(vid => vid.id === id);

  if (videoIndex === -1) {
    throw new Error('Video not found');
  }

  // Check tag uniqueness if tag changed
  if (tag !== index[videoIndex].tag && !(await isVideoTagUnique(tag, id))) {
    throw new Error(`Tag "${tag}" already exists`);
  }

  index[videoIndex].tag = tag;
  index[videoIndex].description = description;
  if (folder !== undefined) {
    index[videoIndex].folder = normalizeFolder(folder);
  }
  await saveVideosIndex(index);

  return index[videoIndex];
}

/**
 * Get all video folders
 */
async function getVideoFolders() {
  const index = await loadVideosIndex();
  const explicitFolders = await loadFoldersIndex(VIDEOS_FOLDERS_FILE);
  return getAllFolders(index, explicitFolders);
}

/**
 * Create a video folder
 */
async function createVideoFolder(folderPath) {
  const normalized = normalizeFolder(folderPath);
  if (!normalized) throw new Error('Invalid folder path');

  const folders = await loadFoldersIndex(VIDEOS_FOLDERS_FILE);
  if (!folders.includes(normalized)) {
    folders.push(normalized);
    folders.sort();
    await saveFoldersIndex(VIDEOS_FOLDERS_FILE, folders);
  }
  return normalized;
}

/**
 * Rename a video folder
 */
async function renameVideoFolder(oldPath, newPath) {
  const oldNorm = normalizeFolder(oldPath);
  const newNorm = normalizeFolder(newPath);
  if (!oldNorm || !newNorm) throw new Error('Invalid folder path');

  const index = await loadVideosIndex();
  for (const item of index) {
    if (item.folder === oldNorm) {
      item.folder = newNorm;
    } else if (item.folder && item.folder.startsWith(oldNorm + '/')) {
      item.folder = newNorm + item.folder.slice(oldNorm.length);
    }
  }
  await saveVideosIndex(index);

  const folders = await loadFoldersIndex(VIDEOS_FOLDERS_FILE);
  const newFolders = folders.map(f => {
    if (f === oldNorm) return newNorm;
    if (f.startsWith(oldNorm + '/')) return newNorm + f.slice(oldNorm.length);
    return f;
  });
  await saveFoldersIndex(VIDEOS_FOLDERS_FILE, [...new Set(newFolders)].sort());

  return newNorm;
}

/**
 * Delete a video folder
 */
async function deleteVideoFolder(folderPath) {
  const normalized = normalizeFolder(folderPath);
  if (!normalized) throw new Error('Invalid folder path');

  const index = await loadVideosIndex();
  for (const item of index) {
    if (item.folder === normalized || (item.folder && item.folder.startsWith(normalized + '/'))) {
      item.folder = null;
    }
  }
  await saveVideosIndex(index);

  const folders = await loadFoldersIndex(VIDEOS_FOLDERS_FILE);
  const newFolders = folders.filter(f => f !== normalized && !f.startsWith(normalized + '/'));
  await saveFoldersIndex(VIDEOS_FOLDERS_FILE, newFolders);
}

/**
 * Delete a media video
 */
async function deleteMediaVideo(id) {
  const index = await loadVideosIndex();
  const videoIndex = index.findIndex(vid => vid.id === id);

  if (videoIndex === -1) {
    throw new Error('Video not found');
  }

  const video = index[videoIndex];
  const filePath = path.join(VIDEOS_DIR, video.filename);

  // Delete file
  try {
    await fs.unlink(filePath);
  } catch (err) {
    console.error(`Failed to delete video file: ${err.message}`);
  }

  // Update index
  index.splice(videoIndex, 1);
  await saveVideosIndex(index);
}

/**
 * Get video by ID
 */
async function getMediaVideo(id) {
  const index = await loadVideosIndex();
  return index.find(vid => vid.id === id);
}

/**
 * Get video file path
 */
function getMediaVideoFilePath(filename) {
  return path.join(VIDEOS_DIR, filename);
}

// ==================== AUDIO ====================

/**
 * Load audio index
 */
async function loadAudioIndex() {
  try {
    const data = await fs.readFile(AUDIO_INDEX_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

/**
 * Save audio index
 */
async function saveAudioIndex(index) {
  await ensureDir(AUDIO_DIR);
  await fs.writeFile(AUDIO_INDEX_FILE, JSON.stringify(index, null, 2));
}

/**
 * Check if audio tag is unique
 */
async function isAudioTagUnique(tag, excludeId = null) {
  const index = await loadAudioIndex();
  return !index.some(aud => aud.tag === tag && aud.id !== excludeId);
}

/**
 * Save a media audio file
 * @param {Buffer} buffer - The audio file buffer
 * @param {string} originalName - Original filename
 * @param {string} mimetype - File mimetype
 * @param {string} tag - Unique tag for the audio
 * @param {string} description - Description of the audio
 * @param {string} folder - Optional folder path
 * @returns {Object} The created audio metadata
 */
async function saveMediaAudio(buffer, originalName, mimetype, tag, description, folder = null) {
  // Validate tag uniqueness
  if (!(await isAudioTagUnique(tag))) {
    throw new Error(`Tag "${tag}" already exists`);
  }

  // Validate size
  if (buffer.length > AUDIO_SIZE_LIMIT) {
    throw new Error('Audio exceeds 100MB size limit');
  }

  // Get and validate extension
  const ext = getExtension(originalName, mimetype);
  if (!ext || !ALLOWED_AUDIO_FORMATS.includes(ext.toLowerCase())) {
    throw new Error(`Invalid audio format. Allowed: ${ALLOWED_AUDIO_FORMATS.join(', ')}`);
  }

  const id = uuidv4();
  const filename = `${id}.${ext.toLowerCase()}`;
  const filePath = path.join(AUDIO_DIR, filename);

  // Save file
  await ensureDir(AUDIO_DIR);
  await fs.writeFile(filePath, buffer);

  // Create metadata
  const normalizedFolder = normalizeFolder(folder);
  const metadata = {
    id,
    tag,
    description,
    filename,
    folder: normalizedFolder,
    createdAt: new Date().toISOString()
  };

  // Update index
  const index = await loadAudioIndex();
  index.push(metadata);
  await saveAudioIndex(index);

  return metadata;
}

/**
 * Update audio metadata (tag, description, and optionally folder)
 */
async function updateMediaAudio(id, tag, description, folder = undefined) {
  const index = await loadAudioIndex();
  const audioIndex = index.findIndex(aud => aud.id === id);

  if (audioIndex === -1) {
    throw new Error('Audio not found');
  }

  // Check tag uniqueness if tag changed
  if (tag !== index[audioIndex].tag && !(await isAudioTagUnique(tag, id))) {
    throw new Error(`Tag "${tag}" already exists`);
  }

  index[audioIndex].tag = tag;
  index[audioIndex].description = description;
  if (folder !== undefined) {
    index[audioIndex].folder = normalizeFolder(folder);
  }
  await saveAudioIndex(index);

  return index[audioIndex];
}

/**
 * Get all audio folders
 */
async function getAudioFolders() {
  const index = await loadAudioIndex();
  const explicitFolders = await loadFoldersIndex(AUDIO_FOLDERS_FILE);
  return getAllFolders(index, explicitFolders);
}

/**
 * Create an audio folder
 */
async function createAudioFolder(folderPath) {
  const normalized = normalizeFolder(folderPath);
  if (!normalized) throw new Error('Invalid folder path');

  const folders = await loadFoldersIndex(AUDIO_FOLDERS_FILE);
  if (!folders.includes(normalized)) {
    folders.push(normalized);
    folders.sort();
    await saveFoldersIndex(AUDIO_FOLDERS_FILE, folders);
  }
  return normalized;
}

/**
 * Rename an audio folder
 */
async function renameAudioFolder(oldPath, newPath) {
  const oldNorm = normalizeFolder(oldPath);
  const newNorm = normalizeFolder(newPath);
  if (!oldNorm || !newNorm) throw new Error('Invalid folder path');

  const index = await loadAudioIndex();
  for (const item of index) {
    if (item.folder === oldNorm) {
      item.folder = newNorm;
    } else if (item.folder && item.folder.startsWith(oldNorm + '/')) {
      item.folder = newNorm + item.folder.slice(oldNorm.length);
    }
  }
  await saveAudioIndex(index);

  const folders = await loadFoldersIndex(AUDIO_FOLDERS_FILE);
  const newFolders = folders.map(f => {
    if (f === oldNorm) return newNorm;
    if (f.startsWith(oldNorm + '/')) return newNorm + f.slice(oldNorm.length);
    return f;
  });
  await saveFoldersIndex(AUDIO_FOLDERS_FILE, [...new Set(newFolders)].sort());

  return newNorm;
}

/**
 * Delete an audio folder
 */
async function deleteAudioFolder(folderPath) {
  const normalized = normalizeFolder(folderPath);
  if (!normalized) throw new Error('Invalid folder path');

  const index = await loadAudioIndex();
  for (const item of index) {
    if (item.folder === normalized || (item.folder && item.folder.startsWith(normalized + '/'))) {
      item.folder = null;
    }
  }
  await saveAudioIndex(index);

  const folders = await loadFoldersIndex(AUDIO_FOLDERS_FILE);
  const newFolders = folders.filter(f => f !== normalized && !f.startsWith(normalized + '/'));
  await saveFoldersIndex(AUDIO_FOLDERS_FILE, newFolders);
}

/**
 * Delete a media audio
 */
async function deleteMediaAudio(id) {
  const index = await loadAudioIndex();
  const audioIndex = index.findIndex(aud => aud.id === id);

  if (audioIndex === -1) {
    throw new Error('Audio not found');
  }

  const audio = index[audioIndex];
  const filePath = path.join(AUDIO_DIR, audio.filename);

  // Delete file
  try {
    await fs.unlink(filePath);
  } catch (err) {
    console.error(`Failed to delete audio file: ${err.message}`);
  }

  // Update index
  index.splice(audioIndex, 1);
  await saveAudioIndex(index);
}

/**
 * Get audio by ID
 */
async function getMediaAudio(id) {
  const index = await loadAudioIndex();
  return index.find(aud => aud.id === id);
}

/**
 * Get audio file path
 */
function getMediaAudioFilePath(filename) {
  return path.join(AUDIO_DIR, filename);
}

module.exports = {
  // Init
  initMediaDirectories,

  // Images
  loadImagesIndex,
  saveMediaImage,
  updateMediaImage,
  deleteMediaImage,
  getMediaImage,
  getMediaImageFilePath,
  isImageTagUnique,
  getImageFolders,
  createImageFolder,
  renameImageFolder,
  deleteImageFolder,

  // Videos
  loadVideosIndex,
  saveMediaVideo,
  updateMediaVideo,
  deleteMediaVideo,
  getMediaVideo,
  getMediaVideoFilePath,
  isVideoTagUnique,
  getVideoFolders,
  createVideoFolder,
  renameVideoFolder,
  deleteVideoFolder,
  ALLOWED_VIDEO_FORMATS,
  VIDEO_SIZE_LIMIT,

  // Audio
  loadAudioIndex,
  saveMediaAudio,
  updateMediaAudio,
  deleteMediaAudio,
  getMediaAudio,
  getMediaAudioFilePath,
  isAudioTagUnique,
  getAudioFolders,
  createAudioFolder,
  renameAudioFolder,
  deleteAudioFolder,
  ALLOWED_AUDIO_FORMATS,
  AUDIO_SIZE_LIMIT,

  // Directories
  MEDIA_DIR,
  IMAGES_DIR,
  VIDEOS_DIR,
  AUDIO_DIR
};
