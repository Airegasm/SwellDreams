/**
 * Migration script to convert monolithic characters.json to per-character file storage
 *
 * Usage: node migrate-characters.js
 *
 * This script:
 * 1. Reads existing characters.json
 * 2. Creates backend/data/chars/default/ for default characters
 * 3. Creates backend/data/chars/custom/ for personal characters
 * 4. Writes each character to its own file
 * 5. Creates chars-index.json with lightweight metadata
 * 6. Backs up original characters.json
 *
 * Default characters go to chars/default/ (committed to repo)
 * Custom characters go to chars/custom/ (gitignored)
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CHARS_DIR = path.join(DATA_DIR, 'chars');
const DEFAULT_DIR = path.join(CHARS_DIR, 'default');
const CUSTOM_DIR = path.join(CHARS_DIR, 'custom');

// Personal character IDs (go to custom/)
const CUSTOM_CHARACTER_IDS = [
  'char-006',  // Doctor Claudia
  'char-007',  // Bubbles
  'c74c9ace-2c54-4036-9ba0-c0924b7c7a08'  // Julie
];

console.log('=== Character Storage Migration ===\n');
console.log(`Data directory: ${DATA_DIR}`);
console.log(`Chars directory: ${CHARS_DIR}`);
console.log(`Default dir: ${DEFAULT_DIR}`);
console.log(`Custom dir: ${CUSTOM_DIR}\n`);

// Check if already migrated
if (fs.existsSync(CHARS_DIR) && fs.existsSync(path.join(CHARS_DIR, 'chars-index.json'))) {
  console.log('Migration already complete - chars directory and index exist.');
  console.log('To re-run migration, delete the chars/ directory first.');
  process.exit(0);
}

// Create directories
[CHARS_DIR, DEFAULT_DIR, CUSTOM_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
});

// Load existing characters.json
const charsPath = path.join(DATA_DIR, 'characters.json');
if (!fs.existsSync(charsPath)) {
  console.log('No characters.json found, nothing to migrate');
  // Create empty index
  fs.writeFileSync(path.join(CHARS_DIR, 'chars-index.json'), '[]');
  console.log('Created empty chars-index.json');
  process.exit(0);
}

let characters;
try {
  const content = fs.readFileSync(charsPath, 'utf8');
  characters = JSON.parse(content);
} catch (err) {
  console.error(`Error reading characters.json: ${err.message}`);
  process.exit(1);
}

if (!Array.isArray(characters)) {
  console.error('characters.json is not an array');
  process.exit(1);
}

console.log(`Found ${characters.length} characters to migrate\n`);

// Build index and write individual character files
const index = [];
let successCount = 0;
let errorCount = 0;
let defaultCount = 0;
let customCount = 0;

characters.forEach((char, i) => {
  if (!char.id) {
    console.error(`  [${i}] Skipping character without ID`);
    errorCount++;
    return;
  }

  try {
    // Determine if default or custom
    const isCustom = CUSTOM_CHARACTER_IDS.includes(char.id);
    const targetDir = isCustom ? CUSTOM_DIR : DEFAULT_DIR;
    const category = isCustom ? 'custom' : 'default';

    // Write individual character file
    const charPath = path.join(targetDir, `${char.id}.json`);
    fs.writeFileSync(charPath, JSON.stringify(char, null, 2));

    // Add to index
    index.push({
      id: char.id,
      name: char.name || 'Unnamed Character',
      category: category,
      description: char.description ? char.description.substring(0, 100) + '...' : ''
    });

    console.log(`  [${i + 1}/${characters.length}] ${char.id} - ${char.name} (${category})`);
    successCount++;
    if (isCustom) customCount++; else defaultCount++;
  } catch (err) {
    console.error(`  [${i + 1}/${characters.length}] ERROR: ${char.id} - ${err.message}`);
    errorCount++;
  }
});

// Write index file
const indexPath = path.join(CHARS_DIR, 'chars-index.json');
fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
console.log(`\nWrote chars-index.json with ${index.length} entries`);

// Backup original file
const backupPath = path.join(DATA_DIR, 'characters.json.backup');
try {
  fs.renameSync(charsPath, backupPath);
  console.log(`Backed up original characters.json to characters.json.backup`);
} catch (err) {
  console.error(`Warning: Could not backup original file: ${err.message}`);
}

console.log('\n=== Migration Complete ===');
console.log(`  Success: ${successCount}`);
console.log(`  Errors: ${errorCount}`);
console.log(`  Default characters: ${defaultCount}`);
console.log(`  Custom characters: ${customCount}`);
console.log(`  Index entries: ${index.length}`);
