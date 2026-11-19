// Who counts as an administrator in demo mode.
//
// Accounts whose email address matches an entry below get unlimited demo tasks in the app and can sign
// in to the admin console (/admin/) to review proofs manually. Addresses are stored as SHA-256 hashes so
// the plain email is not published in the repository. To add an admin, hash the lower-case address:
//
//   node -e "console.log(require('crypto').createHash('sha256').update('someone@example.com').digest('hex'))"
//
// Honest limit: demo mode keeps all data in each visitor's own browser, so this is a convenience check,
// not security. Real admin enforcement needs the Firebase backend (custom `admin` claim, see SETUP.md).
export const adminEmailHashes = Object.freeze([
  '16c229a354223dda5a04a8de3c76c443896d1940b985e544866ce3a74daef738'
]);
