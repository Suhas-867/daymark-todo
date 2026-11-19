// A small in-memory stand-in for the Firebase JS SDK subset the app uses (Auth + Firestore), so the
// backend logic can be tested with several "devices" sharing one project. It does NOT enforce
// firestore.rules; those need the real Firebase emulator.
const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

export function createFakeProject() {
  const store = new Map(), watchers = new Set(), accounts = new Map(), outbound = { passwordResets: [], verifications: [] };
  let counter = 0, lock = Promise.resolve();

  const parent = path => path.split('/').slice(0, -1).join('/');
  const snapOf = path => ({ id: path.split('/').pop(), ref: { path }, exists: () => store.has(path), data: () => clone(store.get(path)) });
  const notify = () => { for (const watcher of [...watchers]) watcher(); };
  const write = (path, data) => { store.set(path, clone(data)); };

  const db = { fake: true };
  const sdk = {
    doc(base, ...segments) {
      const path = base.isCollection ? (segments.length ? `${base.path}/${segments[0]}` : `${base.path}/auto-${++counter}`) : segments.join('/');
      return { path, id: path.split('/').pop(), isCollection: false };
    },
    collection: (base, ...segments) => ({ path: segments.join('/'), isCollection: true }),
    where: (field, op, value) => { if (op !== '==') throw new Error('fake supports == only'); return { type: 'where', field, op, value }; },
    orderBy: (field, direction) => ({ type: 'orderBy', field, direction }),
    limit: count => ({ type: 'limit', count }),
    query: (source, ...constraints) => ({ ...source, constraints }),
    async getDoc(ref) { return snapOf(ref.path); },
    async getDocs(source) { return collectionSnapshot(source); },
    async setDoc(ref, data, options = {}) { write(ref.path, options.merge ? { ...(store.get(ref.path) || {}), ...data } : data); notify(); },
    async updateDoc(ref, data) { if (!store.has(ref.path)) throw new Error(`No document to update: ${ref.path}`); write(ref.path, { ...store.get(ref.path), ...data }); notify(); },
    async deleteDoc(ref) { store.delete(ref.path); notify(); },
    writeBatch() {
      const operations = [];
      return {
        set: (ref, data) => operations.push(() => write(ref.path, data)), update: (ref, data) => operations.push(() => write(ref.path, { ...store.get(ref.path), ...data })),
        delete: ref => operations.push(() => store.delete(ref.path)), async commit() { operations.forEach(run => run()); notify(); }
      };
    },
    runTransaction(_db, work) {
      const run = async () => {
        const staged = [];
        const tx = {
          async get(ref) { return snapOf(ref.path); },
          set: (ref, data) => staged.push(() => write(ref.path, data)),
          update: (ref, data) => staged.push(() => { if (!store.has(ref.path)) throw new Error(`No document to update: ${ref.path}`); write(ref.path, { ...store.get(ref.path), ...data }); }),
          delete: ref => staged.push(() => store.delete(ref.path))
        };
        const result = await work(tx);
        staged.forEach(apply => apply()); notify();
        return result;
      };
      const next = lock.then(run, run); lock = next.catch(() => {}); return next;
    },
    onSnapshot(source, next, onError) {
      let last = '';
      const emit = () => {
        try {
          const snapshot = source.isCollection === undefined || source.isCollection === false ? snapOf(source.path) : collectionSnapshot(source);
          const signature = JSON.stringify(source.isCollection ? snapshot.docs.map(d => [d.id, d.data()]) : [snapshot.exists(), snapshot.data()]);
          if (signature !== last) { last = signature; next(snapshot); }
        } catch (error) { onError?.(error); }
      };
      watchers.add(emit); queueMicrotask(emit);
      return () => watchers.delete(emit);
    },

    /* ----- auth ----- */
    async createUserWithEmailAndPassword(auth, email, password) {
      const key = email.toLowerCase();
      if (accounts.has(key)) throw Object.assign(new Error('exists'), { code: 'auth/email-already-in-use' });
      if (password.length < 6) throw Object.assign(new Error('weak'), { code: 'auth/weak-password' });
      const user = { uid: `uid-${accounts.size + 1}`, email: key, emailVerified: false }; accounts.set(key, { user, password });
      setUser(auth, user); return { user };
    },
    async signInWithEmailAndPassword(auth, email, password) {
      const account = accounts.get(email.toLowerCase());
      if (!account || account.password !== password) throw Object.assign(new Error('bad'), { code: 'auth/invalid-credential' });
      setUser(auth, account.user); return { user: account.user };
    },
    async signOut(auth) { setUser(auth, null); },
    onAuthStateChanged(auth, callback) { auth.listeners.add(callback); queueMicrotask(() => callback(auth.currentUser)); return () => auth.listeners.delete(callback); },
    async sendPasswordResetEmail(_auth, email) { outbound.passwordResets.push(email); },
    async sendEmailVerification(user) { outbound.verifications.push(user.email); }
  };

  function collectionSnapshot(source) {
    const constraints = source.constraints || [], paths = [...store.keys()].filter(path => parent(path) === source.path && constraints.every(c => c.type !== 'where' || store.get(path)?.[c.field] === c.value));
    const docs = paths.map(snapOf); return { docs, size: docs.length, empty: docs.length === 0 };
  }
  function setUser(auth, user) { auth.currentUser = user; auth.listeners.forEach(callback => queueMicrotask(() => callback(user))); }
  const newDevice = () => ({ currentUser: null, listeners: new Set() });
  const stored = path => clone(store.get(path));
  return { sdk, db, newDevice, store, stored, outbound, accounts };
}
