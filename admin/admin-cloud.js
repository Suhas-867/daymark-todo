// Firebase admin console: only accounts with the `admin` custom claim may enter (see SETUP.md).
import { firebaseConfig } from '../firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js';
import { getFirestore, collection, onSnapshot, query, where, orderBy } from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-functions.js';

const $ = id => document.getElementById(id);
const app = initializeApp(firebaseConfig), auth = getAuth(app), db = getFirestore(app), functions = getFunctions(app);
$('mode-chip').hidden = false; $('mode-chip').textContent = 'Live · Firebase';
let stopListening = null;

onAuthStateChanged(auth, async user => {
  if (stopListening) { stopListening(); stopListening = null; }
  if (!user) { $('login').hidden = false; $('queue').hidden = true; $('signout').hidden = true; return; }
  const token = await user.getIdTokenResult(true);
  if (!token.claims.admin) { $('status').textContent = 'This account does not have admin access.'; await signOut(auth); return; }
  $('login').hidden = true; $('queue').hidden = false; $('signout').hidden = false; stopListening = listen();
});
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); $('status').textContent = '';
  try { await signInWithEmailAndPassword(auth, $('email').value, $('password').value); } catch (error) { $('status').textContent = error.message; }
});
$('signout').addEventListener('click', () => signOut(auth));

function listen() {
  return onSnapshot(query(collection(db, 'reviewQueue'), where('status', '==', 'pending'), orderBy('submittedAt', 'desc')), snap => {
    $('count').textContent = `${snap.size} waiting`;
    const cards = snap.docs.map(d => card(d.id, d.data()));
    $('cards').replaceChildren(...(cards.length ? cards : [Object.assign(document.createElement('div'), { className: 'empty', textContent: 'Nothing waiting for review.' })]));
  }, error => { $('cards').textContent = error.message; });
}

function card(id, data) {
  const el = document.createElement('article'); el.className = 'proof-card';
  const image = document.createElement('img'); image.alt = 'Submitted task proof'; image.className = 'proof-img';
  const content = document.createElement('div'); content.className = 'proof-body';
  const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = data.mode === 'ai' ? 'AI suggested · human review' : 'Manual review';
  const title = document.createElement('h2'); title.textContent = data.title || 'Task proof';
  const reason = document.createElement('p'); reason.className = 'muted'; reason.textContent = data.aiReason || `Task ID: ${data.taskId}`;
  const message = document.createElement('p'); message.className = 'form-status';
  const input = document.createElement('input'); input.placeholder = 'Review note (optional)'; input.setAttribute('aria-label', 'Review note');
  const approve = document.createElement('button'); approve.className = 'btn btn-primary'; approve.textContent = 'Approve · +100 points';
  const reject = document.createElement('button'); reject.className = 'btn btn-danger'; reject.textContent = 'Request another proof';
  const actions = document.createElement('div'); actions.className = 'actions'; actions.append(input, approve, reject);
  content.append(badge, title, reason, actions, message); el.append(image, content);
  httpsCallable(functions, 'getProofUrl')({ proofId: id }).then(r => { image.src = r.data.url; }).catch(err => { message.textContent = err.message; });
  async function review(choice, button) {
    button.disabled = true;
    try { await httpsCallable(functions, 'reviewProof')({ proofId: id, decision: choice, reason: input.value }); }
    catch (err) { message.textContent = err.message; button.disabled = false; }
  }
  approve.addEventListener('click', () => review('approve', approve)); reject.addEventListener('click', () => review('reject', reject));
  return el;
}
