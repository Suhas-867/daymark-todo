// Demo-mode admin console. It reads and writes the same in-browser database as the user app,
// so a proof submitted in one tab appears here immediately and approvals award points live.
import { ADMIN_SESSION_KEY, DEMO_ADMIN, createLocalDb } from '../local-db.js';

const $ = id => document.getElementById(id);
const db = createLocalDb(window.localStorage);
const notes = new Map(); // keep half-typed review notes while the queue re-renders
let signature = '', tab = 'pending';

$('mode-chip').hidden = false; $('mode-chip').textContent = 'Demo · live with the user app';
$('demo-creds').hidden = false; $('demo-email').textContent = DEMO_ADMIN.email; $('demo-password').textContent = DEMO_ADMIN.password;
for (const id of ['stats', 'tabs', 'demo-foot']) $(id).hidden = false;
$('demo-fill').addEventListener('click', () => { $('email').value = DEMO_ADMIN.email; $('password').value = DEMO_ADMIN.password; });

const isAdmin = () => { try { return window.localStorage.getItem(ADMIN_SESSION_KEY) === '1'; } catch { return false; } };
const setAdmin = on => { try { on ? window.localStorage.setItem(ADMIN_SESSION_KEY, '1') : window.localStorage.removeItem(ADMIN_SESSION_KEY); } catch { /* ignore */ } sync(); };
function sync() { const on = isAdmin(); $('login').hidden = on; $('queue').hidden = !on; $('signout').hidden = !on; if (on) { signature = ''; render(); } }

$('login-form').addEventListener('submit', event => {
  event.preventDefault();
  if ($('email').value.trim().toLowerCase() === DEMO_ADMIN.email && $('password').value === DEMO_ADMIN.password) { $('status').textContent = ''; setAdmin(true); }
  else $('status').textContent = 'Incorrect admin email or password.';
});
$('signout').addEventListener('click', () => setAdmin(false));
$('reset-demo').addEventListener('click', () => { if (window.confirm('Delete every demo account, task and proof in this browser?')) { db.reset(); notes.clear(); signature = ''; render(); } });
window.addEventListener('storage', event => { if (event.key === ADMIN_SESSION_KEY) sync(); });
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => { tab = button.dataset.tab; showTab(); }));
db.subscribe(() => { if (isAdmin()) render(); });

