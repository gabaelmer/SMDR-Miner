import { SMDRParser } from '../backend/parser/SMDRParser';

const parser = new SMDRParser();
const ITERATIONS = 200_000;

function generate(i: number): string {
  return `2026-02-17 14:${String(i % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')} 00:00:45 1001 2002 T001 +12345678901 ACC:${
    1000 + (i % 500)
  } A CID:${i} SEQ:${i} OLI:01`;
}

const startHeap = process.memoryUsage().heapUsed;

for (let i = 0; i < ITERATIONS; i += 1) {
  parser.parse(generate(i));
}

const runtime = globalThis as { gc?: () => void };
if (runtime.gc) {
  runtime.gc();
}

const endHeap = process.memoryUsage().heapUsed;
const diffMb = (endHeap - startHeap) / (1024 * 1024);

console.log(`Memory test complete. heap delta: ${diffMb.toFixed(2)} MB over ${ITERATIONS} records.`);
console.log('Note: run with node --expose-gc for deterministic GC behavior.');
