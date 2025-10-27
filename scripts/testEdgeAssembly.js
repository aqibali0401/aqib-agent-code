/**
 * Test Edge Assembly Integration
 * This script helps verify your Edge Assembly setup
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

console.log('\n🧪 Edge Assembly Integration Test\n');
console.log('═'.repeat(70));

let allChecksPassed = true;

// Check 1: .env file exists
console.log('\n📋 Check 1: Environment Configuration');
console.log('─'.repeat(70));

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  console.log('  ✅ .env file exists');
} else {
  console.log('  ❌ .env file not found');
  allChecksPassed = false;
}

// Check 2: Required environment variables
console.log('\n📋 Check 2: Required Environment Variables');
console.log('─'.repeat(70));

const requiredVars = [
  'DEVICE_ID',
  'USE_CERTIFICATE_AUTH',
  'X509_CERT_FILE',
  'X509_KEY_FILE',
  'DPS_PROVISIONING_HOST',
  'DPS_ID_SCOPE',
  'DPS_SECURITY_TYPE',
  'DPS_TRANSPORT_TYPE',
  'USE_WEBSOCKETS',
];

requiredVars.forEach(varName => {
  const value = process.env[varName];
  if (value && value !== 'your-device-id' && value !== '0ne00XXXXXX') {
    console.log(`  ✅ ${varName}: ${value}`);
  } else {
    console.log(`  ❌ ${varName}: Not set or using default value`);
    allChecksPassed = false;
  }
});

// Check 3: Feature flag
console.log('\n📋 Check 3: Feature Flag');
console.log('─'.repeat(70));

const useEdgeAssembly = process.env.USE_EDGE_ASSEMBLY;
if (useEdgeAssembly === 'true') {
  console.log('  ✅ USE_EDGE_ASSEMBLY: true (Edge Assembly enabled)');
} else if (useEdgeAssembly === 'false') {
  console.log('  ⚠️  USE_EDGE_ASSEMBLY: false (Using legacy IoT service)');
  console.log('     Set USE_EDGE_ASSEMBLY=true to use Edge Assembly');
} else {
  console.log('  ❌ USE_EDGE_ASSEMBLY: Not set');
  console.log('     Add USE_EDGE_ASSEMBLY=true to your .env file');
  allChecksPassed = false;
}

// Check 4: Certificate files
console.log('\n📋 Check 4: X.509 Certificate Files');
console.log('─'.repeat(70));

const certFile = process.env.X509_CERT_FILE;
const keyFile = process.env.X509_KEY_FILE;

if (certFile) {
  const certPath = path.join(__dirname, '..', certFile);
  if (fs.existsSync(certPath)) {
    console.log(`  ✅ Certificate file exists: ${certFile}`);
  } else {
    console.log(`  ❌ Certificate file not found: ${certFile}`);
    console.log('     Run: node scripts/generateDynamicCert.js');
    allChecksPassed = false;
  }
}

if (keyFile) {
  const keyPath = path.join(__dirname, '..', keyFile);
  if (fs.existsSync(keyPath)) {
    console.log(`  ✅ Key file exists: ${keyFile}`);
  } else {
    console.log(`  ❌ Key file not found: ${keyFile}`);
    console.log('     Run: node scripts/generateDynamicCert.js');
    allChecksPassed = false;
  }
}

// Check 5: Build directory
console.log('\n📋 Check 5: Build Status');
console.log('─'.repeat(70));

const distPath = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distPath)) {
  console.log('  ✅ dist/ directory exists (application has been built)');
} else {
  console.log('  ⚠️  dist/ directory not found');
  console.log('     Run: npm run build');
}

// Check 6: Edge Assembly module
console.log('\n📋 Check 6: Edge Assembly Files');
console.log('─'.repeat(70));

const edgeAssemblyService = path.join(__dirname, '..', 'src', 'edge-assembly', 'edge-assembly.service.ts');
const edgeAssemblyModule = path.join(__dirname, '..', 'src', 'edge-assembly', 'edge-assembly.module.ts');

if (fs.existsSync(edgeAssemblyService)) {
  console.log('  ✅ EdgeAssemblyService created');
} else {
  console.log('  ❌ EdgeAssemblyService not found');
  allChecksPassed = false;
}

if (fs.existsSync(edgeAssemblyModule)) {
  console.log('  ✅ EdgeAssemblyModule created');
} else {
  console.log('  ❌ EdgeAssemblyModule not found');
  allChecksPassed = false;
}

// Check 7: Package installation
console.log('\n📋 Check 7: Package Installation');
console.log('─'.repeat(70));

const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

const requiredPackages = [
  '@qsc/edge-assembly',
];

requiredPackages.forEach(pkg => {
  if (packageJson.dependencies && packageJson.dependencies[pkg]) {
    console.log(`  ✅ ${pkg} installed (v${packageJson.dependencies[pkg]})`);
  } else {
    console.log(`  ❌ ${pkg} not installed`);
    console.log('     Run: npm install @qsc/edge-assembly');
    allChecksPassed = false;
  }
});

// Summary
console.log('\n' + '═'.repeat(70));
console.log('\n📊 Test Summary');
console.log('─'.repeat(70));

if (allChecksPassed) {
  console.log('\n  ✅ All checks passed! Your Edge Assembly integration is ready.');
  console.log('\n  🚀 Next steps:');
  console.log('     1. Build the application: npm run build');
  console.log('     2. Run the application: npm run dev');
  console.log('     3. Check the console for connection status');
  console.log('     4. Test commands from Azure Portal/CLI');
} else {
  console.log('\n  ⚠️  Some checks failed. Please review the errors above.');
  console.log('\n  📚 Documentation:');
  console.log('     - QUICK_START_EDGE_ASSEMBLY.md');
  console.log('     - EDGE_ASSEMBLY_INTEGRATION.md');
}

console.log('\n' + '═'.repeat(70) + '\n');

process.exit(allChecksPassed ? 0 : 1);

