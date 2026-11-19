import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeProject } from './helpers/fake-firebase.js';
import { createFirestoreBackend } from '../firestore-backend.js';
import { markNeedsHuman, settleProof } from '../firestore-review.js';
import { combineVerdicts } from '../ai-vision.js';

const ADMIN_EMAIL = 'suhasm867@gmail.com';
const DISTINCT = ['0000000000000000', 'ffffffffffffffff', '00000000ffffffff', 'ffffffff00000000', '0f0f0f0f0f0f0f0f', 'f0f0f0f0f0f0f0f0'];
const wait = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms));

/** One "device": its own sign-in state and its own mail/AI stand-ins, sharing the project's database. */
function device(project, options = {}) {
  const auth = project.newDevice(), mail = [], clock = options.clock || { t: Date.parse('2026-11-20T10:00:00Z') };
  const aiContent = { current: options.ai ?? { decision: 'approve', positive: 0.9, reason: 'The photo matches the task (90% match).' } };
  const photos = { counter: 0 };
  const backend = createFirestoreBackend({
    sdk: project.sdk, auth, db: project.db, now: () => clock.t,
    sendEmail: async details => { mail.push(details); return { delivered: true, simulated: false }; },
    prepareProofImage: async file => ({ dataUrl: `data:image/jpeg;base64,${file.name}`, width: 800, height: 600, stats: { fingerprint: file.fingerprint || DISTINCT[photos.counter++ % DISTINCT.length] } }),
    scoreProof: () => ({ decision: 'approve', score: 90, reason: 'Clear photo.' }),
    aiReview: { reviewContent: async () => aiContent.current, combineVerdicts, warmUp: async () => {} }
  });
  return { auth, backend, mail, clock, aiContent };
}
async function signUp(d, email = 'asha@example.com', extra = {}) {
  await d.backend.signUp({ name: 'Asha', identifier: email, password: 'secret-pass', ...extra });
  await wait();
  const adapter = await d.backend.createAdapter({ uid: d.auth.currentUser.uid, email: d.auth.currentUser.email, authUser: d.auth.currentUser });
  const latest = { snapshot: null }; adapter.subscribe(snapshot => { latest.snapshot = snapshot; }); await wait();
  return { adapter, latest, uid: d.auth.currentUser.uid };
}
const file = (name, fingerprint) => ({ name, fingerprint });

test('sign up writes the profile before the dashboard opens, and reports friendly errors', async () => {
  const project = createFakeProject(), d = device(project);
  const opened = []; d.backend.onAuthChange(user => opened.push(user && project.stored(`users/${user.uid}`)?.email));
  await d.backend.signUp({ name: 'Asha', identifier: 'Asha@Example.com', extraContact: '9876543210', password: 'secret-pass', emailReminders: true });
  await wait(20);
  assert.ok(opened.includes('asha@example.com'), 'the profile exists by the time the app learns about the user');
  const profile = project.stored('users/uid-1');
  assert.deepEqual([profile.email, profile.phone, profile.emailReminders, profile.emailVerified, profile.trialTasksUsed], ['asha@example.com', '+919876543210', true, false, 0]);
  await assert.rejects(device(project).backend.signUp({ identifier: 'asha@example.com', password: 'secret-pass' }), /already exists/);
  await assert.rejects(d.backend.signUp({ identifier: '9876543210', password: 'secret-pass' }), /email address/);
  await assert.rejects(d.backend.signUp({ identifier: 'x@example.com', password: 'short' }), /at least 8/);
  await assert.rejects(device(project).backend.signIn({ identifier: 'asha@example.com', password: 'wrong-pass-1' }), /Incorrect email or password/);
});

test('password reset is sent by link and the admin address gets a verification email', async () => {
  const project = createFakeProject(), d = device(project);
  await d.backend.signUp({ identifier: ADMIN_EMAIL, password: 'secret-pass' });
  assert.deepEqual(project.outbound.verifications, [ADMIN_EMAIL]);
  const reset = await d.backend.requestPasswordReset('asha@example.com');
  assert.deepEqual([reset.byLink, reset.target], [true, 'asha@example.com']); assert.deepEqual(project.outbound.passwordResets, ['asha@example.com']);
  await assert.rejects(d.backend.requestPasswordReset('9876543210'), /email address/);
  await assert.rejects(d.backend.resetPassword(), /link in the email/);
});

