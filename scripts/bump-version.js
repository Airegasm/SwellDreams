#!/usr/bin/env node
// Bump the app version in all four canonical spots in one shot.
//   node scripts/bump-version.js 6.9.10          — write version everywhere
//   node scripts/bump-version.js 6.9.10 --build  — ...and rebuild the frontend
// Spots: version.json, backend/package.json, frontend/package.json, App.js version badge.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ver = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(ver || '')) {
  console.error('Usage: node scripts/bump-version.js <x.y.z> [--build]');
  process.exit(1);
}
const root = path.join(__dirname, '..');

for (const rel of ['version.json', 'backend/package.json', 'frontend/package.json']) {
  const p = path.join(root, rel);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  j.version = ver;
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  console.log(`✓ ${rel}`);
}

const appJs = path.join(root, 'frontend', 'src', 'App.js');
const src = fs.readFileSync(appJs, 'utf8');
const next = src.replace(/(className="version-badge">v)\d+\.\d+\.\d+/, `$1${ver}`);
if (next === src) {
  console.error('✗ version-badge not found in frontend/src/App.js — badge not updated');
  process.exit(1);
}
fs.writeFileSync(appJs, next);
console.log('✓ frontend/src/App.js (version badge)');

if (process.argv.includes('--build')) {
  console.log('Building frontend...');
  cp.execSync('npm run build', { cwd: path.join(root, 'frontend'), stdio: 'inherit' });
}
console.log(`Version is now ${ver}`);
