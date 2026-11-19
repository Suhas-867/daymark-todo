// Production backend: Firebase Auth + Firestore + Storage + Cloud Functions (see SETUP.md).
// Loaded only when firebase-config.js has real project values; demo mode never touches the network.
import { firebaseConfig } from './firebase-config.js';

const CDN = 'https://www.gstatic.com/firebasejs/13.3.0';
const phonePattern = /^\+[1-9]\d{7,14}$/;

export async function createCloudBackend() {
  const [{ initializeApp }, authLib, store, fnLib, storageLib] = await Promise.all([
    import(`${CDN}/firebase-app.js`), import(`${CDN}/firebase-auth.js`), import(`${CDN}/firebase-firestore.js`),
    import(`${CDN}/firebase-functions.js`), import(`${CDN}/firebase-storage.js`)
  ]);
  const app = initializeApp(firebaseConfig), auth = authLib.getAuth(app), db = store.getFirestore(app);
  const functions = fnLib.getFunctions(app), storage = storageLib.getStorage(app), call = name => fnLib.httpsCallable(functions, name);
  let recaptcha = null, phoneConfirmation = null, profileDraft = null;
  const sessionId = crypto.randomUUID(); // memory-only: points and demo membership reset on refresh

  const backend = {
    mode: 'cloud',
    supportsPhoneCode: true,
    onAuthChange(listener) { authLib.onAuthStateChanged(auth, user => listener(user)); },
    async signUp({ name, identifier, extraContact, password, emailReminders, smsReminders }) {
      const email = String(identifier).trim().toLowerCase();
      if (!email.includes('@')) throw new Error('Create the account with an email address. To use a phone number, choose "Continue with phone verification" below.');
      const phone = String(extraContact || '').replace(/[\s().-]/g, '');
      if (phone && !phonePattern.test(phone)) throw new Error('Enter the phone number with its country code, such as +91…');
      if (smsReminders && !phone) throw new Error('Add a phone number to receive text reminders, or untick that option.');
      const credential = await authLib.createUserWithEmailAndPassword(auth, email, password);
      await store.setDoc(store.doc(db, 'users', credential.user.uid), { name: String(name || '').trim(), email, phone, emailReminders: Boolean(emailReminders), smsReminders: Boolean(smsReminders), createdAt: new Date().toISOString() });
      return credential.user;
    },
    async signIn({ identifier, password }) { return (await authLib.signInWithEmailAndPassword(auth, String(identifier).trim(), password)).user; },
    async signOut() { await authLib.signOut(auth); },
    async startPhone(phone, consent) {
      const clean = String(phone).replace(/[\s().-]/g, ''); if (!phonePattern.test(clean)) throw new Error('Enter a phone number with country code, such as +91…');
      if (!recaptcha) recaptcha = new authLib.RecaptchaVerifier(auth, 'phone-recaptcha', { size: 'invisible' });
      profileDraft = { phone: clean, ...consent }; phoneConfirmation = await authLib.signInWithPhoneNumber(auth, clean, recaptcha);
    },
    async confirmPhone(code) {
      if (!phoneConfirmation) throw new Error('Request a verification code first.');
      const credential = await phoneConfirmation.confirm(String(code).trim());
      await store.setDoc(store.doc(db, 'users', credential.user.uid), { phone: credential.user.phoneNumber || profileDraft?.phone || '', emailReminders: false, smsReminders: Boolean(profileDraft?.smsReminders), createdAt: new Date().toISOString() }, { merge: true });
      return credential.user;
    },

    async createAdapter(user) {
      await call('startUserSession')({ sessionId });
      const [addTask, member, proof, expire, remove] = ['createTimedTask', 'activateDemoMembership', 'submitTaskProof', 'expireTimedTask', 'deleteTimedTask'].map(call);
      const aiBusy = new Set(); let tasks = [], session = { points: 0, earnedRupees: 0, membershipExpiresAt: null }, profile = {};
      const toMs = value => (value?.toMillis ? value.toMillis() : Date.parse(value));
      return {
        mode: 'cloud',
        subscribe(listener) {
          const push = () => listener({ tasks: tasks.map(task => ({ ...task, aiState: aiBusy.has(task.id) ? 'analyzing' : 'none' })), session, profile: { ...profile, email: profile.email || user.email || '', phone: profile.phone || user.phoneNumber || '' } });
          const stops = [
            store.onSnapshot(store.query(store.collection(db, 'users', user.uid, 'tasks'), store.orderBy('createdAt', 'desc')), snap => { tasks = snap.docs.map(d => { const data = d.data(); return { id: d.id, ...data, createdAt: toMs(data.createdAt), deadlineAt: toMs(data.deadlineAt) }; }); push(); }),
            store.onSnapshot(store.doc(db, 'users', user.uid, 'sessions', sessionId), snap => { if (snap.exists()) { const data = snap.data(); session = { points: data.points || 0, earnedRupees: data.earnedRupees || 0, membershipExpiresAt: data.membershipExpiresAt ? toMs(data.membershipExpiresAt) : null }; push(); } }),
            store.onSnapshot(store.doc(db, 'users', user.uid), snap => { profile = snap.exists() ? snap.data() : {}; push(); })
          ];
          return () => stops.forEach(stop => stop());
        },
        async createTask(task) { return (await addTask({ ...task, sessionId })).data; },
        async activateMembership() { const result = (await member({ sessionId })).data; return { expiresAt: result.expiresAt, alreadyActive: /already/i.test(result.message || '') }; },
        async submitProof({ task, file, mode }) {
          const proofId = crypto.randomUUID(), path = `proofs/${user.uid}/${proofId}/${file.name.replace(/[^\w.-]/g, '_')}`, fileRef = storageLib.ref(storage, path);
          await storageLib.uploadBytes(fileRef, file, { contentType: file.type });
          if (mode === 'ai') aiBusy.add(task.id);
          try { await proof({ taskId: task.id, proofId, storagePath: path, mode }); }
          catch (error) { await storageLib.deleteObject(fileRef).catch(() => {}); throw error; }
          finally { aiBusy.delete(task.id); }
          return { status: 'review' };
        },
        async expireTask(task) { return (await expire({ taskId: task.id, sessionId })).data; },
        async deleteTask(task) { await remove({ taskId: task.id }); },
        async savePreferences({ name, email, phone, emailReminders, smsReminders }) {
          const cleanPhone = String(phone || '').replace(/[\s().-]/g, '');
          if (cleanPhone && !phonePattern.test(cleanPhone)) throw new Error('Enter the phone number with its country code, such as +91…');
          if (smsReminders && !cleanPhone) throw new Error('Add a phone number (with country code) to receive text reminders.');
          if (emailReminders && !String(email || '').includes('@')) throw new Error('Add an email address to receive email reminders.');
          await store.setDoc(store.doc(db, 'users', user.uid), { name: String(name || '').trim(), email: String(email || '').trim(), phone: cleanPhone, emailReminders: Boolean(emailReminders), smsReminders: Boolean(smsReminders), preferencesUpdatedAt: new Date().toISOString() }, { merge: true });
        },
        async sendReminder() { return []; }, // reminders are sent by the scheduled Cloud Function
        signOut: () => backend.signOut()
      };
    }
  };
  return backend;
}