test('10 free tasks, then locked until membership; membership date stays fixed; admins are unlimited', async () => {
  const project = createFakeProject(), d = device(project);
  const { adapter, latest } = await signUp(d);
  for (let i = 0; i < 10; i++) await adapter.createTask({ title: `Task ${i}`, durationMinutes: 15 });
  await assert.rejects(adapter.createTask({ title: 'Eleventh', durationMinutes: 15 }), /10 free task trials are over/);
  await wait(); assert.equal(latest.snapshot.profile.trialTasksUsed, 10); assert.equal(latest.snapshot.tasks.length, 10);
  const first = await adapter.activateMembership(); d.clock.t += 3600_000; const second = await adapter.activateMembership();
  assert.equal(second.expiresAt, first.expiresAt); assert.equal(second.alreadyActive, true);
  await adapter.createTask({ title: 'Eleventh', durationMinutes: 15 });
  for (const bad of [0, 1441, 1.5]) await assert.rejects(adapter.createTask({ title: 'x', durationMinutes: bad }), /1 minute to 24 hours/);

  const admin = await signUp(device(project), ADMIN_EMAIL);
  for (let i = 0; i < 14; i++) await admin.adapter.createTask({ title: `Admin ${i}`, durationMinutes: 5 });
  await wait(); assert.equal(admin.latest.snapshot.profile.isAdmin, true); assert.equal(admin.latest.snapshot.profile.trialTasksUsed, 0);
});

test('a manual proof from one device reaches the admin on another device, and the approval awards points live', async () => {
  const project = createFakeProject(), member = device(project), adminDevice = device(project);
  const { adapter, latest, uid } = await signUp(member);
  const task = await adapter.createTask({ title: 'Write the report', durationMinutes: 30 });
  await wait(); const taskView = () => latest.snapshot.tasks.find(item => item.id === task.id);
  await adapter.submitProof({ task: taskView(), file: file('report.jpg'), mode: 'manual' }); await wait();
  assert.equal(taskView().status, 'review');

  // The admin's device: a different sign-in, the same database.
  await adminDevice.backend.signUp({ identifier: ADMIN_EMAIL, password: 'secret-pass' });
  const queue = await project.sdk.getDocs(project.sdk.collection(project.db, 'reviewQueue'));
  assert.equal(queue.docs.length, 1);
  const entry = queue.docs[0].data(), proofId = queue.docs[0].id;
  assert.deepEqual([entry.title, entry.mode, entry.status, entry.memberContact], ['Write the report', 'manual', 'pending', 'asha@example.com']);
  assert.match((await project.sdk.getDoc(project.sdk.doc(project.db, 'proofImages', proofId))).data().data, /report\.jpg/);

  assert.deepEqual(await settleProof(project.sdk, project.db, proofId, 'approve', 'Looks good', 'admin', adminDevice.clock.t), { applied: true, outcome: 'approve' });
  await wait();
  assert.equal(taskView().status, 'approved'); assert.equal(taskView().reviewReason, 'Looks good'); assert.equal(latest.snapshot.session.points, 100);
  assert.equal((await settleProof(project.sdk, project.db, proofId, 'approve', 'again', 'admin')).applied, false, 'a proof can only be settled once');
  assert.equal(project.stored(`reviewQueue/${proofId}`).status, 'approved'); assert.equal(uid, 'uid-1');
});

test('admin rejection puts the task back on the clock, or fails it (-500) when the time is gone', async () => {
  const project = createFakeProject(), member = device(project);
  const { adapter, latest } = await signUp(member);
  const task = await adapter.createTask({ title: 'Run', durationMinutes: 10 }); await wait();
  const view = () => latest.snapshot.tasks.find(item => item.id === task.id);
  await adapter.submitProof({ task: view(), file: file('a.jpg'), mode: 'manual' }); await wait();
  let proofId = view().proofId;
  await settleProof(project.sdk, project.db, proofId, 'reject', 'Blurry', 'admin', member.clock.t); await wait();
  assert.deepEqual([view().status, view().reviewReason, latest.snapshot.session.points], ['pending', 'Blurry', 0]);
  await adapter.submitProof({ task: view(), file: file('b.jpg'), mode: 'manual' }); await wait(); proofId = view().proofId;
  member.clock.t += 11 * 60_000;
  await settleProof(project.sdk, project.db, proofId, 'reject', 'Too late', 'admin', member.clock.t); await wait();
  assert.deepEqual([view().status, latest.snapshot.session.points], ['failed', -500]);
});

