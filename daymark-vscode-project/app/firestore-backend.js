// Shared online backend on Firebase's free plan: Firebase Auth + Firestore only (no Cloud Functions, no
// Cloud Storage, no billing). Members on any device and the admin console see the same data live.
//
// Honest limit: with no server code, the rules in firestore.rules constrain what a signed-in member can
// write, but a determined member could still tamper with their own score from the browser console.
// Tamper-proof scoring needs Cloud Functions on the paid plan (see functions/ and SETUP.md).
//
// `sdk` is the subset of the Firebase JS SDK used here, so the same code runs in the browser (CDN build)
// and in tests (a fake).
import { parseContact } from './local-db.js';
import { isAdminEmail } from './access-config.js';
import { sha256Hex } from './sha256.js';
import { FREE_TASK_LIMIT, extendDemoMembership, hasActiveMembership } from './rewards.js';
import { emailLimits } from './messaging-config.js';
import { markNeedsHuman, recoverInterruptedAi, rewardsToSessionPatch, sessionToRewards, settleProof } from './firestore-review.js';
import { applyPointDelta } from './rewards.js';
import { POINTS_PENALTY } from './local-db.js';
import { hashDistance } from './ai-review.js';

const fail = message => { throw new Error(message); };
const uuid = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const code6 = () => String(globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
const dayKey = ms => new Date(ms).toISOString().slice(0, 10);

/** Friendly wording for Firebase Auth errors. */
export function friendlyAuthError(error) {
  const code = String(error?.code || error?.message || '');
  if (/email-already-in-use/.test(code)) return 'An account with this email already exists. Sign in instead.';
  if (/invalid-credential|wrong-password|invalid-login/.test(code)) return 'Incorrect email or password. Use "Forgot your password?" if you need a new one.';
  if (/user-not-found/.test(code)) return 'No account with that email exists. Create one first.';
  if (/weak-password/.test(code)) return 'Choose a password with at least 8 characters.';
  if (/invalid-email/.test(code)) return 'Enter a valid email address.';
  if (/too-many-requests/.test(code)) return 'Too many attempts. Please wait a moment and try again.';
  if (/network/.test(code)) return 'Could not reach the server. Check your connection.';
  if (/permission-denied|insufficient permissions/i.test(code)) return 'The server refused this request. Check that the Firestore rules from SETUP.md are published.';
  return error?.message || 'Something went wrong. Please try again.';
}

export function createFirestoreBackend({ sdk, auth, db, now = () => Date.now(), sendEmail, prepareProofImage, scoreProof, aiReview }) {
  const { doc, collection, getDoc, setDoc, updateDoc, runTransaction, onSnapshot, writeBatch, getDocs, query, where } = sdk;
  const wrap = async work => { try { return await work(); } catch (error) { throw new Error(friendlyAuthError(error)); } };
  const publicUser = (fbUser, data = {}) => ({ uid: fbUser.uid, email: data.email || fbUser.email || '', name: data.name || '', phone: data.phone || '', isAdmin: isAdminEmail(fbUser.email), emailVerified: Boolean(data.emailVerified) });

  let pendingProfile = null; // set while sign-up is still writing the profile, so the dashboard never opens before it exists
  const backend = {
    mode: 'cloud',
    supportsPasswordReset: true,
    passwordResetByLink: true,
    onAuthChange(listener) { sdk.onAuthStateChanged(auth, async user => { if (pendingProfile) await pendingProfile; listener(user ? { uid: user.uid, email: user.email, authUser: user } : null); }); },

    async signUp({ name = '', identifier, extraContact = '', password, emailReminders = false, smsReminders = false }) {
      const primary = parseContact(identifier);
      if (primary.type !== 'email') fail('Create the account with an email address.');
      const extra = String(extraContact).trim() ? parseContact(extraContact) : null;
      if (extra && extra.type !== 'phone') fail('The extra contact must be a phone number.');
      if (String(password || '').length < 8) fail('Choose a password with at least 8 characters.');
      if (smsReminders && !extra) fail('Add a phone number to receive text reminders, or untick that option.');
      let release; pendingProfile = new Promise(resolve => { release = resolve; });
      try {
        const credential = await wrap(() => sdk.createUserWithEmailAndPassword(auth, primary.value, password));
        const user = credential.user, t = now();
        await setDoc(doc(db, 'users', user.uid), { name: String(name).trim().slice(0, 60), email: primary.value, phone: extra?.value || '', emailReminders: Boolean(emailReminders), smsReminders: Boolean(smsReminders), consentUpdatedAt: t, emailVerified: false, emailCode: null, trialTasksUsed: 0, activeSessionId: null, createdAt: t });
        if (isAdminEmail(primary.value)) sdk.sendEmailVerification(user).catch(() => {}); // admin rights need a verified address
        return publicUser(user, { email: primary.value });
      } finally { release(); pendingProfile = null; }
    },
    async signIn({ identifier, password }) {
      const contact = parseContact(identifier);
      if (contact.type !== 'email') fail('Sign in with the email address you registered.');
      return publicUser((await wrap(() => sdk.signInWithEmailAndPassword(auth, contact.value, String(password || '')))).user);
    },
    async signOut() { await sdk.signOut(auth); },
    async requestPasswordReset(identifier) {
      const contact = parseContact(identifier);
      if (contact.type !== 'email') fail('Enter the email address on your account.');
      await wrap(() => sdk.sendPasswordResetEmail(auth, contact.value));
      return { target: contact.value, delivered: true, byLink: true };
    },
    async resetPassword() { fail('Use the link in the email we sent you to choose a new password.'); },

    /** Everything the dashboard needs for one signed-in member. */
    async createAdapter(session) {
      const fbUser = session.authUser || session, uid = fbUser.uid, sessionId = uuid(), admin = isAdminEmail(fbUser.email);
      const userRef = doc(db, 'users', uid), sessionRef = doc(db, 'users', uid, 'sessions', sessionId);
      const taskCollection = collection(db, 'users', uid, 'tasks');
      const existing = await getDoc(userRef), t0 = now();
      if (!existing.exists()) await setDoc(userRef, { name: '', email: (fbUser.email || '').toLowerCase(), phone: '', emailReminders: false, smsReminders: false, consentUpdatedAt: t0, emailVerified: false, emailCode: null, trialTasksUsed: 0, activeSessionId: sessionId, createdAt: t0 });
      else await updateDoc(userRef, { activeSessionId: sessionId });
      await setDoc(sessionRef, { points: 0, milestonesReached: 0, demoRupeesEarned: 0, membershipStartedAt: null, membershipExpiresAt: null, createdAt: t0 });
      recoverInterruptedAi(sdk, db, uid, 15_000, t0).catch(() => {});
      let knownTasks = [];

      async function runAiReview(proofId, task, fileName, prepared) {
        const quality = scoreProof({ stats: prepared.stats, width: prepared.width, height: prepared.height, taskTitle: task.title, fileName });
        let content = null;
        if (quality.decision !== 'reject') { try { content = await aiReview.reviewContent(prepared.dataUrl, task.title); } catch (error) { console.error('Vision model unavailable', error); } }
        const verdict = aiReview.combineVerdicts(quality, content), reason = `${verdict.reason} (on-device AI)`;
        try {
          if (verdict.decision === 'approve') await settleProof(sdk, db, proofId, 'approve', `AI review approved this proof. ${reason}`, 'ai', now());
          else if (verdict.decision === 'reject') await settleProof(sdk, db, proofId, 'reject', `AI review could not verify this proof. ${reason}`, 'ai', now());
          else await markNeedsHuman(sdk, db, proofId, { reason, score: verdict.score });
        } catch (error) { console.error(error); }
      }

      async function codeTransaction(work) { return runTransaction(db, work); }

      return {
        mode: 'cloud',
        subscribe(listener) {
          let tasks = [], sessionData = {}, profile = {};
          const push = () => { knownTasks = tasks; listener({ tasks, session: { points: sessionData.points || 0, milestonesReached: sessionData.milestonesReached || 0, earnedRupees: sessionData.demoRupeesEarned || 0, membershipExpiresAt: sessionData.membershipExpiresAt || null }, profile: { ...profile, uid, email: profile.email || fbUser.email || '', isAdmin: admin } }); };
          const stops = [
            onSnapshot(taskCollection, snap => { tasks = snap.docs.map(item => ({ aiState: 'none', ...item.data(), id: item.id })).sort((a, b) => b.createdAt - a.createdAt); push(); }, error => console.error(error)),
            onSnapshot(sessionRef, snap => { sessionData = snap.exists() ? snap.data() : {}; push(); }, error => console.error(error)),
            onSnapshot(userRef, snap => { profile = snap.exists() ? snap.data() : {}; push(); }, error => console.error(error))
          ];
          return () => stops.forEach(stop => stop());
        },

        async createTask({ title, durationMinutes }) {
          const clean = String(title ?? '').trim(), minutes = Number(durationMinutes);
          if (!clean || clean.length > 120) fail('Enter a task of up to 120 characters.');
          if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) fail('Choose a timer from 1 minute to 24 hours.');
          const taskRef = doc(taskCollection), t = now();
          await runTransaction(db, async tx => {
            const user = await tx.get(userRef), session = await tx.get(sessionRef), used = user.data()?.trialTasksUsed || 0;
            const member = admin || (session.exists() && hasActiveMembership(sessionToRewards(session.data()), new Date(t)));
            if (!member && used >= FREE_TASK_LIMIT) fail('Your 10 free task trials are over. Get membership for full access.');
            tx.set(taskRef, { title: clean, durationMinutes: minutes, createdAt: t, deadlineAt: t + minutes * 60_000, status: 'pending', sessionId, aiState: 'none' });
            if (!member) tx.update(userRef, { trialTasksUsed: used + 1 });
          });
          return { id: taskRef.id };
        },
        async activateMembership() {
          return runTransaction(db, async tx => {
            const snap = await tx.get(sessionRef), before = snap.data()?.membershipExpiresAt || null, next = extendDemoMembership(sessionToRewards(snap.data() || {}), new Date(now()));
            tx.update(sessionRef, { membershipStartedAt: next.membershipStartedAt, membershipExpiresAt: next.membershipExpiresAt });
            return { expiresAt: next.membershipExpiresAt, alreadyActive: Boolean(before) && before === next.membershipExpiresAt };
          });
        },
        async expireTask(task) {
          return runTransaction(db, async tx => {
            const taskRef = doc(taskCollection, task.id), current = await tx.get(taskRef), user = await tx.get(userRef);
            if (!current.exists() || current.data().status !== 'pending' || current.data().deadlineAt > now()) return { failed: false };
            const sid = user.data()?.activeSessionId || sessionId, targetRef = doc(db, 'users', uid, 'sessions', sid), target = await tx.get(targetRef);
            tx.update(taskRef, { status: 'failed', failedAt: now() });
            if (target.exists()) tx.update(targetRef, rewardsToSessionPatch(applyPointDelta(sessionToRewards(target.data()), -POINTS_PENALTY).rewards));
            return { failed: true };
          });
        },
        async deleteTask(task) {
          const batch = writeBatch(db); batch.delete(doc(taskCollection, task.id));
          if (task.proofId) { batch.delete(doc(db, 'reviewQueue', task.proofId)); batch.delete(doc(db, 'proofImages', task.proofId)); }
          await batch.commit();
        },

        async submitProof({ task, file, mode }) {
          if (!['ai', 'manual'].includes(mode)) fail('Choose AI review or manual review.');
          const prepared = await prepareProofImage(file), fingerprint = prepared.stats.fingerprint;
          if (knownTasks.some(other => other.fingerprint && other.id !== task.id && hashDistance(other.fingerprint, fingerprint) <= 3)) fail('This photo looks identical to proof you already used for another task. Please take a new photo.');
          const proofId = uuid(), t = now(), taskRef = doc(taskCollection, task.id);
          await runTransaction(db, async tx => {
            const current = await tx.get(taskRef), user = await tx.get(userRef);
            if (!current.exists() || current.data().status !== 'pending') fail('This task is no longer waiting for proof.');
            if (current.data().deadlineAt <= t) fail('The task timer has already ended.');
            const profile = user.data() || {};
            tx.set(doc(db, 'proofImages', proofId), { uid, data: prepared.dataUrl });
            tx.set(doc(db, 'reviewQueue', proofId), { uid, taskId: task.id, title: current.data().title, mode, status: 'pending', aiState: mode === 'ai' ? 'analyzing' : 'none', aiSuggestion: '', aiReason: '', aiScore: null, fingerprint, fileName: String(file.name || '').slice(0, 120), width: prepared.width, height: prepared.height, submittedAt: t, memberName: profile.name || profile.email || fbUser.email || 'Member', memberContact: profile.email || fbUser.email || '' });
            tx.update(taskRef, { status: 'review', proofId, reviewMode: mode, submittedAt: t, reviewReason: '', fingerprint, aiState: mode === 'ai' ? 'analyzing' : 'none' });
          });
          if (mode === 'ai') runAiReview(proofId, task, file.name || '', prepared);
          return { status: 'review' };
        },

        async savePreferences({ name, email, phone, emailReminders, smsReminders }) {
          const current = (await getDoc(userRef)).data() || {}, loginEmail = (fbUser.email || '').toLowerCase();
          const wantedEmail = String(email ?? '').trim() ? parseContact(email) : null, wantedPhone = String(phone ?? '').trim() ? parseContact(phone) : null;
          if (wantedEmail && (wantedEmail.type !== 'email' || wantedEmail.value !== loginEmail)) fail('Your email is your sign-in address and cannot be changed here.');
          if (wantedPhone && wantedPhone.type !== 'phone') fail('Enter a valid phone number with its country code.');
          if (smsReminders && !wantedPhone) fail('Add a phone number (with country code) to receive text reminders.');
          const patch = { name: String(name ?? current.name ?? '').trim().slice(0, 60), phone: wantedPhone?.value || '', emailReminders: Boolean(emailReminders), smsReminders: Boolean(smsReminders), consentUpdatedAt: now() };
          await updateDoc(userRef, patch);
        },

        /* ----- email verification (6-digit code sent with EmailJS) ----- */
        supportsVerification: { email: true, sms: false },
        async sendVerificationCode(channel) {
          if (channel !== 'email') fail('Text message verification is not available yet.');
          const code = code6();
          const result = await codeTransaction(async tx => {
            const user = (await tx.get(userRef)).data() || {};
            if (!(user.email || fbUser.email)) fail('Add an email address first.');
            if (user.emailVerified) fail('This email address is already verified.');
            const t = now(), old = user.emailCode || {}, wait = Math.ceil(((old.sentAt || 0) + emailLimits.codeCooldownSeconds * 1000 - t) / 1000);
            if (wait > 0) fail(`A code was just sent. You can request another in ${wait} seconds.`);
            const windowStart = old.windowStart && t - old.windowStart < 3600_000 ? old.windowStart : t, sentCount = windowStart === old.windowStart ? (old.sentCount || 0) : 0;
            if (sentCount >= emailLimits.codesPerHour) fail('Too many codes requested. Please try again in an hour.');
            const target = user.email || fbUser.email;
            tx.update(userRef, { emailCode: { hash: sha256Hex(`${code}:${uid}:email`), target, expiresAt: t + emailLimits.codeLifetimeMinutes * 60_000, attempts: 0, sentAt: t, windowStart, sentCount: sentCount + 1 } });
            return { target, name: user.name || '' };
          });
          const mail = await sendEmail({ to: result.target, name: result.name || 'Daymark', subject: 'Your Daymark verification code', message: `Your Daymark verification code is ${code}. It expires in ${emailLimits.codeLifetimeMinutes} minutes. If you did not ask for it, you can ignore this email.` });
          return { target: result.target, delivered: mail.delivered, devCode: mail.simulated ? code : null };
        },
        async verifyCode(channel, code) {
          if (channel !== 'email') fail('Text message verification is not available yet.');
          const clean = String(code ?? '').trim();
          const outcome = await codeTransaction(async tx => {
            const user = (await tx.get(userRef)).data() || {}, pending = user.emailCode;
            if (user.emailVerified) return { verified: true };
            if (!pending?.hash) return { problem: 'Request a new code first.' };
            if (now() > pending.expiresAt) { tx.update(userRef, { emailCode: { ...pending, hash: null } }); return { problem: 'That code has expired. Request a new one.' }; }
            if (pending.attempts >= emailLimits.maxCodeAttempts) { tx.update(userRef, { emailCode: { ...pending, hash: null } }); return { problem: 'Too many wrong attempts. Request a new code.' }; }
            if (!/^\d{6}$/.test(clean) || sha256Hex(`${clean}:${uid}:email`) !== pending.hash) { tx.update(userRef, { emailCode: { ...pending, attempts: pending.attempts + 1 } }); return { problem: `That code is not correct. ${emailLimits.maxCodeAttempts - pending.attempts - 1} attempts left.` }; }
            tx.update(userRef, { emailVerified: true, emailCode: { ...pending, hash: null } });
            return { verified: true };
          });
          if (outcome.problem) fail(outcome.problem);
          return outcome;
        },

        /** Record the deadline reminder once, email verified members for real and log everything for the admin. */
        async sendReminder(task) {
          const taskRef = doc(taskCollection, task.id);
          const plan = await runTransaction(db, async tx => {
            const current = await tx.get(taskRef), user = await tx.get(userRef);
            if (!current.exists() || current.data().status !== 'pending' || current.data().reminderSentAt) return null;
            const profile = user.data() || {}, t = now(), today = dayKey(t), count = profile.reminderDay === today ? (profile.reminderEmails || 0) : 0, entries = [];
            tx.update(taskRef, { reminderSentAt: t });
            const base = { uid, taskId: task.id, at: t, memberName: profile.name || profile.email || '' };
            if (profile.emailReminders && profile.email) {
              const skip = !profile.emailVerified ? 'Email not verified yet' : count >= emailLimits.remindersPerDay ? 'Daily email limit reached' : '';
              entries.push({ ...base, id: uuid(), channel: 'email', to: profile.email, subject: 'Daymark: your task deadline is close', body: `Hi ${profile.name || 'there'}, "${current.data().title}" is due soon. Open Daymark and submit proof before the timer ends.`, status: skip ? 'skipped' : 'queued', detail: skip });
              if (!skip) tx.update(userRef, { reminderDay: today, reminderEmails: count + 1 });
            }
            if (profile.smsReminders && profile.phone) entries.push({ ...base, id: uuid(), channel: 'sms', to: profile.phone, subject: '', body: `Daymark: "${current.data().title}" is due soon. Submit proof before the timer ends.`, status: 'simulated', detail: '' });
            return { entries, name: profile.name || '' };
          });
          const results = [];
          for (const entry of plan?.entries || []) {
            if (entry.status === 'queued') {
              try { const sent = await sendEmail({ to: entry.to, name: plan.name || 'Daymark', subject: entry.subject, message: entry.body }); entry.status = sent.delivered ? 'sent' : 'simulated'; entry.detail = sent.delivered ? '' : 'Local development: not delivered'; }
              catch (error) { entry.status = 'failed'; entry.detail = error.message; }
            }
            try { await setDoc(doc(db, 'outbox', entry.id), entry); } catch (error) { console.error(error); }
            results.push({ channel: entry.channel, to: entry.to, status: entry.status, detail: entry.detail });
          }
          return results;
        },

        warmUpAi: onProgress => aiReview.warmUp(onProgress).catch(() => {}),
        signOut: () => backend.signOut()
      };
    }
  };
  return backend;
}

/** Browser entry point used by auth.js. */
export async function createCloudBackend() {
  const [{ loadFirebase }, { sendEmail }, { prepareProofImage, scoreProof }, vision] = await Promise.all([import('./firebase-loader.js'), import('./email-service.js'), import('./ai-review.js'), import('./ai-vision.js')]);
  const { sdk, auth, db } = await loadFirebase();
  return createFirestoreBackend({ sdk, auth, db, sendEmail, prepareProofImage, scoreProof, aiReview: { reviewContent: vision.reviewContent, combineVerdicts: vision.combineVerdicts, warmUp: vision.warmUp } });
}
