'use strict';
// Generate a bcrypt hash for the admin password.
// Usage: npm run gen-hash -- "your-secret-password"
// Copy the printed hash into the ADMIN_PASSWORD_HASH env var.
const bcrypt = require('bcrypt');

const pw = process.argv[2];
if (!pw) {
  console.error('Usage: npm run gen-hash -- "your-secret-password"');
  process.exit(1);
}
bcrypt.hash(pw, 12).then(h => {
  console.log(h);
}).catch(e => {
  console.error('hash failed:', e.message);
  process.exit(1);
});
