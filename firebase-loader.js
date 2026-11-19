// Loads the Firebase web SDK from Google's CDN and hands the app the few functions it uses.
// Only used when firebase-config.js has real project values; demo mode never touches the network.
import { firebaseConfig } from './firebase-config.js';

const CDN = 'https://www.gstatic.com/firebasejs/11.10.0';

export async function loadFirebase() {
  const [{ initializeApp }, authLib, store] = await Promise.all([import(`${CDN}/firebase-app.js`), import(`${CDN}/firebase-auth.js`), import(`${CDN}/firebase-firestore.js`)]);
  const app = initializeApp(firebaseConfig), auth = authLib.getAuth(app), db = store.getFirestore(app);
  const { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail, sendEmailVerification } = authLib;
  const { doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, runTransaction, onSnapshot, query, where, orderBy, limit, writeBatch } = store;
  return { auth, db, sdk: { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail, sendEmailVerification, doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, runTransaction, onSnapshot, query, where, orderBy, limit, writeBatch } };
}
