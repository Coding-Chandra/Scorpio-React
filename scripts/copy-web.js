/**
 * copy-web.js
 * ──────────────────────────────────────────────────────────────────────────────
 * Copies the web app source files into the `www/` directory that Capacitor
 * uses as `webDir`. This lets you keep your source at the repo root and 
 * Capacitor's output separate.
 *
 * Excludes: node_modules, android, www, .git, package*, capacitor*, scripts
 * Preserves: capacitor-bridge.js, capacitor-native.css, error.html in www/
 * ──────────────────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WWW = path.join(ROOT, 'www');

const EXCLUDE = new Set([
  'node_modules', 'android', 'www', '.git', '.github', 'scripts',
  'package.json', 'package-lock.json',
  'capacitor.config.json', 'capacitor.config.ts',
  'structure.ini', 'working of sw'
]);

// Files that live only in www/ and should NOT be deleted
const WWW_ONLY = new Set([
  'capacitor-bridge.js',
  'capacitor-native.css',
  'error.html',
  'vendor'
]);

function shouldSkip(name) {
  if (name.startsWith('.') && name !== '.well-known') return true;
  if (name.endsWith('.backup.old') || name.endsWith('.bak') || name.endsWith('.old') || name.endsWith('.tmp')) return true;
  if (name === 'structure.ini' || name === 'working of sw' || name === 'Thumbs.db' || name === '.DS_Store') return true;
  return false;
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      if (shouldSkip(entry)) continue;
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

function cleanWww() {
  if (!fs.existsSync(WWW)) {
    fs.mkdirSync(WWW, { recursive: true });
    return;
  }
  for (const entry of fs.readdirSync(WWW)) {
    if (WWW_ONLY.has(entry)) continue;
    const full = path.join(WWW, entry);
    fs.rmSync(full, { recursive: true, force: true });
  }
}

function main() {
  console.log('[copy-web] Cleaning www/ ...');
  cleanWww();

  console.log('[copy-web] Copying source files → www/ ...');
  for (const entry of fs.readdirSync(ROOT)) {
    if (EXCLUDE.has(entry) || shouldSkip(entry)) continue;
    const src = path.join(ROOT, entry);
    const dest = path.join(WWW, entry);
    copyRecursive(src, dest);
  }

  console.log('[copy-web] ✓ Done.');
}

main();
