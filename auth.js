// Entry point: sign-in / account creation, then hand over to the dashboard.
// Uses Firebase when firebase-config.js is filled in, otherwise the built-in demo backend.
import { firebaseReady } from './firebase-config.js';
import { startUserApp } from './user-app.js';

const $ = id => document.getElementById(id);
const gate = $('auth-gate'), shell = $('app-shell'), form = $('auth-form');
let backend = null, createMode = true, appStarted = false, activeUserId = null, justSignedUp = false;

function setStatus(message, kind = '') { const el = $('auth-status'); el.textContent = message; el.className = `auth-status${kind ? ` is-${kind}` : ''}`; }
function show(view) { gate.hidden = view !== 'gate'; shell.hidden = view !== 'app'; document.body.classList.toggle('in-app', view === 'app'); }

function setMode(signUp) {
  createMode = signUp;
  $('tab-signup').setAttribute('aria-selected', String(signUp)); $('tab-signin').setAttribute('aria-selected', String(!signUp));
  $('auth-heading').textContent = signUp ? 'Create your account' : 'Welcome back';
  $('auth-sub').textContent = signUp ? 'Use your email or phone number. It takes under a minute.' : 'Sign in with your email or phone number.';
  $('auth-submit').textContent = signUp ? 'Create account' : 'Sign in';
  for (const id of ['field-name', 'field-extra', 'consent-box']) $(id).hidden = !signUp;
  $('forgot-link').hidden = signUp || !backend?.supportsPasswordReset;
  $('auth-password').autocomplete = signUp ? 'new-password' : 'current-password';
  setStatus('');
}
function updateExtraLabel() {
  const typed = $('auth-email').value.trim(), isPhone = typed && !typed.includes('@') && /[\d+]/.test(typed);
  $('label-extra').innerHTML = isPhone ? 'Email address for reminders <em>(optional)</em>' : 'Phone number for text reminders <em>(optional)</em>';
  $('auth-phone').placeholder = isPhone ? 'you@example.com' : '+91 98765 43210';
}

$('tab-signup').addEventListener('click', () => setMode(true));
$('tab-signin').addEventListener('click', () => setMode(false));
$('auth-email').addEventListener('input', updateExtraLabel);
$('password-toggle').addEventListener('click', () => {
  const field = $('auth-password'), reveal = field.type === 'password'; field.type = reveal ? 'text' : 'password';
  $('password-toggle').textContent = reveal ? 'Hide' : 'Show'; $('password-toggle').setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!backend) { setStatus('Still starting up. Try again in a moment.', 'error'); return; }
  const button = $('auth-submit'); button.disabled = true; setStatus(createMode ? 'Creating your account…' : 'Signing in…');
  try {
    const identifier = $('auth-email').value, password = $('auth-password').value;
    if (!identifier.trim() || !password) throw new Error('Enter your email or phone number and your password.');
    if (createMode) {
      const typed = $('auth-phone').value.trim();
      justSignedUp = true;
      await backend.signUp({ name: $('auth-name').value, identifier, extraContact: typed, password, emailReminders: $('consent-email').checked, smsReminders: $('consent-sms').checked });
    } else await backend.signIn({ identifier, password });
    setStatus('');
  } catch (error) { justSignedUp = false; setStatus(error.message || 'Something went wrong. Please try again.', 'error'); }
  finally { button.disabled = false; }
});

/* ---------- forgot password ---------- */
const resetDialog = $('reset-dialog');
function resetMessage(text, kind = '') { const el = $('reset-status'); el.textContent = text; el.className = `dialog-status${kind ? ` is-${kind}` : ''}`; }
$('forgot-link').addEventListener('click', () => {
  $('reset-email').value = $('auth-email').value.includes('@') ? $('auth-email').value.trim() : ''; $('reset-code').value = ''; $('reset-password').value = '';
  $('reset-step2').hidden = true; resetMessage(''); $('reset-send').textContent = 'Email me a code'; resetDialog.showModal(); $('reset-email').focus();
});
$('reset-close').addEventListener('click', () => resetDialog.close());
$('reset-send').addEventListener('click', async () => {
  const button = $('reset-send'); button.disabled = true; resetMessage('Sending…');
  try {
    const result = await backend.requestPasswordReset($('reset-email').value);
    if (result.byLink) { $('reset-step2').hidden = true; $('reset-copy').textContent = `We emailed a password reset link to ${result.target}. Open it to choose a new password, then sign in here.`; resetMessage('Link sent. Check your inbox and spam folder.', 'ok'); return; }
    $('reset-step2').hidden = false; button.textContent = 'Send a new code'; $('reset-code').focus();
    $('reset-copy').textContent = result.delivered ? `We emailed a 6-digit code to ${result.target}. It can take a minute; check spam too.` : `Local development: nothing was sent to ${result.target}. Your test code is ${result.devCode}.`;
    resetMessage('Enter the code and choose a new password.', 'ok');
  } catch (error) { resetMessage(error.message || 'Could not send the code.', 'error'); }
  finally { button.disabled = false; }
});
$('reset-form').addEventListener('submit', async event => {
  event.preventDefault(); if ($('reset-step2').hidden) return;
  const button = $('reset-confirm'); button.disabled = true;
  try {
    await backend.resetPassword({ identifier: $('reset-email').value, code: $('reset-code').value, newPassword: $('reset-password').value });
    resetMessage('Password changed. You can sign in now.', 'ok');
    $('auth-email').value = $('reset-email').value; $('auth-password').value = ''; setMode(false); setStatus('Password changed. Sign in with your new password.', 'ok');
    setTimeout(() => resetDialog.close(), 900);
  } catch (error) { resetMessage(error.message || 'Could not reset the password.', 'error'); }
  finally { button.disabled = false; }
});

async function enterApp(user) {
  if (appStarted && activeUserId === user.uid) { show('app'); return; }
  appStarted = true; activeUserId = user.uid;
  try {
    const adapter = await backend.createAdapter(user);
    startUserApp(adapter, { justSignedUp }); justSignedUp = false; show('app');
  } catch (error) { console.error(error); appStarted = false; activeUserId = null; show('gate'); setStatus(`Could not open your workspace: ${error.message}`, 'error'); }
}

async function boot() {
  setMode(true); updateExtraLabel();
  try {
    if (firebaseReady) {
      const { createCloudBackend } = await import('./firestore-backend.js'); backend = await createCloudBackend();
      $('config-note').textContent = 'Your account and tasks are stored securely online, so you can use any device.';
    } else {
      const { createDemoBackend } = await import('./demo-backend.js'); backend = createDemoBackend();
      $('config-note').textContent = 'Demo mode: your account and data stay in this browser. See SETUP.md to connect a live backend.';
    }
  } catch (error) { show('gate'); setStatus(`Could not start Daymark: ${error.message}`, 'error'); return; }

  setMode(createMode);
  backend.onAuthChange(user => {
    if (user) enterApp(user);
    else {
      if (appStarted) { location.reload(); return; } // clean slate after sign-out
      show('gate');
    }
  });
}
boot();
