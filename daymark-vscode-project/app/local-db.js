// Demo-mode backend: accounts, tasks, proof review, points and reminders stored in the browser.
// The user app (/) and the admin console (/admin/) share this database through localStorage, so
// changes made in one tab show up live in the other. It is a prototype: data stays on this device,
// passwords are only hashed client-side and email/SMS are simulated in an outbox.
import { FREE_TASK_LIMIT, applyPointDelta, emptyRewards, extendDemoMembership, hasActiveMembership } from './rewards.js';
import { emailLimits } from './messaging-config.js';

export const DB_KEY = 'daymark.demo.db.v1';
export const SESSION_KEY = 'daymark.demo.session.v1';
export const ADMIN_SESSION_KEY = 'daymark.demo.admin-session.v1';
export const PROOF_PREFIX = 'daymark.demo.proof.';
export const DEMO_ADMIN = Object.freeze({ email: 'admin@daymark.demo', password: 'Admin@12345' });
export const POINTS_ON_TIME = 100;
export const POINTS_PENALTY = 500;
export { FREE_TASK_LIMIT };

const emptyDb = () => ({ v: 1, users: {}, tasks: {}, sessions: {}, queue: {}, outbox: [] });
const newId = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export class DemoError extends Error {}
const fail = message => { throw new DemoError(message); };

/** Classify and normalise an email address or phone number. */
export function parseContact(raw) {
  const value = String(raw ?? '').trim();
  if (!value) fail('Enter your email address or phone number.');
  if (value.includes('@')) {
    if (!EMAIL.test(value)) fail('Enter a valid email address.');
    return { type: 'email', value: value.toLowerCase() };
  }
  const digits = value.replace(/[\s().-]/g, '');
  if (/^[6-9]\d{9}$/.test(digits)) return { type: 'phone', value: `+91${digits}` };
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return { type: 'phone', value: digits };
  return fail('Enter a valid email address, or a phone number with its country code (for example +91 98765 43210).');
}

async function hashPassword(password, salt) {
  const text = `${salt}:${password}`;
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  let h = 5381; for (const char of text) h = ((h << 5) + h + char.codePointAt(0)) >>> 0; return `weak-${h.toString(16)}`;
}

const publicUser = user => user && ({
  uid: user.uid, name: user.name, email: user.email, phone: user.phone, emailReminders: user.emailReminders,
  smsReminders: user.smsReminders, emailVerified: Boolean(user.emailVerified), trialTasksUsed: user.trialTasksUsed, createdAt: user.createdAt
});

