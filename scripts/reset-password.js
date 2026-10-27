'use strict';
// Set a new password for a login: npm run reset-password -- admin NewPassword123
const path = require('node:path');
const { open } = require('../lib/db');
const { hashPassword } = require('../lib/auth');

const [username, pw] = process.argv.slice(2);
if (!username || !pw || pw.length < 8) { console.log('Usage: npm run reset-password -- <login name> <new password (8+ characters)>'); process.exit(1); }
const db = open(process.env.DATABASE_FILE || path.join(__dirname, '..', 'data', 'innops.db'));
const n = db.run('UPDATE users SET password_hash=?, active=1 WHERE username=?', hashPassword(pw), username).changes;
console.log(n ? `Password changed for ${username}.` : `No login called ${username}.`);
db.close();
