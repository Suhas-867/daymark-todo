// Firebase web config is public by design; protect data with Firebase Auth and Security Rules.
// Replace these placeholders with your Firebase web app values (see SETUP.md). While they are
// placeholders the app runs in demo mode (data stays in each browser); once filled in, accounts,
// tasks and proofs are stored online and shared across devices.
export const firebaseConfig = {
  apiKey: 'REPLACE_WITH_FIREBASE_API_KEY',
  authDomain: 'REPLACE_WITH_PROJECT.firebaseapp.com',
  projectId: 'REPLACE_WITH_PROJECT_ID',
  storageBucket: 'REPLACE_WITH_PROJECT.firebasestorage.app',
  messagingSenderId: 'REPLACE_WITH_SENDER_ID',
  appId: 'REPLACE_WITH_APP_ID'
};
export const firebaseReady = Object.values(firebaseConfig).every(value => value && !value.startsWith('REPLACE_'));
