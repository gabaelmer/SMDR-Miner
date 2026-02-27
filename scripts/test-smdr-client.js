#!/usr/bin/env node
/**
 * SMDR Client Test - Connects TO MiVB (like the app does)
 */

import net from 'node:net';

const MIVB_IP = process.env.MIVB_IP || '192.168.0.52';
const MIVB_PORT = parseInt(process.env.MIVB_PORT || '1752', 10);

console.log('=== SMDR Client Test (TCP Client Mode) ===\n');
console.log(`Connecting to MiVB: ${MIVB_IP}:${MIVB_PORT}`);
console.log('\nInstructions:');
console.log('1. Keep this running');
console.log('2. Make a test call from any extension');
console.log('3. Watch for SMDR data below');
console.log('4. Press Ctrl+C to exit\n');

const socket = new net.Socket();
let connected = false;
let dataCount = 0;
let recordCount = 0;

socket.setKeepAlive(true, 10000);
socket.setTimeout(30000);

socket.on('connect', () => {
  connected = true;
  console.log(`✓ Connected to MiVB ${MIVB_IP}:${MIVB_PORT}`);
  console.log('Waiting for SMDR data (make a test call)...\n');
});

socket.on('data', (data) => {
  dataCount++;
  const text = data.toString('utf8');
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  
  console.log(`\n--- Data Packet ${dataCount} (${lines.length} lines) ---`);
  
  lines.forEach((line, i) => {
    console.log(`  [${i + 1}] ${line}`);
    
    // Identify call records
    if (line.match(/^\d/)) {
      recordCount++;
      const parts = line.split(/\s+/);
      if (parts.length >= 5) {
        console.log(`       ✓ CALL RECORD: ${parts[3]} -> ${parts[4]} (${parts[2] || 'unknown duration'})`);
      }
    } else if (line.startsWith('%')) {
      console.log(`       → Header/continuation line`);
    }
  });
});

socket.on('timeout', () => {
  console.log('\n✗ Connection timeout (30s no data)');
  console.log('This is normal if no calls were made.');
  console.log('The connection is still active - MiVB only sends data when calls occur.\n');
  socket.setTimeout(60000); // Extend timeout
});

socket.on('error', (err) => {
  console.error(`\n✗ Socket error: ${err.message}`);
  console.error(`\nTroubleshooting:`);
  console.error(`1. Verify MiVB SMDR service is enabled`);
  console.error(`2. Check MiVB allows TCP connections on port ${MIVB_PORT}`);
  console.error(`3. Verify network connectivity to ${MIVB_IP}`);
  process.exit(1);
});

socket.on('close', (hadError) => {
  console.log(`\n✗ Connection closed`);
  console.log(`  Had error: ${hadError}`);
  console.log(`  Total packets: ${dataCount}`);
  console.log(`  Total records detected: ${recordCount}`);
  process.exit(0);
});

console.log('Connecting...');
socket.connect(MIVB_PORT, MIVB_IP);

process.on('SIGINT', () => {
  console.log(`\n\nTest ended`);
  console.log(`  Packets received: ${dataCount}`);
  console.log(`  Call records detected: ${recordCount}`);
  socket.destroy();
  process.exit(0);
});
