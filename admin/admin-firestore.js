// Live admin console on Firebase: proofs submitted from any device appear here instantly, and an
// approval awards the points to the member on their device. Only a signed-in, email-verified account
// whose address is on the administrator list (access-config.js, and the Firestore rules) gets in.
import { loadFirebase } from '../firebase-loader.js';
import { isAdminEmail } from '../access-config.js';
import { settleProof } from '../firestore-review.js';
import { friendlyAuthError } from '../firestore-backend.js';
import { createAdminView } from './admin-view.js';

const $ = id => document.getElementById(id);
const { sdk, auth, db } = await loadFirebase();
const images = new Map();
const view = createAdminView({
  getProof: proofId => { if (!images.has(proofId)) images.set(proofId, sdk.getDoc(sdk.doc(db, 'proofImages', proofId)).then(snap => snap.data()?.data || '').catch(() => '')); return images.get(proofId); },
  review: async (proofId, decision, note) => {
    const text = String(note || '').trim().slice(0, 300) || (decision === 'approve' ? 'Approved by an admin.' : 'An admin asked for clearer proof.');
    const result = await settleProof(sdk, db, proofId, decision, text, 'admin');
    if (!result.applied) throw new Error('This proof has already been reviewed.');
  }
});

$('mode-chip').hidden = false; $('mode-chip').textContent = 'Live · shared across devices';
for (const id of ['stats', 'tabs']) $(id).hidden = false;
let stops = [];
const stopListening = () => { stops.forEach(stop => stop()); stops = []; };
function show(which) { $('login').hidden = which !== 'login'; $('verify-panel').hidden = which !== 'verify'; $('queue').hidden = which !== 'queue'; $('signout').hidden = which === 'login'; }

sdk.onAuthStateChanged(auth, async user => {
  stopListening();
  if (!user) { show('login'); return; }
  if (!isAdminEmail(user.email)) { $('status').textContent = 'This account is not an administrator.'; await sdk.signOut(auth); return; }
  if (!user.emailVerified) {
    $('verify-copy').textContent = `Administrator access needs a verified email. We sent a link to ${user.email}. Click it, then press the button below.`;
    $('verify-status').textContent = ''; show('verify'); return;
  }
  try { await user.getIdToken(true); } catch { /* the first query will report any problem */ }
  $('mode-chip').textContent = `Signed in as ${user.email}`; show('queue'); listen();
});

$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = $('login-form').querySelector('button[type=submit], button:not([type])'); button.disabled = true; $('status').textContent = '';
  try { await sdk.signInWithEmailAndPassword(auth, $('email').value.trim().toLowerCase(), $('password').value); $('password').value = ''; }
  catch (error) { $('status').textContent = friendlyAuthError(error); }
  finally { button.disabled = false; }
});
$('signout').addEventListener('click', () => sdk.signOut(auth));
$('verify-resend').addEventListener('click', async () => {
  try { await sdk.sendEmailVerification(auth.currentUser); $('verify-status').textContent = 'Verification email sent. Check your inbox and spam.'; }
  catch (error) { $('verify-status').textContent = friendlyAuthError(error); }
});
$('verify-refresh').addEventListener('click', async () => {
  try { await auth.currentUser.reload(); if (auth.currentUser.emailVerified) { await auth.currentUser.getIdToken(true); location.reload(); } else $('verify-status').textContent = 'Not verified yet. Click the link in the email first.'; }
  catch (error) { $('verify-status').textContent = friendlyAuthError(error); }
});

function listen() {
  let queue = [], users = [], outbox = [];
  const push = () => {
    const today = new Date().toDateString(), reviewed = queue.filter(entry => entry.status !== 'pending').sort((a, b) => (b.reviewedAt || 0) - (a.reviewedAt || 0));
    view.render({
      pending: queue.filter(entry => entry.status === 'pending').sort((a, b) => b.submittedAt - a.submittedAt), reviewed,
      members: users.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(user => ({ ...user, tasks: null })), outbox: [...outbox].sort((a, b) => b.at - a.at).slice(0, 100),
      stats: { waiting: queue.filter(entry => entry.status === 'pending').length, approvedToday: reviewed.filter(entry => entry.status === 'approved' && new Date(entry.reviewedAt).toDateString() === today).length, aiDecided: reviewed.filter(entry => entry.reviewer === 'ai').length, members: users.length }
    });
  };
  const failed = error => { $('status').textContent = friendlyAuthError(error); console.error(error); };
  stops = [
    sdk.onSnapshot(sdk.collection(db, 'reviewQueue'), snap => { queue = snap.docs.map(item => ({ ...item.data(), proofId: item.id })); push(); }, failed),
    sdk.onSnapshot(sdk.collection(db, 'users'), snap => { users = snap.docs.map(item => ({ ...item.data(), uid: item.id })); push(); }, failed),
    sdk.onSnapshot(sdk.collection(db, 'outbox'), snap => { outbox = snap.docs.map(item => item.data()); push(); }, failed)
  ];
}
