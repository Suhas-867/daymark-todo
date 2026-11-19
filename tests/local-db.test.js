import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoError, createLocalDb, parseContact } from '../local-db.js';

class MemoryStorage {
  #map = new Map();
  get length() { return this.#map.size; }
  key(i) { return [...this.#map.keys()][i] ?? null; }
  getItem(key) { return this.#map.has(key) ? this.#map.get(key) : null; }
  setItem(key, value) { this.#map.set(key, String(value)); }
  removeItem(key) { this.#map.delete(key); }
}

function setup() {
  const clock = { t: Date.parse('2026-11-19T10:00:00Z') };
  const db = createLocalDb(new MemoryStorage(), { now: () => clock.t });
  return { db, clock };
}
async function member(db, extra = {}) {
  const user = await db.signUp({ name: 'Asha', identifier: 'asha@example.com', password: 'secret-pass', ...extra });
  db.startSession(user.uid, 'session-1');
  return user;
}
const proof = { dataUrl: 'data:image/jpeg;base64,AAAA', mode: 'manual', fingerprint: 'ffff0000ffff0000' };

test('parses emails and phone numbers', () => {
  assert.deepEqual(parseContact(' Asha@Example.COM '), { type: 'email', value: 'asha@example.com' });
  assert.deepEqual(parseContact('98765 43210'), { type: 'phone', value: '+919876543210' });
  assert.deepEqual(parseContact('+1 (415) 555-0100'), { type: 'phone', value: '+14155550100' });
  assert.throws(() => parseContact('not valid'), DemoError);
  assert.throws(() => parseContact(''), DemoError);
});

test('sign up validates input, blocks duplicates and signs in with hashed passwords', async () => {
  const { db } = setup();
  await assert.rejects(db.signUp({ identifier: 'a@b.co', password: 'short' }), /at least 8/);
  const user = await db.signUp({ name: 'Asha', identifier: 'asha@example.com', extraContact: '9876543210', password: 'secret-pass', emailReminders: true, smsReminders: true });
  assert.equal(user.phone, '+919876543210');
  assert.ok(!('passHash' in user));
  await assert.rejects(db.signUp({ identifier: 'ASHA@example.com', password: 'another-pass' }), /already exists/);
  await assert.rejects(db.signUp({ identifier: '9876543210', password: 'another-pass' }), /already exists/);
  assert.equal((await db.signIn({ identifier: '+91 98765 43210', password: 'secret-pass' })).uid, user.uid);
  await assert.rejects(db.signIn({ identifier: 'asha@example.com', password: 'wrong-pass' }), /Incorrect/);
  assert.ok(!JSON.stringify(db.read()).includes('secret-pass'));
});

test('reminder consent needs a matching contact and can be enabled later', async () => {
  const { db } = setup();
  await assert.rejects(db.signUp({ identifier: 'asha@example.com', password: 'secret-pass', smsReminders: true }), /phone number/);
  const user = await member(db);
  assert.equal(user.emailReminders, false);
  assert.throws(() => db.updatePreferences(user.uid, { email: 'asha@example.com', phone: '', emailReminders: true, smsReminders: true }), /phone number/);
  const updated = db.updatePreferences(user.uid, { name: 'Asha', email: 'asha@example.com', phone: '9876543210', emailReminders: true, smsReminders: true });
  assert.equal(updated.smsReminders, true);
  assert.equal(updated.phone, '+919876543210');
});

test('free trial allows 10 tasks then locks until membership; membership date stays fixed', async () => {
  const { db, clock } = setup();
  const user = await member(db);
  for (let i = 0; i < 10; i++) db.createTask(user.uid, 'session-1', { title: `Task ${i}`, durationMinutes: 15 });
  assert.throws(() => db.createTask(user.uid, 'session-1', { title: 'Eleventh', durationMinutes: 15 }), /10 free task trials are over/);
  const first = db.activateMembership(user.uid, 'session-1');
  clock.t += 3 * 3600_000;
  const second = db.activateMembership(user.uid, 'session-1');
  assert.equal(second.expiresAt, first.expiresAt);
  assert.equal(second.alreadyActive, true);
  assert.ok(db.createTask(user.uid, 'session-1', { title: 'Eleventh', durationMinutes: 15 }));
  // Refreshing starts a new session: membership resets but the used trials persist.
  db.startSession(user.uid, 'session-2');
  assert.throws(() => db.createTask(user.uid, 'session-2', { title: 'Twelfth', durationMinutes: 15 }), /free task trials are over/);
});

test('validates timer length from 1 minute to 24 hours', async () => {
  const { db } = setup(); const user = await member(db);
  for (const bad of [0, 1441, 1.5, 'abc']) assert.throws(() => db.createTask(user.uid, 'session-1', { title: 'x', durationMinutes: bad }), /1 minute to 24 hours/);
  assert.ok(db.createTask(user.uid, 'session-1', { title: 'x', durationMinutes: 1440 }));
});

test('manual proof: admin approval awards 100 points and the milestone reward', async () => {
  const { db } = setup(); const user = await member(db);
  for (let round = 0; round < 10; round++) {
    const task = db.createTask(user.uid, 'session-1', { title: `Round ${round}`, durationMinutes: 30 });
    const { proofId } = db.submitProof(user.uid, task.id, { ...proof, fingerprint: String(round) });
    assert.equal(db.userSnapshot(user.uid, 'session-1').tasks.find(t => t.id === task.id).status, 'review');
    assert.equal(db.adminSnapshot().stats.waiting, 1);
    db.adminReview(proofId, 'approve', 'Looks good');
  }
  const { session, tasks } = db.userSnapshot(user.uid, 'session-1');
  assert.equal(session.points, 1000);
  assert.equal(session.earnedRupees, 30);
  assert.ok(tasks.every(task => task.status === 'approved'));
  assert.equal(db.adminSnapshot().stats.waiting, 0);
});

test('admin rejection returns the task to the timer, or fails it (-500) after the deadline', async () => {
  const { db, clock } = setup(); const user = await member(db);
  const task = db.createTask(user.uid, 'session-1', { title: 'Write report', durationMinutes: 10 });
  const first = db.submitProof(user.uid, task.id, proof).proofId;
  db.adminReview(first, 'reject', 'Blurry');
  let snap = db.userSnapshot(user.uid, 'session-1');
  assert.equal(snap.tasks[0].status, 'pending'); assert.equal(snap.tasks[0].reviewReason, 'Blurry'); assert.equal(snap.session.points, 0);
  const second = db.submitProof(user.uid, task.id, proof).proofId;
  clock.t += 11 * 60_000;
  db.adminReview(second, 'reject', 'Still blurry');
  snap = db.userSnapshot(user.uid, 'session-1');
  assert.equal(snap.tasks[0].status, 'failed'); assert.equal(snap.session.points, -500);
  assert.throws(() => db.adminReview(second, 'approve'), /already been reviewed/);
});

test('missed timers deduct 500 once and proof cannot be submitted after the deadline', async () => {
  const { db, clock } = setup(); const user = await member(db);
  const task = db.createTask(user.uid, 'session-1', { title: 'Run', durationMinutes: 1 });
  assert.deepEqual(db.expireTask(user.uid, task.id), { failed: false });
  clock.t += 61_000;
  assert.throws(() => db.submitProof(user.uid, task.id, proof), /timer has already ended/);
  assert.deepEqual(db.expireTask(user.uid, task.id), { failed: true });
  assert.deepEqual(db.expireTask(user.uid, task.id), { failed: false });
  assert.equal(db.userSnapshot(user.uid, 'session-1').session.points, -500);
});

test('AI results: approve awards points, reject retries, needs_human waits for admin', async () => {
  const { db } = setup(); const user = await member(db);
  const run = (decision, name) => {
    const task = db.createTask(user.uid, 'session-1', { title: name, durationMinutes: 30 });
    const { proofId } = db.submitProof(user.uid, task.id, { ...proof, mode: 'ai', fingerprint: name });
    assert.equal(db.adminSnapshot().pending.find(e => e.proofId === proofId).aiState, 'analyzing');
    db.recordAiResult(proofId, { decision, reason: 'because', score: 70 });
    return { task, proofId };
  };
  const a = run('approve', 'A'); assert.equal(db.userSnapshot(user.uid, 'session-1').tasks.find(t => t.id === a.task.id).status, 'approved');
  const r = run('reject', 'R'); assert.equal(db.userSnapshot(user.uid, 'session-1').tasks.find(t => t.id === r.task.id).status, 'pending');
  const h = run('needs_human', 'H'); assert.equal(db.userSnapshot(user.uid, 'session-1').tasks.find(t => t.id === h.task.id).status, 'review');
  assert.equal(db.adminSnapshot().pending.length, 1);
  assert.equal(db.userSnapshot(user.uid, 'session-1').session.points, 100);
  db.adminReview(h.proofId, 'approve');
  assert.equal(db.userSnapshot(user.uid, 'session-1').session.points, 200);
  assert.equal(db.recordAiResult(h.proofId, { decision: 'approve', reason: 'late' }).applied, false);
});

test('points reset on refresh: approvals land in the newest session', async () => {
  const { db } = setup(); const user = await member(db);
  const task = db.createTask(user.uid, 'session-1', { title: 'Study', durationMinutes: 30 });
  const { proofId } = db.submitProof(user.uid, task.id, proof);
  db.startSession(user.uid, 'session-2');
  assert.equal(db.userSnapshot(user.uid, 'session-2').session.points, 0);
  db.adminReview(proofId, 'approve');
  assert.equal(db.userSnapshot(user.uid, 'session-2').session.points, 100);
  assert.equal(db.userSnapshot(user.uid, 'session-1').session.points, 0);
});

test('detects a proof photo reused for another task', async () => {
  const { db } = setup(); const user = await member(db);
  const t1 = db.createTask(user.uid, 'session-1', { title: 'One', durationMinutes: 30 }), t2 = db.createTask(user.uid, 'session-1', { title: 'Two', durationMinutes: 30 });
  const first = db.submitProof(user.uid, t1.id, proof).proofId;
  const second = db.submitProof(user.uid, t2.id, proof).proofId;
  assert.equal(db.findDuplicate(user.uid, proof.fingerprint, second), first);
  assert.equal(db.findDuplicate(user.uid, 'ffffffffffffffff', second), null);
});

async function verifyEmail(db, uid) {
  const { code } = await db.startEmailVerification(uid);
  await db.confirmEmailVerification(uid, code);
}

test('email verification: wrong codes are counted, the right code verifies, changing the email resets it', async () => {
  const { db, clock } = setup(); const user = await member(db);
  await assert.rejects(db.confirmEmailVerification(user.uid, '123456'), /Request a new code/);
  const { code, email } = await db.startEmailVerification(user.uid);
  assert.equal(email, 'asha@example.com'); assert.match(code, /^\d{6}$/);
  assert.ok(!JSON.stringify(db.read()).includes(`"${code}"`), 'the code is stored hashed');
  await assert.rejects(db.startEmailVerification(user.uid), /seconds/);
  const wrong = code === '000000' ? '111111' : '000000';
  await assert.rejects(db.confirmEmailVerification(user.uid, wrong), /4 attempts left/);
  assert.equal(db.getUser(user.uid).emailVerified, false);
  await db.confirmEmailVerification(user.uid, code);
  assert.equal(db.getUser(user.uid).emailVerified, true);
  await assert.rejects(db.startEmailVerification(user.uid), /already verified/);
  clock.t += 5_000;
  db.updatePreferences(user.uid, { name: 'Asha', email: 'new@example.com', phone: '', emailReminders: true, smsReminders: false });
  assert.equal(db.getUser(user.uid).emailVerified, false);
});

test('email codes expire, lock after too many wrong tries, and are rate limited per hour', async () => {
  const { db, clock } = setup(); const user = await member(db);
  let { code } = await db.startEmailVerification(user.uid);
  clock.t += 11 * 60_000;
  await assert.rejects(db.confirmEmailVerification(user.uid, code), /expired/);
  ({ code } = await db.startEmailVerification(user.uid));
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) await assert.rejects(db.confirmEmailVerification(user.uid, wrong), /not correct/);
  await assert.rejects(db.confirmEmailVerification(user.uid, code), /Too many wrong attempts/);
  for (let i = 0; i < 3; i++) { clock.t += 61_000; await db.startEmailVerification(user.uid); }
  clock.t += 61_000;
  await assert.rejects(db.startEmailVerification(user.uid), /Too many codes/);
});

test('reminders are recorded once, only for opted-in channels; email needs a verified address', async () => {
  const { db } = setup();
  const user = await member(db, { extraContact: '9876543210', emailReminders: true, smsReminders: true });
  const first = db.createTask(user.uid, 'session-1', { title: 'Call home', durationMinutes: 5 });
  const unverified = db.sendDeadlineReminder(user.uid, first.id);
  assert.deepEqual(unverified.map(m => `${m.channel}:${m.status}`).sort(), ['email:skipped', 'sms:simulated']);
  assert.match(unverified.find(m => m.channel === 'email').detail, /not verified/);
  await verifyEmail(db, user.uid);
  const second = db.createTask(user.uid, 'session-1', { title: 'Water plants', durationMinutes: 5 });
  const sent = db.sendDeadlineReminder(user.uid, second.id);
  assert.deepEqual(sent.map(m => `${m.channel}:${m.status}`).sort(), ['email:queued', 'sms:simulated']);
  assert.deepEqual(db.sendDeadlineReminder(user.uid, second.id), []);
  const emailEntry = sent.find(m => m.channel === 'email');
  db.settleOutbox(emailEntry.id, 'sent');
  assert.equal(db.adminSnapshot().outbox.find(m => m.id === emailEntry.id).status, 'sent');
  const third = db.createTask(user.uid, 'session-1', { title: 'Third', durationMinutes: 5 });
  assert.equal(db.sendDeadlineReminder(user.uid, third.id, { smsLive: true }).find(m => m.channel === 'sms').status, 'queued');
  const other = await db.signUp({ identifier: 'quiet@example.com', password: 'secret-pass' }); db.startSession(other.uid, 's-2');
  const quietTask = db.createTask(other.uid, 's-2', { title: 'Quiet', durationMinutes: 5 });
  assert.deepEqual(db.sendDeadlineReminder(other.uid, quietTask.id), []);
});

test('daily email limit stops reminders', async () => {
  const { db } = setup(); const user = await member(db, { emailReminders: true });
  await verifyEmail(db, user.uid);
  db.activateMembership(user.uid, 'session-1');
  const statuses = [];
  for (let i = 0; i < 22; i++) {
    const task = db.createTask(user.uid, 'session-1', { title: `T${i}`, durationMinutes: 5 });
    statuses.push(db.sendDeadlineReminder(user.uid, task.id)[0].status);
  }
  assert.equal(statuses.filter(status => status === 'queued').length, 20);
  assert.equal(statuses.at(-1), 'skipped');
});

test('deleting a task removes its review entry and proof image', async () => {
  const { db } = setup(); const user = await member(db);
  const task = db.createTask(user.uid, 'session-1', { title: 'Temp', durationMinutes: 30 });
  const { proofId } = db.submitProof(user.uid, task.id, proof);
  assert.equal(db.getProof(proofId), proof.dataUrl);
  db.deleteTask(user.uid, task.id);
  assert.equal(db.getProof(proofId), null);
  assert.equal(db.adminSnapshot().pending.length, 0);
  assert.equal(db.userSnapshot(user.uid, 'session-1').tasks.length, 0);
});

test('subscribers are notified on changes and reset wipes the demo data', async () => {
  const { db } = setup(); let calls = 0; db.subscribe(() => calls++);
  const user = await member(db); db.createTask(user.uid, 'session-1', { title: 'x', durationMinutes: 5 });
  assert.ok(calls >= 3);
  db.reset();
  assert.equal(db.adminSnapshot().stats.members, 0);
});
