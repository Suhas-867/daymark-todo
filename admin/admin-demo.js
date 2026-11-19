// Demo-mode admin console. It reads and writes the same in-browser database as the user app,
// so a proof submitted in one tab appears here immediately and approvals award points live.
// (Demo data never leaves this browser; connect Firebase for a console that works across devices.)
import { ADMIN_SESSION_KEY, createLocalDb } from '../local-db.js';
import { createAdminView } from './admin-view.js';

const $ = id => document.getElementById(id);
const db = createLocalDb(window.localStorage);
const view = createAdminView({ getProof: proofId => db.getProof(proofId), review: (proofId, decision, note) => db.adminReview(proofId, decision, note) });

$('mode-chip').hidden = false; $('mode-chip').textContent = 'Demo · this browser only';
for (const id of ['stats', 'tabs', 'demo-foot', 'demo-creds']) $(id).hidden = false;

// The admin session stores the id of an admin account; it is re-checked against the database every time.
const adminUser = () => { try { return db.getAdminUser(window.localStorage.getItem(ADMIN_SESSION_KEY)); } catch { return null; } };
const setAdmin = uid => { try { uid ? window.localStorage.setItem(ADMIN_SESSION_KEY, uid) : window.localStorage.removeItem(ADMIN_SESSION_KEY); } catch { /* ignore */ } sync(); };
function render(force = false) { view.render(db.adminSnapshot(), { force }); }
function sync() {
  const admin = adminUser(), on = Boolean(admin);
  $('login').hidden = on; $('queue').hidden = !on; $('signout').hidden = !on;
  $('mode-chip').textContent = on ? `Signed in as ${admin.name || admin.email}` : 'Demo · this browser only';
  if (on) { view.reset(); render(true); }
}

$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = $('login-form').querySelector('button[type=submit], button:not([type])'); button.disabled = true; $('status').textContent = '';
  try { const user = await db.adminSignIn({ identifier: $('email').value, password: $('password').value }); setAdmin(user.uid); $('password').value = ''; }
  catch (error) { $('status').textContent = error.message; }
  finally { button.disabled = false; }
});
$('signout').addEventListener('click', () => setAdmin(null));
$('reset-demo').addEventListener('click', () => { if (window.confirm('Delete every demo account, task and proof in this browser?')) { db.reset(); view.reset(); setAdmin(null); } });
window.addEventListener('storage', event => { if (event.key === ADMIN_SESSION_KEY) sync(); });
db.subscribe(() => { if (adminUser()) render(); });
sync();