function showTab() {
  document.querySelectorAll('[data-tab]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.tab === tab)));
  for (const name of ['pending', 'reviewed', 'members', 'outbox']) $(`panel-${name}`).hidden = name !== tab;
}
const when = iso => new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
const empty = text => el('div', 'empty', text);

function render() {
  const snap = db.adminSnapshot();
  const next = JSON.stringify([snap.pending.map(e => [e.proofId, e.aiState, e.aiSuggestion]), snap.reviewed.map(e => [e.proofId, e.status]), snap.members.map(m => [m.uid, m.emailReminders, m.smsReminders, m.tasks]), snap.outbox.map(m => m.id)]);
  $('stat-waiting').textContent = snap.stats.waiting; $('stat-approved').textContent = snap.stats.approvedToday; $('stat-ai').textContent = snap.stats.aiDecided; $('stat-members').textContent = snap.stats.members;
  $('count').textContent = `${snap.pending.length} waiting`;
  $('tab-count-pending').textContent = snap.pending.length; $('tab-count-reviewed').textContent = snap.reviewed.length; $('tab-count-members').textContent = snap.members.length; $('tab-count-outbox').textContent = snap.outbox.length;
  showTab();
  if (next === signature) return; signature = next;

  $('cards').replaceChildren(...(snap.pending.length ? snap.pending.map(pendingCard) : [empty('Nothing waiting for review. New proofs appear here as soon as members submit them.')]));
  $('reviewed').replaceChildren(...(snap.reviewed.length ? snap.reviewed.map(reviewedRow) : [empty('No reviewed proofs yet.')]));
  $('members').replaceChildren(...(snap.members.length ? [membersHeader(), ...snap.members.map(memberRow)] : [empty('No members have signed up yet.')]));
  $('outbox').replaceChildren(...(snap.outbox.length ? snap.outbox.map(messageRow) : [empty('No reminders have been sent yet.')]));
}

function aiBadge(entry) {
  if (entry.mode === 'manual') return ['Manual review requested', 'badge-wait'];
  if (entry.aiState === 'analyzing') return ['AI is analysing…', 'badge-busy'];
  return ['AI unsure · needs a human', 'badge-wait'];
}
function pendingCard(entry) {
  const card = el('article', 'proof-card'), image = el('img', 'proof-img'); image.alt = `Proof photo for ${entry.title}`; image.src = db.getProof(entry.proofId) || '';
  const body = el('div', 'proof-body'), [label, tone] = aiBadge(entry);
  const meta = el('p', 'meta', `${entry.memberName}${entry.memberContact ? ` · ${entry.memberContact}` : ''} · submitted ${when(entry.submittedAt)}`);
  const reason = entry.aiReason ? el('p', 'ai-note', `${entry.aiScore != null ? `AI score ${entry.aiScore}/100. ` : ''}${entry.aiReason}`) : null;
  const input = el('input'); input.placeholder = 'Review note for the member (optional)'; input.setAttribute('aria-label', 'Review note'); input.value = notes.get(entry.proofId) || ''; input.addEventListener('input', () => notes.set(entry.proofId, input.value));
  const approve = el('button', 'btn btn-primary', 'Approve · +100 points'), reject = el('button', 'btn btn-danger', 'Request another proof'), message = el('p', 'form-status');
  const act = decision => { try { db.adminReview(entry.proofId, decision, input.value); notes.delete(entry.proofId); } catch (error) { message.textContent = error.message; } };
  approve.addEventListener('click', () => act('approve')); reject.addEventListener('click', () => act('reject'));
  const actions = el('div', 'actions'); actions.append(input, approve, reject);
  body.append(el('span', `badge ${tone}`, label), el('h2', '', entry.title), meta); if (reason) body.append(reason); body.append(actions, message);
  card.append(image, body); return card;
}
function reviewedRow(entry) {
  const row = el('article', 'row row-proof'), thumb = el('img', 'thumb'); thumb.alt = ''; thumb.src = db.getProof(entry.proofId) || '';
  const main = el('div', 'row-main'); main.append(el('strong', '', entry.title), el('span', 'meta', `${entry.memberName} · ${when(entry.reviewedAt)} · by ${entry.reviewer === 'ai' ? 'AI review' : 'admin'}`), el('span', 'muted small', entry.reviewReason || ''));
  const approved = entry.status === 'approved'; row.append(thumb, main, el('span', `badge ${approved ? 'badge-ok' : 'badge-bad'}`, approved ? 'Approved +100' : 'Sent back'));
  return row;
}
function membersHeader() { const row = el('div', 'row row-head'); for (const text of ['Member', 'Email reminders', 'Text reminders', 'Tasks']) row.append(el('span', '', text)); return row; }
function memberRow(member) {
  const row = el('article', 'row row-member'), who = el('div', 'row-main'); who.append(el('strong', '', member.name || member.email || member.phone), el('span', 'meta', [member.email, member.phone].filter(Boolean).join(' · ')));
  const consent = on => el('span', `badge ${on ? 'badge-ok' : 'badge-off'}`, on ? 'Opted in' : 'Off');
  row.append(who, consent(member.emailReminders), consent(member.smsReminders), el('span', '', String(member.tasks))); return row;
}
function messageRow(message) {
  const row = el('article', 'row'), main = el('div', 'row-main');
  main.append(el('strong', '', message.channel === 'email' ? `📧 Email to ${message.to}` : `💬 SMS to ${message.to}`), el('span', 'muted small', message.subject ? `${message.subject} — ${message.body}` : message.body));
  row.append(main, el('span', 'meta', when(message.at)), el('span', 'badge badge-off', 'Simulated')); return row;
}

sync();
