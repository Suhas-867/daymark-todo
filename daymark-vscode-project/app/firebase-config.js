// Firebase web config is public by design; protect data with Firebase Auth and Security Rules.
// While these values are placeholders (REPLACE_...) the app runs in demo mode (data stays in each
// browser). With real values, accounts, tasks and proofs are stored online and shared across devices
// (see SETUP.md).
export const firebaseConfig = {
  apiKey: 'AIzaSyBpiUmZMggGiahPyA0iU89EpMtbJ9Icq1I',
  authDomain: 'daymark0.firebaseapp.com',
  projectId: 'daymark0',
  storageBucket: 'daymark0.firebasestorage.app',
  messagingSenderId: '1006000344533',
  appId: '1:1006000344533:web:fbf1495d4de6c2141fc15c'
};
export const firebaseReady = Object.values(firebaseConfig).every(value => value && !value.startsWith('REPLACE_'));
