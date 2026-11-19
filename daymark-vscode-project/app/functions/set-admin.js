// One-time trusted operator script. Run with Firebase Admin credentials outside the public client.
const admin = require('firebase-admin');
const email = process.argv[2];
if (!email) throw new Error('Usage: node set-admin.js admin@example.com');
admin.initializeApp();
admin.auth().getUserByEmail(email).then(user => admin.auth().setCustomUserClaims(user.uid, { admin: true })).then(() => {
  console.log(`Granted Daymark admin role to ${email}. Sign out and sign in again to refresh the claim.`);
  process.exit(0);
}).catch(error => { console.error(error); process.exit(1); });