export function createLocalDb(storage = globalThis.localStorage, { now = () => Date.now() } = {}) {
  const listeners = new Set();
  const read = () => {
    try { const parsed = JSON.parse(storage.getItem(DB_KEY) || 'null'); return parsed?.v === 1 ? { ...emptyDb(), ...parsed } : emptyDb(); } catch { return emptyDb(); }
  };
  const emit = () => listeners.forEach(listener => { try { listener(); } catch (error) { console.error(error); } });
  function mutate(change) {
    const db = read(); const result = change(db);
    try { storage.setItem(DB_KEY, JSON.stringify(db)); } catch { fail('Browser storage is full. Delete old tasks or use "Reset demo data" in the admin console.'); }
    emit(); return result;
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('storage', event => { if (event.key === DB_KEY || event.key === null) emit(); });
  }

  const sessionRewards = session => ({ ...emptyRewards(), membershipStartedAt: session.membershipStartedAt, membershipExpiresAt: session.membershipExpiresAt, points: session.points, milestonesReached: session.milestonesReached, demoRupeesEarned: session.demoRupeesEarned });
  function award(db, uid, fallbackSessionId, delta) {
    const sid = db.users[uid]?.activeSessionId || fallbackSessionId, session = db.sessions[sid];
    if (!session) return;
    const result = applyPointDelta(sessionRewards(session), delta);
    Object.assign(session, { points: result.rewards.points, milestonesReached: result.rewards.milestonesReached, demoRupeesEarned: result.rewards.demoRupeesEarned });
  }
  function settle(db, entry, outcome, reason, reviewer) {
    const task = db.tasks[entry.taskId], stamp = new Date(now()).toISOString();
    entry.status = outcome === 'approve' ? 'approved' : 'rejected'; entry.reviewedAt = stamp; entry.reviewReason = reason; entry.reviewer = reviewer;
    if (!task) return;
    task.reviewedAt = stamp; task.reviewReason = reason; task.reviewer = reviewer;
    if (outcome === 'approve') { task.status = 'approved'; award(db, entry.uid, task.sessionId, POINTS_ON_TIME); return; }
    if (Date.parse(task.deadlineAt) > now()) task.status = 'pending';
    else { task.status = 'failed'; task.failedAt = stamp; award(db, entry.uid, task.sessionId, -POINTS_PENALTY); }
  }

  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    read,
    reset() {
      const proofKeys = [];
      for (let i = 0; i < storage.length; i++) { const key = storage.key(i); if (key?.startsWith(PROOF_PREFIX)) proofKeys.push(key); }
      proofKeys.forEach(key => storage.removeItem(key)); storage.removeItem(SESSION_KEY);
      mutate(db => { Object.assign(db, emptyDb()); });
    },

    async signUp({ name = '', identifier, extraContact = '', password, emailReminders = false, smsReminders = false }) {
      if (String(password || '').length < 8) fail('Choose a password with at least 8 characters.');
      const primary = parseContact(identifier), extra = String(extraContact).trim() ? parseContact(extraContact) : null;
      if (extra && extra.type === primary.type) fail(`Your extra contact must be a ${primary.type === 'email' ? 'phone number' : 'email address'}.`);
      const email = [primary, extra].find(contact => contact?.type === 'email')?.value || '', phone = [primary, extra].find(contact => contact?.type === 'phone')?.value || '';
      if (emailReminders && !email) fail('Add an email address to receive email reminders, or untick that option.');
      if (smsReminders && !phone) fail('Add a phone number to receive text reminders, or untick that option.');
      if (email === DEMO_ADMIN.email) fail('That address is reserved. Please use another one.');
      const salt = newId(), passHash = await hashPassword(password, salt);
      return mutate(db => {
        const clash = Object.values(db.users).find(user => (email && user.email === email) || (phone && user.phone === phone));
        if (clash) fail('An account with these details already exists. Sign in instead.');
        const uid = newId();
        db.users[uid] = { uid, name: String(name).trim().slice(0, 60), email, phone, salt, passHash, emailReminders, smsReminders, consentUpdatedAt: new Date(now()).toISOString(), emailVerified: false, emailCode: null, trialTasksUsed: 0, activeSessionId: null, createdAt: new Date(now()).toISOString() };
        return publicUser(db.users[uid]);
      });
    },
    async signIn({ identifier, password }) {
      const contact = parseContact(identifier), db = read();
      const user = Object.values(db.users).find(candidate => candidate[contact.type] === contact.value);
      if (!user || user.passHash !== await hashPassword(String(password || ''), user.salt)) fail('Incorrect email/phone or password.');
      return publicUser(user);
    },
    getUser(uid) { return publicUser(read().users[uid]) || null; },
    updatePreferences(uid, { name, email, phone, emailReminders, smsReminders }) {
      const cleanEmail = String(email ?? '').trim() ? parseContact(email) : null, cleanPhone = String(phone ?? '').trim() ? parseContact(phone) : null;
      if (cleanEmail && cleanEmail.type !== 'email') fail('Enter a valid email address.');
      if (cleanPhone && cleanPhone.type !== 'phone') fail('Enter a valid phone number with its country code.');
      return mutate(db => {
        const user = db.users[uid] || fail('Account not found. Please sign in again.');
        const nextEmail = cleanEmail?.value ?? '', nextPhone = cleanPhone?.value ?? '';
        if (emailReminders && !nextEmail) fail('Add an email address to receive email reminders.');
        if (smsReminders && !nextPhone) fail('Add a phone number (with country code) to receive text reminders.');
        const clash = Object.values(db.users).find(other => other.uid !== uid && ((nextEmail && other.email === nextEmail) || (nextPhone && other.phone === nextPhone)));
        if (clash) fail('Another account already uses that email or phone number.');
        if (nextEmail !== user.email) { user.emailVerified = false; if (user.emailCode) user.emailCode = { ...user.emailCode, hash: null }; } // a new address must be verified again; send counters are kept
        Object.assign(user, { name: String(name ?? user.name).trim().slice(0, 60), email: nextEmail, phone: nextPhone, emailReminders: Boolean(emailReminders), smsReminders: Boolean(smsReminders), consentUpdatedAt: new Date(now()).toISOString() });
        return publicUser(user);
      });
    },

    /** Create a one-time email code. The caller emails it. Throws if sent too often. */
    async startEmailVerification(uid) {
      const code = String(globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
      const hash = await hashPassword(code, uid);
      return mutate(db => {
        const user = db.users[uid] || fail('Account not found. Please sign in again.');
        if (!user.email) fail('Add an email address first.');
        if (user.emailVerified) fail('This email address is already verified.');
        const t = now(), old = user.emailCode || {};
        const wait = Math.ceil(((old.sentAt || 0) + emailLimits.codeCooldownSeconds * 1000 - t) / 1000);
        if (wait > 0) fail(`A code was just sent. You can request another in ${wait} seconds.`);
        const windowStart = old.windowStart && t - old.windowStart < 3600_000 ? old.windowStart : t, sentCount = windowStart === old.windowStart ? (old.sentCount || 0) : 0;
        if (sentCount >= emailLimits.codesPerHour) fail('Too many codes requested. Please try again in an hour.');
        user.emailCode = { hash, email: user.email, expiresAt: t + emailLimits.codeLifetimeMinutes * 60_000, attempts: 0, sentAt: t, windowStart, sentCount: sentCount + 1 };
        return { code, email: user.email, expiresInMinutes: emailLimits.codeLifetimeMinutes };
      });
    },
    async confirmEmailVerification(uid, code) {
      const clean = String(code ?? '').trim(), hash = await hashPassword(clean, uid);
      // Failures are returned (not thrown) from inside mutate so that attempt counts are saved.
      const outcome = mutate(db => {
        const user = db.users[uid] || fail('Account not found. Please sign in again.'), pending = user.emailCode;
        if (user.emailVerified) return { verified: true };
        if (!pending?.hash || pending.email !== user.email) return { problem: 'Request a new code first.' };
        if (now() > pending.expiresAt) { user.emailCode = { ...pending, hash: null }; return { problem: 'That code has expired. Request a new one.' }; }
        if (pending.attempts >= emailLimits.maxCodeAttempts) { user.emailCode = { ...pending, hash: null }; return { problem: 'Too many wrong attempts. Request a new code.' }; }
        if (!/^\d{6}$/.test(clean) || hash !== pending.hash) { pending.attempts += 1; return { problem: `That code is not correct. ${emailLimits.maxCodeAttempts - pending.attempts} attempts left.` }; }
        user.emailVerified = true; user.emailCode = null; user.emailVerifiedAt = new Date(now()).toISOString();
        return { verified: true };
      });
      if (outcome.problem) fail(outcome.problem);
      return outcome;
    },

    startSession(uid, sessionId) {
      mutate(db => {
        const user = db.users[uid] || fail('Account not found. Please sign in again.');
        if (!db.sessions[sessionId]) db.sessions[sessionId] = { id: sessionId, uid, ...emptyRewards(), createdAt: new Date(now()).toISOString() };
        user.activeSessionId = sessionId;
      });
    },
    getSession(sessionId) { const session = read().sessions[sessionId]; return session ? { ...session } : null; },

    createTask(uid, sessionId, { title, durationMinutes }) {
      const clean = String(title ?? '').trim(), minutes = Number(durationMinutes);
      if (!clean || clean.length > 120) fail('Enter a task of up to 120 characters.');
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) fail('Choose a timer from 1 minute to 24 hours.');
      return mutate(db => {
        const user = db.users[uid] || fail('Account not found. Please sign in again.'), session = db.sessions[sessionId];
        const member = session && hasActiveMembership(sessionRewards(session), new Date(now()));
        if (!member && user.trialTasksUsed >= FREE_TASK_LIMIT) fail('Your 10 free task trials are over. Get membership for full access.');
        if (!member) user.trialTasksUsed += 1;
        const id = newId(), created = now();
        db.tasks[id] = { id, uid, sessionId, title: clean, durationMinutes: minutes, createdAt: new Date(created).toISOString(), deadlineAt: new Date(created + minutes * 60_000).toISOString(), status: 'pending' };
        return { ...db.tasks[id] };
      });
    },
    activateMembership(uid, sessionId) {
      return mutate(db => {
        const session = db.sessions[sessionId] || fail('Session expired. Refresh the page.');
        const before = session.membershipExpiresAt, next = extendDemoMembership(sessionRewards(session), new Date(now()));
        session.membershipStartedAt = next.membershipStartedAt; session.membershipExpiresAt = next.membershipExpiresAt;
        return { expiresAt: session.membershipExpiresAt, alreadyActive: Boolean(before) && before === next.membershipExpiresAt };
      });
    },
    deleteTask(uid, taskId) {
      mutate(db => {
        const task = db.tasks[taskId]; if (!task || task.uid !== uid) return;
        if (task.proofId) { delete db.queue[task.proofId]; storage.removeItem(PROOF_PREFIX + task.proofId); }
        delete db.tasks[taskId];
      });
    },
    expireTask(uid, taskId) {
      return mutate(db => {
        const task = db.tasks[taskId];
        if (!task || task.uid !== uid || task.status !== 'pending' || Date.parse(task.deadlineAt) > now()) return { failed: false };
        task.status = 'failed'; task.failedAt = new Date(now()).toISOString(); award(db, uid, task.sessionId, -POINTS_PENALTY);
        return { failed: true };
      });
    },

    submitProof(uid, taskId, { dataUrl, mode, fileName = '', fingerprint = '', width = 0, height = 0, score = null }) {
      if (!['ai', 'manual'].includes(mode)) fail('Choose AI review or manual review.');
      const proofId = newId();
      try { storage.setItem(PROOF_PREFIX + proofId, dataUrl); } catch { fail('Browser storage is full. Delete old tasks or use a smaller image.'); }
      try {
        return mutate(db => {
          const task = db.tasks[taskId];
          if (!task || task.uid !== uid || task.status !== 'pending') fail('This task is no longer waiting for proof.');
          if (Date.parse(task.deadlineAt) <= now()) fail('The task timer has already ended.');
          const user = db.users[uid], stamp = new Date(now()).toISOString();
          Object.assign(task, { status: 'review', proofId, reviewMode: mode, submittedAt: stamp, reviewReason: '' });
          db.queue[proofId] = { proofId, uid, taskId, title: task.title, mode, status: 'pending', aiState: mode === 'ai' ? 'analyzing' : 'none', aiSuggestion: '', aiReason: '', aiScore: score, fingerprint, fileName: String(fileName).slice(0, 120), width, height, submittedAt: stamp, memberName: user?.name || user?.email || user?.phone || 'Member', memberContact: user?.email || user?.phone || '' };
          return { proofId };
        });
      } catch (error) { storage.removeItem(PROOF_PREFIX + proofId); throw error; }
    },
    findDuplicate(uid, fingerprint, ignoreProofId, maxDistance = 3) {
      if (!fingerprint) return null;
      const db = read(), bits = value => value.split('').map(char => parseInt(char, 16).toString(2).padStart(4, '0')).join('');
      for (const entry of Object.values(db.queue)) {
        if (entry.uid !== uid || entry.proofId === ignoreProofId || !entry.fingerprint || !db.tasks[entry.taskId]) continue;
        let distance = 0; const a = bits(fingerprint), b = bits(entry.fingerprint);
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) distance++;
        if (distance <= maxDistance) return entry.proofId;
      }
      return null;
    },
    /** AI outcome: 'approve' | 'reject' | 'needs_human'. */
    recordAiResult(proofId, { decision, reason, score }) {
      return mutate(db => {
        const entry = db.queue[proofId];
        if (!entry || entry.status !== 'pending') return { applied: false };
        entry.aiState = 'done'; entry.aiScore = score; entry.aiSuggestion = decision; entry.aiReason = reason;
        if (decision === 'approve') settle(db, entry, 'approve', `AI review approved this proof. ${reason}`, 'ai');
        else if (decision === 'reject') settle(db, entry, 'reject', `AI review could not verify this proof. ${reason}`, 'ai');
        return { applied: true, decision };
      });
    },
    /** If the page was closed while the AI was thinking, hand those proofs to a human. */
    recoverInterruptedAi(uid, olderThanMs) {
      mutate(db => {
        for (const entry of Object.values(db.queue)) {
          if (entry.uid !== uid || entry.status !== 'pending' || entry.aiState !== 'analyzing' || now() - Date.parse(entry.submittedAt) < olderThanMs) continue;
          Object.assign(entry, { aiState: 'done', aiSuggestion: 'needs_human', aiReason: 'The AI check was interrupted, so an admin needs to review this proof.' });
        }
      });
    },
    adminReview(proofId, decision, note = '') {
      if (!['approve', 'reject'].includes(decision)) fail('Choose approve or reject.');
      return mutate(db => {
        const entry = db.queue[proofId];
        if (!entry || entry.status !== 'pending') fail('This proof has already been reviewed.');
        const cleanNote = String(note).trim().slice(0, 300);
        settle(db, entry, decision, cleanNote || (decision === 'approve' ? 'Approved by an admin.' : 'An admin asked for clearer proof.'), 'admin');
        return { ok: true };
      });
    },
    getProof(proofId) { try { return storage.getItem(PROOF_PREFIX + proofId); } catch { return null; } },

    /**
     * Record the deadline reminder once per task for the channels the member opted into.
     * Email goes out only to a verified address (and within the daily budget); SMS stays simulated
     * until a relay is configured. Returns outbox entries; the caller delivers the queued emails.
     */
    sendDeadlineReminder(uid, taskId, { smsLive = false } = {}) {
      return mutate(db => {
        const task = db.tasks[taskId], user = db.users[uid];
        if (!task || !user || task.status !== 'pending' || task.reminderSentAt) return [];
        task.reminderSentAt = new Date(now()).toISOString();
        const sent = [], base = { uid, taskId, at: task.reminderSentAt };
        const emailsToday = db.outbox.filter(m => m.uid === uid && m.channel === 'email' && m.status !== 'skipped' && now() - Date.parse(m.at) < 86_400_000).length;
        if (user.emailReminders && user.email) {
          const skip = !user.emailVerified ? 'Email not verified yet' : emailsToday >= emailLimits.remindersPerDay ? 'Daily email limit reached' : '';
          sent.push({ ...base, id: newId(), channel: 'email', to: user.email, subject: 'Daymark: your task deadline is close', body: `Hi ${user.name || 'there'}, "${task.title}" is due soon. Open Daymark and submit proof before the timer ends.`, status: skip ? 'skipped' : 'queued', detail: skip });
        }
        if (user.smsReminders && user.phone) sent.push({ ...base, id: newId(), channel: 'sms', to: user.phone, subject: '', body: `Daymark: "${task.title}" is due soon. Submit proof before the timer ends.`, status: smsLive ? 'queued' : 'simulated', detail: '' });
        db.outbox = [...sent, ...db.outbox].slice(0, 200);
        return sent;
      });
    },
    settleOutbox(id, status, detail = '') {
      mutate(db => { const entry = db.outbox.find(message => message.id === id); if (entry) { entry.status = status; entry.detail = String(detail).slice(0, 200); } });
    },

    adminSnapshot() {
      const db = read(), queue = Object.values(db.queue).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
      const reviewed = queue.filter(entry => entry.status !== 'pending'), today = new Date(now()).toDateString();
      return {
        pending: queue.filter(entry => entry.status === 'pending'), reviewed,
        members: Object.values(db.users).map(user => ({ ...publicUser(user), tasks: Object.values(db.tasks).filter(task => task.uid === user.uid).length })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        outbox: db.outbox,
        stats: { waiting: queue.length - reviewed.length, approvedToday: reviewed.filter(entry => entry.status === 'approved' && new Date(entry.reviewedAt).toDateString() === today).length, aiDecided: reviewed.filter(entry => entry.reviewer === 'ai').length, members: Object.keys(db.users).length }
      };
    },
    userSnapshot(uid, sessionId) {
      const db = read(), session = db.sessions[sessionId] || emptyRewards();
      return {
        profile: publicUser(db.users[uid]) || null,
        session: { points: session.points || 0, milestonesReached: session.milestonesReached || 0, earnedRupees: session.demoRupeesEarned || 0, membershipExpiresAt: session.membershipExpiresAt || null },
        tasks: Object.values(db.tasks).filter(task => task.uid === uid).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(task => ({ ...task, aiState: db.queue[task.proofId]?.aiState || 'none', createdAt: Date.parse(task.createdAt), deadlineAt: Date.parse(task.deadlineAt) }))
      };
    }
  };
}
