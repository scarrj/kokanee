// Usage: node test_model.mjs <path-to-routes.json>
// Validates an App JSON file with web/js/model.js and prints PASS or the errors.
import { readFileSync } from 'node:fs';
import { validate } from '../web/js/model.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: node test_model.mjs <routes.json>');
  process.exit(2);
}
const app = JSON.parse(readFileSync(file, 'utf8'));
const { ok, errors } = validate(app);
if (ok) {
  console.log('PASS');
} else {
  for (const e of errors) console.log('ERROR:', e);
  console.log('FAIL');
  process.exitCode = 1;
}