test('AI review: approve awards points, reject returns the task, unsure waits for the admin', async () => {
  const project = createFakeProject(), d = device(project);
  const { adapter, latest } = await signUp(d);
  const run = async (title, ai) => {
    d.aiContent.current = ai; const task = await adapter.createTask({ title, durationMinutes: 30 }); await wait();
    const view = () => latest.snapshot.tasks.find(item => item.id === task.id);
    await adapter.submitProof({ task: view(), file: file(`${title}.jpg`), mode: 'ai' }); await wait(30); return view();
  };
  assert.equal((await run('ceiling', { decision: 'approve', positive: 0.95, reason: 'Matches ceiling.' })).status, 'approved');
  const rejected = await run('table', { decision: 'reject', positive: 0.01, reason: 'Looks like a kitchen.' });
  assert.deepEqual([rejected.status, rejected.reviewReason.includes('kitchen')], ['pending', true]);
  const unsure = await run('desk', { decision: 'needs_human', positive: 0.3, reason: 'Not sure.' });
  assert.deepEqual([unsure.status, unsure.aiState], ['review', 'done']);
  assert.equal(latest.snapshot.session.points, 100);
  const queue = (await project.sdk.getDocs(project.sdk.collection(project.db, 'reviewQueue'))).docs.map(item => item.data());
  assert.equal(queue.filter(entry => entry.status === 'pending').length, 1);
  assert.equal(queue.find(entry => entry.status === 'pending').aiSuggestion, 'needs_human');
});

test('missed timers deduct 500 once; late proof is refused; duplicates are caught; points reset on refresh', async () => {
  const project = createFakeProject(), d = device(project);
  const { adapter, latest, uid } = await signUp(d);
  const task = await adapter.createTask({ title: 'Quick', durationMinutes: 1 }); await wait();
  const view = id => latest.snapshot.tasks.find(item => item.id === id);
  assert.deepEqual(await adapter.expireTask(view(task.id)), { failed: false });
  d.clock.t += 61_000;
  await assert.rejects(adapter.submitProof({ task: view(task.id), file: file('late.jpg'), mode: 'manual' }), /timer has already ended/);
  assert.deepEqual(await adapter.expireTask(view(task.id)), { failed: true }); assert.deepEqual(await adapter.expireTask(view(task.id)), { failed: false });
  await wait(); assert.equal(latest.snapshot.session.points, -500);

  const one = await adapter.createTask({ title: 'One', durationMinutes: 60 }), two = await adapter.createTask({ title: 'Two', durationMinutes: 60 }); await wait();
  await adapter.submitProof({ task: view(one.id), file: file('x.jpg', 'ffff0000ffff0000'), mode: 'manual' }); await wait();
  await assert.rejects(adapter.submitProof({ task: view(two.id), file: file('y.jpg', 'ffff0000ffff0001'), mode: 'manual' }), /identical to proof/);

  // Refresh: a new session starts at zero and the old points stay behind.
  const again = await d.backend.createAdapter({ uid, email: 'asha@example.com', authUser: d.auth.currentUser }); const after = { snapshot: null }; again.subscribe(s => { after.snapshot = s; }); await wait();
  assert.equal(after.snapshot.session.points, 0);
  const proofId = view(one.id).proofId; await settleProof(project.sdk, project.db, proofId, 'approve', 'ok', 'admin', d.clock.t); await wait();
  assert.equal(after.snapshot.session.points, 100, 'approvals land in the newest session'); assert.equal(latest.snapshot.session.points, -500);
});

