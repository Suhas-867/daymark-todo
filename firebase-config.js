// Firebase web config is public by design; protect data with Firebase Auth and Security Rules.
// Replace these placeholders with the project's Firebase web app values before deployment.
export const firebaseConfig = {
  apiKey: 'REPLACE_WITH_FIREBASE_API_KEY',
  authDomain: 'REPLACE_WITH_PROJECT.firebaseapp.com',
  projectId: 'REPLACE_WITH_PROJECT_ID',
  storageBucket: 'REPLACE_WITH_PROJECT.firebasestorage.app',
  messagingSenderId: 'REPLACE_WITH_SENDER_ID',
  appId: 'REPLACE_WITH_APP_ID'
};
export const firebaseReady = Object.values(firebaseConfig).every(value => value && !value.startsWith('REPLACE_'));
