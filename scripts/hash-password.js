// Run this on your own machine to turn a chosen admin password into the bcrypt
// hash that goes in .env — the plaintext password itself never needs to be
// written down anywhere.
//
// Usage: npm run hash-password -- "your-chosen-password"
'use strict';

const bcrypt = require('bcryptjs');

const password = process.argv[2];
if (!password) {
  console.error('Usage: npm run hash-password -- "your-chosen-password"');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Choose a password with at least 8 characters.');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 12);
console.log('\nAdd this line to your .env file:\n');
console.log(`ADMIN_PASSWORD_HASH=${hash}\n`);
