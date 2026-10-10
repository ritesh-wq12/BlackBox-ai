const fs = require('fs');
const path = require('path');

const dbPath = path.resolve('C:/Users/rites/devpost-ai-project/.blackbox/blackbox.db');

console.log('=== Database File Check ===');
console.log('DB_PATH:', dbPath);
console.log('DB_EXISTS:', fs.existsSync(dbPath));

if (!fs.existsSync(dbPath)) {
  console.log('RESULT: Database file does not exist');
  process.exit(0);
}

const stats = fs.statSync(dbPath);
console.log('DB_SIZE_BYTES:', stats.size);
console.log('DB_LAST_MODIFIED:', stats.mtime.toISOString());

const content = fs.readFileSync(dbPath, 'utf8');
console.log('DB_ISVALID_UTF8:', content.length > 0);
console.log('DB_STARTS_SQLITE:', content.startsWith('SQLite format 3'));

// Search for all event type markers in the raw text
const eventTypes = ['COMMAND', 'ERROR', 'FILE', 'GIT', 'SESSION'];
const typeCounts = {};
for (const type of eventTypes) {
  const pattern = `"type":"${type}"`;
  const count = (content.match(new RegExp(pattern, 'g')) || []).length;
  typeCounts[type] = count;
  console.log(`TYPE_${type}_COUNT:`, count);
}

const hasAnyEvent = eventTypes.some(t => typeCounts[t] > 0);
console.log('HAS_ANY_EVENT_TYPE:', hasAnyEvent ? 'YES' : 'NO');

if (hasAnyEvent) {
  console.log('EVENT_TYPE_BREAKDOWN:', JSON.stringify(typeCounts));
} else {
  console.log('NOTE: No event type markers found in raw file text.');
  console.log('This could mean:');
  console.log('1. Events are stored in a different database file');
  console.log('2. The database uses a different serialization format');
  console.log('3. The server is serving a different database than this file');
}

// Also check for any JSON-like patterns
const jsonPatterns = [
  { name: 'id_field', pattern: /"id"\s*:\s*"[^"]+"/ },
  { name: 'timestamp_field', pattern: /"timestamp"\s*:\s*"[^"]+"/ },
  { name: 'summary_field', pattern: /"summary"\s*:\s*"[^"]*"/ },
  { name: 'project_field', pattern: /"project"\s*:\s*"[^"]+"/ },
  { name: 'sessionId_field', pattern: /"sessionId"\s*:\s*"[^"]+"/ },
];

console.log('\n=== JSON Field Pattern Check ===');
let hasAnyJsonField = false;
for (const { name, pattern } of jsonPatterns) {
  const found = pattern.test(content);
  console.log(`${name}:`, found ? 'FOUND' : 'NONE');
  if (found) hasAnyJsonField = true;
}
console.log('HAS_ANY_JSON_FIELD:', hasAnyJsonField ? 'YES' : 'NO');

console.log('\n=== Summary ===');
console.log('If HAS_ANY_EVENT_TYPE is NO and HAS_ANY_JSON_FIELD is NO,');
console.log('the database file likely does not contain the expected events.');
console.log('This would confirm the server is using a different database.');
