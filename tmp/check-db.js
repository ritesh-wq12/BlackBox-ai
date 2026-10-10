const fs = require('fs');
const dbPath = 'C:/Users/rites/devpost-ai-project/.blackbox/blackbox.db';
if (!fs.existsSync(dbPath)) {
  console.log('DB_FILE_MISSING');
  process.exit(0);
}
const bytes = fs.readFileSync(dbPath);
console.log('SIZE_BYTES', bytes.length);
const text = Buffer.from(bytes).toString('utf8');
const hasCommand = text.includes('type":"COMMAND');
const hasError = text.includes('type":"ERROR');
console.log('COMMAND_MARKER', hasCommand ? 'FOUND' : 'NONE');
console.log('ERROR_MARKER', hasError ? 'FOUND' : 'NONE');
if (!hasCommand && !hasError) {
  console.log('INTERPRETATION', 'Project db has no COMMAND/ERROR markers; server likely serves a different db, another project, or a different port session.');
}
