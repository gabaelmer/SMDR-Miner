#!/usr/bin/env node
/**
 * Direct SMDR Connection Test
 * Tests raw TCP connection to MiVB without any web UI or database
 */

import net from 'node:net';

// Configuration - UPDATE THESE FOR YOUR SETUP
const MIVB_IP = process.env.MIVB_IP || '192.168.1.100'; // Your MiVB IP
const MIVB_PORT = parseInt(process.env.MIVB_PORT || '1752', 10);

console.log('=== SMDR Direct Connection Test ===\n');
console.log(`Target: ${MIVB_IP}:${MIVB_PORT}\n`);
console.log('Instructions:');
console.log('1. Make sure MiVB SMDR is configured to send to this machine IP');
console.log('2. Make a test call after connection is established');
console.log('3. Press Ctrl+C to exit\n');

const socket = new net.Socket();
let connected = false;
let dataCount = 0;

socket.setTimeout(10000);

socket.on('connect', () => {
  connected = true;
  console.log(`✓ Connected to ${MIVB_IP}:${MIVB_PORT}`);
  console.log('Waiting for SMDR data...\n');
});

socket.on('data', (data) => {
  dataCount++;
  const lines = data.toString('utf8').split(/\r?\n/).filter(l => l.trim());
  
  console.log(`--- Data Packet ${dataCount} (${lines.length} lines) ---`);
  lines.forEach((line, i) => {
    console.log(`  [${i + 1}] ${line}`);
    
    // Try to identify record type
    if (line.match(/^\d/)) {
      const parts = line.split(/\s+/);
      if (parts.length >= 5) {
        console.log(`       → Likely call record: ${parts[3]} -> ${parts[4]}`);
      }
    } else if (line.startsWith('%')) {
      console.log(`       → Header/continuation line`);
    }
  });
  console.log('');
});

socket.on('timeout', () => {
  console.log('✗ Connection timeout (10s no data)');
  socket.destroy();
  process.exit(1);
});

socket.on('error', (err) => {
  console.error(`✗ Socket error: ${err.message}`);
  console.error(`\nTroubleshooting:`);
  console.error(`1. Verify MiVB IP is correct: ${MIVB_IP}`);
  console.error(`2. Verify MiVB SMDR is enabled and configured`);
  console.error(`3. Check firewall allows port ${MIVB_PORT}`);
  console.error(`4. Verify MiVB is configured to send SMDR to YOUR machine IP`);
  process.exit(1);
});

socket.on('close', (hadError) => {
  if (connected) {
    console.log(`\n✗ Connection closed (hadError: ${hadError})`);
    console.log('MiVB may have stopped sending or network issue occurred.');
  }
  process.exit(connected ? 0 : 1);
});

console.log('Connecting...');
socket.connect(MIVB_PORT, MIVB_IP);

// Keep process alive
process.on('SIGINT', () => {
  console.log('\n\nTest interrupted by user');
  socket.destroy();
  process.exit(0);
});