test('email verification and reminders: only verified addresses are emailed, once, within limits', async () => {
  const project = createFakeProject(), d = device(project);
  const { adapter, latest, uid } = await signUp(d, 'asha@example.com', { emailReminders: true });
  const task = await adapter.createTask({ title: 'Call home', durationMinutes: 5 }); await wait();
  const view = () => latest.snapshot.tasks.find(item => item.id === task.id);
  const skipped = await adapter.sendReminder(view()); assert.deepEqual(skipped.map(m => `${m.channel}:${m.status}`), ['email:skipped']); assert.equal(d.mail.length, 0);

  const sent = await adapter.sendVerificationCode('email'); assert.equal(sent.target, 'asha@example.com'); const code = d.mail[0].message.match(/is (\d{6})/)[1];
  assert.ok(!JSON.stringify(project.stored(`users/${uid}`)).includes(`"${code}"`), 'the code is stored hashed');
  await assert.rejects(adapter.sendVerificationCode('email'), /seconds/);
  await assert.rejects(adapter.verifyCode('email', code === '000000' ? '111111' : '000000'), /4 attempts left/);
  await adapter.verifyCode('email', code); await wait(); assert.equal(latest.snapshot.profile.emailVerified, true);
  await assert.rejects(adapter.sendVerificationCode('sms'), /not available/);

  const second = await adapter.createTask({ title: 'Water plants', durationMinutes: 5 }); await wait();
  const sentReminder = await adapter.sendReminder(latest.snapshot.tasks.find(item => item.id === second.id));
  assert.deepEqual(sentReminder.map(m => `${m.channel}:${m.status}`), ['email:sent']); assert.equal(d.mail.length, 2);
  assert.deepEqual(await adapter.sendReminder(latest.snapshot.tasks.find(item => item.id === second.id)), [], 'only once per task');
  const outbox = [...project.store.keys()].filter(path => path.startsWith('outbox/')); assert.equal(outbox.length, 2);
});

test('deleting a task removes its queue entry and photo; saving preferences keeps the sign-in email', async () => {
  const project = createFakeProject(), d = device(project);
  const { adapter, latest } = await signUp(d);
  const task = await adapter.createTask({ title: 'Temp', durationMinutes: 30 }); await wait();
  await adapter.submitProof({ task: latest.snapshot.tasks[0], file: file('t.jpg'), mode: 'manual' }); await wait();
  const proofId = latest.snapshot.tasks[0].proofId;
  assert.ok(project.stored(`reviewQueue/${proofId}`) && project.stored(`proofImages/${proofId}`));
  await adapter.deleteTask(latest.snapshot.tasks[0]); await wait();
  assert.deepEqual([project.stored(`reviewQueue/${proofId}`), project.stored(`proofImages/${proofId}`), latest.snapshot.tasks.length], [undefined, undefined, 0]);

  await adapter.savePreferences({ name: 'Asha Rao', email: 'asha@example.com', phone: '9876543210', emailReminders: true, smsReminders: true }); await wait();
  assert.deepEqual([latest.snapshot.profile.name, latest.snapshot.profile.phone, latest.snapshot.profile.smsReminders], ['Asha Rao', '+919876543210', true]);
  await assert.rejects(adapter.savePreferences({ name: 'x', email: 'other@example.com', phone: '', emailReminders: false, smsReminders: false }), /cannot be changed/);
  await assert.rejects(adapter.savePreferences({ name: 'x', email: 'asha@example.com', phone: '', emailReminders: false, smsReminders: true }), /phone number/);
  assert.ok(task.id);
});

test('an interrupted AI check is handed to the admin when the member comes back', async () => {
  const project = createFakeProject(), d = device(project);
  const { adapter, latest, uid } = await signUp(d);
  const task = await adapter.createTask({ title: 'Stuck', durationMinutes: 60 }); await wait();
  d.aiContent.current = new Promise(() => {}); // the page "closes" while the model is thinking
  adapter.submitProof({ task: latest.snapshot.tasks[0], file: file('s.jpg'), mode: 'ai' }); await wait(20);
  const proofId = latest.snapshot.tasks[0].proofId; assert.equal(project.stored(`reviewQueue/${proofId}`).aiState, 'analyzing');
  d.clock.t += 20_000;
  await d.backend.createAdapter({ uid, email: 'asha@example.com', authUser: d.auth.currentUser }); await wait(20);
  assert.equal(project.stored(`reviewQueue/${proofId}`).aiSuggestion, 'needs_human');
  assert.equal((await markNeedsHuman(project.sdk, project.db, 'missing', { reason: 'x' })).applied, false); assert.ok(task.id);
});
