// Demo-mode backend wiring: browser auth + the adapter used by user-app.js.
// Everything lives in this browser's localStorage and is shared live with the admin console.
import { SESSION_KEY, createLocalDb } from './local-db.js';
import { prepareProofImage, scoreProof } from './ai-review.js';
import { combineVerdicts, reviewContent, warmUp } from './ai-vision.js';
import { sendEmail } from './email-service.js';
import { sendSms, smsReady } from './sms-service.js';
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
        warmUpAi: onProgress => warmUp(onProgress).catch(() => {}),
        supportsVerification: { email: true, sms: smsReady() },
        async sendVerificationCode(channel) {
          const profile = db.getUser(user.uid);
          if (channel === 'sms') {
            const { code, target } = await db.startPhoneVerification(user.uid), result = await sendSms({ to: target, kind: 'otp', code });
            return { target, delivered: result.delivered, devCode: result.simulated ? code : null };
          }
          const { code, target } = await db.startEmailVerification(user.uid);
          const result = await sendEmail({ to: target, name: profile?.name || 'Daymark', subject: 'Your Daymark verification code', message: `Your Daymark verification code is ${code}. It expires in ${emailLimits.codeLifetimeMinutes} minutes. If you did not ask for it, you can ignore this email.` });
          return { target, delivered: result.delivered, devCode: result.simulated ? code : null };
        },
        async verifyCode(channel, code) { return channel === 'sms' ? db.confirmPhoneVerification(user.uid, code) : db.confirmEmailVerification(user.uid, code); },
        /** Records the reminder, then really emails / texts verified members. Resolves with the final status of each channel. */
        async sendReminder(task) {
          const entries = db.sendDeadlineReminder(user.uid, task.id, { smsLive: smsReady() }), profile = db.getUser(user.uid), results = [];
          for (const entry of entries) {
            if (entry.status === 'queued') {
              try {
                const sent = entry.channel === 'email'
                  ? await sendEmail({ to: entry.to, name: profile?.name || 'Daymark', subject: entry.subject, message: entry.body })
                  : await sendSms({ to: entry.to, kind: 'reminder', title: task.title });
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

  /** Photo quality + duplicate check first, then a vision model checks that the photo matches the task. */
  async function runAiReview(proofId, task, fileName, prepared) {
    const quality = scoreProof({ stats: prepared.stats, width: prepared.width, height: prepared.height, taskTitle: task.title, fileName });
    let content = null;
    if (quality.decision !== 'reject') { try { content = await reviewContent(prepared.dataUrl, task.title); } catch (error) { console.error('Vision model unavailable', error); } }
    else await sleep(900);
    const verdict = combineVerdicts(quality, content);
    try { db.recordAiResult(proofId, { decision: verdict.decision, reason: `${verdict.reason} (on-device AI)`, score: verdict.score }); } catch (error) { console.error(error); }
  }
  return backend;
}
