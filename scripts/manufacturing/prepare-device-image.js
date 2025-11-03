#!/usr/bin/env node
/**
 * Prepare Device Image: Copy only public Intermediate CA (no private keys)
 *
 * Usage env:
 *   INTERMEDIATE_PEM_PATH  (required) path to intermediate.pem
 *   OUTPUT_DIR             (optional) default: image-files/ca
 */

const fs = require('fs');
const path = require('path');

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function main() {
  const INTERMEDIATE_PEM_PATH = requireEnv('INTERMEDIATE_PEM_PATH');
  const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join('image-files', 'ca');

  const src = path.resolve(INTERMEDIATE_PEM_PATH);
  const dstDir = path.resolve(OUTPUT_DIR);
  const dst = path.join(dstDir, 'intermediate.pem');

  if (!fs.existsSync(src)) {
    throw new Error(`Source intermediate.pem not found at ${src}`);
  }

  if (!fs.existsSync(dstDir)) {
    fs.mkdirSync(dstDir, { recursive: true });
  }

  fs.copyFileSync(src, dst);
  console.log(`✅ Copied public Intermediate CA to ${dst}`);
  console.log('Ensure NO private keys are baked into the device image.');
}

try {
  main();
} catch (err) {
  console.error('❌ prepare-device-image failed:', err?.message || err);
  process.exit(1);
}


