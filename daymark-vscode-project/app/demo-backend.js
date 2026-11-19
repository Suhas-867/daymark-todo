// Demo-mode backend wiring: browser auth + the adapter used by user-app.js.
// Everything lives in this browser's localStorage and is shared live with the admin console.
import { SESSION_KEY, createLocalDb } from './local-db.js';
import { prepareProofImage, scoreProof } from './ai-review.js';
import { sendEmail } from './email-service.js';
import { emailLimits } from './messaging-config.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createDemoBackend(storage = window.localStorage) {
  const db = createLocalDb(storage);
  const listeners = new Set();
  const uid = () => { try { return storage.getItem(SESSION_KEY); } catch { return null; } };
  const currentUser = () => { const id = uid(); return id ? db.getUser(id) : null; };
  const notify = () => { const user = currentUser(); listeners.forEach(listener => listener(user)); };
  window.addEventListener('storage', event => { if (event.key === SESSION_KEY) notify(); });

  const backend = {
    mode: 'demo',
    supportsPhoneCode: false,
    db,
    onAuthChange(listener) { listeners.add(listener); listener(currentUser()); },
    async signUp(fields) { const user = await db.signUp(fields); storage.setItem(SESSION_KEY, user.uid); notify(); return user; },
    async signIn(fields) { const user = await db.signIn(fields); storage.setItem(SESSION_KEY, user.uid); notify(); return user; },
    signOut() { storage.removeItem(SESSION_KEY); notify(); },

    createAdapter(user) {
      const sessionId = crypto.randomUUID(); // memory-only: points and membership reset on every refresh
      db.startSession(user.uid, sessionId);
      db.recoverInterruptedAi(user.uid, 15_000);
      return {
        mode: 'demo',
        subscribe(listener) {
          const push = () => { const snapshot = db.userSnapshot(user.uid, sessionId); if (!snapshot.profile) { backend.signOut(); return; } listener(snapshot); };
          push(); return db.subscribe(push);
        },
        async createTask(task) { return db.createTask(user.uid, sessionId, task); },
        async activateMembership() { return db.activateMembership(user.uid, sessionId); },
        async submitProof({ task, file, mode }) {
          const prepared = await prepareProofImage(file);
          if (db.findDuplicate(user.uid, prepared.stats.fingerprint)) throw new Error('This photo looks identical to proof you already used for another task. Please take a new photo.');
          const { proofId } = db.submitProof(user.uid, task.id, { dataUrl: prepared.dataUrl, mode, fileName: file.name, fingerprint: prepared.stats.fingerprint, width: prepared.width, height: prepared.height });
          if (mode === 'ai') runAiReview(proofId, task, file.name, prepared);
          return { status: 'review' };
        },
        async expireTask(task) { return db.expireTask(user.uid, task.id); },
        async deleteTask(task) { db.deleteTask(user.uid, task.id); },
        async savePreferences(preferences) { return db.updatePreferences(user.uid, preferences); },
        supportsEmailVerification: true,
        async sendEmailCode() {
          const { code, email } = await db.startEmailVerification(user.uid), profile = db.getUser(user.uid);
          const result = await sendEmail({ to: email, name: profile?.name || 'Daymark', subject: 'Your Daymark verification code', message: `Your Daymark verification code is ${code}. It expires in ${emailLimits.codeLifetimeMinutes} minutes. If you did not ask for it, you can ignore this email.` });
          return { email, delivered: result.delivered, devCode: result.simulated ? code : null };
        },
        async verifyEmailCode(code) { return db.confirmEmailVerification(user.uid, code); },
        /** Records the reminder, then really emails verified members. Resolves with the final status of each channel. */
        async sendReminder(task) {
          const entries = db.sendDeadlineReminder(user.uid, task.id), profile = db.getUser(user.uid), results = [];
          for (const entry of entries) {
            if (entry.channel === 'email' && entry.status === 'queued') {
              try {
                const sent = await sendEmail({ to: entry.to, name: profile?.name || 'Daymark', subject: entry.subject, message: entry.body });
                entry.status = sent.delivered ? 'sent' : 'simulated'; entry.detail = sent.delivered ? '' : 'Local development: not delivered';
              } catch (error) { entry.status = 'failed'; entry.detail = error.message; }
              db.settleOutbox(entry.id, entry.status, entry.detail);
            }
            results.push({ channel: entry.channel, to: entry.to, status: entry.status, detail: entry.detail });
          }
          return results;
        },
        signOut: () => backend.signOut()
      };
    }
  };

  async function runAiReview(proofId, task, fileName, prepared) {
    await sleep(1500 + Math.random() * 900); // visible "AI is reviewing" moment
    const verdict = scoreProof({ stats: prepared.stats, width: prepared.width, height: prepared.height, taskTitle: task.title, fileName });
    try { db.recordAiResult(proofId, { decision: verdict.decision, reason: `${verdict.reason} (on-device demo check)`, score: verdict.score }); } catch (error) { console.error(error); }
  }
  return backend;
}
