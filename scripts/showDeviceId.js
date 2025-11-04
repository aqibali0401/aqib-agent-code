/**
 * Show Device ID
 * This script displays the device ID that will be used for IoT Hub registration
 * The device ID must match the CN (Common Name) in your X.509 certificate
 */

require('dotenv').config();
const si = require('systeminformation');

const DEVICE_TYPE = process.env.DEVICE_TYPE || 'AIO';

// Normalize function (same as device-id.ts)
const normalize = (value) => value.trim().replace(/\s+/g, '-');

async function getSystemInfo() {
  console.log('Collecting system information...\n');
  const system = await si.system();
  
  const model = system.model || 'MODEL';
  const serial = system.serial || system.uuid || 'SERIAL';
  
  console.log('System Information:');
  console.log('═'.repeat(60));
  console.log(`  Manufacturer: ${system.manufacturer}`);
  console.log(`  Model:        ${model}`);
  console.log(`  Serial:       ${serial}`);
  console.log(`  UUID:         ${system.uuid}`);
  console.log('═'.repeat(60));
  
  return { model, serial };
}

function generateDeviceId(model, serial) {
  const deviceId = `${normalize(DEVICE_TYPE)}_${normalize(model)}_${normalize(serial)}`;
  return deviceId;
}

async function main() {
  console.log('\nDevice ID Generator\n');
  
  try {
    const { model, serial } = await getSystemInfo();
    const deviceId = generateDeviceId(model, serial);
    
    console.log('\nGenerated Device ID:');
    console.log('═'.repeat(60));
    console.log(`\n  ${deviceId}\n`);
    console.log('═'.repeat(60));
    
    console.log('\nNext Steps:');
    console.log('  1. The Device ID above will be generated automatically at runtime');
    console.log('  2. You do NOT need to add DEVICE_ID to your .env file');
    console.log('  3. Ensure your X.509 certificate has this as the CN (Common Name)');
    console.log('  4. If you need to generate a certificate with this ID, run:');
    console.log('     node scripts/generateDynamicCert.js');
    console.log('\nNote: Device-specific variables (DEVICE_ID, X509_CERT_FILE, X509_KEY_FILE)');
    console.log('      are now set dynamically at runtime, not from .env file');
    console.log('═'.repeat(60));
    
  } catch (error) {
    console.error('\nError:', error.message);
    process.exit(1);
  }
}

// Run the script
main();

