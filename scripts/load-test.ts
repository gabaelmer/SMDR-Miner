import fs from 'node:fs';
import path from 'node:path';
import { DatabaseService } from '../backend/db/DatabaseService';
import { SMDRParser } from '../backend/parser/SMDRParser';

const TOTAL = 75_000;
const tempDb = path.join('/tmp', `smdr-insight-load-${Date.now()}.sqlite`);

const parser = new SMDRParser();
const db = new DatabaseService(tempDb);
db.init();

const start = Date.now();
let inserted = 0;
let rejected = 0;

for (let i = 0; i < TOTAL; i += 1) {
  const line = `${new Date().toISOString().slice(0, 10)} 08:01:3${i % 10} 00:01:${String(i % 60).padStart(2, '0')} 1001 9${String(
    100000000 + i
  )} T001 +12345678901 ACC:${10000 + i} A CID:${i} SEQ:${i} ACID:${i - 1} OLI:01`;

  const parsed = parser.parse(line);
  if (parsed.record) {
    db.insertRecord(parsed.record);
    inserted += 1;
  } else {
    rejected += 1;
  }
}

const elapsed = Date.now() - start;
console.log(`Load test complete. inserted=${inserted} rejected=${rejected} elapsedMs=${elapsed}`);
console.log(`Rate: ${(inserted / (elapsed / 1000)).toFixed(2)} records/sec`);

const records = db.getRecords({ limit: 5 });
console.log(`Sample records fetched: ${records.length}`);

db.close();
fs.unlinkSync(tempDb);
