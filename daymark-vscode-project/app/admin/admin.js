// Admin console entry point: Firebase when configured, otherwise the live in-browser demo.
import { firebaseReady } from '../firebase-config.js';

if (firebaseReady) import('./admin-firestore.js');
else import('./admin-demo.js');
