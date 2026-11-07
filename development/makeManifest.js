#!/usr/bin/env node
// Writes the Homebrew Channel manifest for a built IPK.
// Usage: node development/makeManifest.js <path/to/ipk> [outdir]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const ipk = process.argv[2];
if (!ipk) {
  console.error('usage: makeManifest.js <ipk> [outdir]');
  process.exit(2);
}
const outDir = process.argv[3] || path.dirname(ipk);
const app = JSON.parse(fs.readFileSync(path.join(root, 'appinfo.json'), 'utf8'));
const repo = 'https://github.com/Shantil-K/HotsOff';

const manifest = {
  id: app.id,
  version: app.version,
  type: app.type,
  title: app.title,
  appDescription: 'Hotstar ad-block patcher',
  iconUri: 'https://raw.githubusercontent.com/Shantil-K/HotsOff/main/hotsoffLarge.png',
  sourceUrl: repo,
  rootRequired: true,
  ipkUrl: path.basename(ipk),
  ipkHash: { sha256: crypto.createHash('sha256').update(fs.readFileSync(ipk)).digest('hex') }
};

const out = path.join(outDir, app.id + '.manifest.json');
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
console.log('wrote ' + out);
