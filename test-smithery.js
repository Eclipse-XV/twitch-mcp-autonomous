#!/usr/bin/env node

/**
 * Simple script to test MCP server with Smithery CLI locally
 */

import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';

console.log('🧪 Testing MCP server with Smithery CLI...\n');

// Test 1: Build test
console.log('📦 Test 1: Build test');
const buildProcess = spawn('npx', ['@smithery/cli', 'build', 'src/index.ts'], {
  stdio: 'inherit',
  shell: true
});

buildProcess.on('close', async (buildCode) => {
  if (buildCode !== 0) {
    console.error('❌ Build test failed!');
    process.exit(1);
  }
  
  console.log('✅ Build test passed!\n');
  
  // Test 2: Dev server startup test (run for 5 seconds)
  console.log('🚀 Test 2: Dev server startup test (5 second run)');
  
  const devProcess = spawn('npx', ['@smithery/cli', 'dev', 'src/index.ts', '--no-open'], {
    stdio: 'inherit',
    shell: true
  });
  
  // Kill the dev server after 5 seconds
  setTimeout(5000).then(() => {
    devProcess.kill('SIGTERM');
    console.log('\n⏱️  Dev server test completed (5 seconds)');
    console.log('✅ If no errors appeared above, the server should deploy successfully to Smithery!');
    console.log('\n📝 Next steps:');
    console.log('   1. Push changes to GitHub');
    console.log('   2. Deploy manually through Smithery dashboard');
    console.log('   3. Monitor deployment logs');
  });
  
  devProcess.on('close', (devCode) => {
    // Expected to be killed, so don't check exit code
    process.exit(0);
  });
});

buildProcess.on('error', (error) => {
  console.error('❌ Build process error:', error);
  process.exit(1);
});
