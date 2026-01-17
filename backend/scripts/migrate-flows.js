/**
 * Migration script to convert monolithic flows.json to per-flow file storage
 *
 * Usage: node migrate-flows.js
 *
 * This script:
 * 1. Reads existing flows.json
 * 2. Creates backend/data/flows/ directory
 * 3. Writes each flow to its own file: flows/{flowId}.json
 * 4. Creates flows-index.json with lightweight metadata
 * 5. Backs up original flows.json as flows.json.backup
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FLOWS_DIR = path.join(DATA_DIR, 'flows');

console.log('=== Flow Storage Migration ===\n');
console.log(`Data directory: ${DATA_DIR}`);
console.log(`Flows directory: ${FLOWS_DIR}\n`);

// Check if already migrated
if (fs.existsSync(FLOWS_DIR) && fs.existsSync(path.join(FLOWS_DIR, 'flows-index.json'))) {
  console.log('Migration already complete - flows directory and index exist.');
  console.log('To re-run migration, delete the flows/ directory first.');
  process.exit(0);
}

// Create flows directory
if (!fs.existsSync(FLOWS_DIR)) {
  fs.mkdirSync(FLOWS_DIR, { recursive: true });
  console.log('Created flows directory');
}

// Load existing flows.json
const flowsPath = path.join(DATA_DIR, 'flows.json');
if (!fs.existsSync(flowsPath)) {
  console.log('No flows.json found, nothing to migrate');
  // Create empty index
  fs.writeFileSync(path.join(FLOWS_DIR, 'flows-index.json'), '[]');
  console.log('Created empty flows-index.json');
  process.exit(0);
}

let flows;
try {
  const content = fs.readFileSync(flowsPath, 'utf8');
  flows = JSON.parse(content);
} catch (err) {
  console.error(`Error reading flows.json: ${err.message}`);
  process.exit(1);
}

if (!Array.isArray(flows)) {
  console.error('flows.json is not an array');
  process.exit(1);
}

console.log(`Found ${flows.length} flows to migrate\n`);

// Build index and write individual flow files
const index = [];
let successCount = 0;
let errorCount = 0;

flows.forEach((flow, i) => {
  if (!flow.id) {
    console.error(`  [${i}] Skipping flow without ID`);
    errorCount++;
    return;
  }

  try {
    // Write individual flow file
    const flowPath = path.join(FLOWS_DIR, `${flow.id}.json`);
    fs.writeFileSync(flowPath, JSON.stringify(flow, null, 2));

    // Add to index
    index.push({
      id: flow.id,
      name: flow.name || 'Untitled Flow',
      characterId: flow.characterId || null,
      description: flow.description || ''
    });

    console.log(`  [${i + 1}/${flows.length}] ${flow.id} - ${flow.name || 'Untitled'}`);
    successCount++;
  } catch (err) {
    console.error(`  [${i + 1}/${flows.length}] ERROR: ${flow.id} - ${err.message}`);
    errorCount++;
  }
});

// Write index file
const indexPath = path.join(FLOWS_DIR, 'flows-index.json');
fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
console.log(`\nWrote flows-index.json with ${index.length} entries`);

// Backup original file
const backupPath = path.join(DATA_DIR, 'flows.json.backup');
try {
  fs.renameSync(flowsPath, backupPath);
  console.log(`Backed up original flows.json to flows.json.backup`);
} catch (err) {
  console.error(`Warning: Could not backup original file: ${err.message}`);
}

console.log('\n=== Migration Complete ===');
console.log(`  Success: ${successCount}`);
console.log(`  Errors: ${errorCount}`);
console.log(`  Index entries: ${index.length}`);
