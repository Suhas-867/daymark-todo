// Admin console entry point: Firebase when configured, otherwise the live in-browser demo.
import { firebaseReady } from '../firebase-config.js';

// Add ?demo to the address to force the in-browser demo console.
if (firebaseReady && !new URLSearchParams(location.search).has('demo')) import('./admin-firestore.js');
else import('./admin-demo.js');
