# Daymark setup

Daymark runs in two modes.

## Demo mode (default, no setup)

If `firebase-config.js` still contains the `REPLACE_…` placeholders, the app and the admin console use the built-in demo backend. Nothing to configure:

1. Serve the folder (`python -m http.server 8000`) or open the GitHub Pages site.
2. Create an account in the app, then open `/admin/` in another tab of the **same browser**.
3. Sign in to the admin console with `admin@daymark.demo` / `Admin@12345`.

Everything is stored in that browser's `localStorage`, so it does not sync between devices. Email and SMS reminders are simulated in the admin *Reminder outbox*.

## Live mode (real accounts, sync across devices, real messages)

Keep credentials in Firebase Secret Manager or a trusted local environment. Never paste secrets into `firebase-config.js`, this file or GitHub.

### 1. Create and configure Firebase

1. Create a Firebase project and register a Web app.
2. Enable **Email/Password** and **Phone** in Authentication. For phone sign-in configure allowed regions and test numbers; production phone auth may require billing and SMS quotas.
3. Create Firestore in production mode and enable Cloud Storage.
4. Replace the `REPLACE_…` values in `firebase-config.js` with the Firebase Web app config. These client values are public identifiers; Firestore/Storage rules and Auth protect the data.
5. Add the hosting domain (for example `suhas-867.github.io`) to Authentication → Settings → Authorized domains.
6. Install the Firebase CLI, sign in, and run `firebase use --add`.
7. From this folder run `npm install --prefix functions`, then `firebase deploy --only firestore:rules,storage,functions,hosting`. Cloud Functions, scheduled work and outbound calls need the Blaze plan.

If you host on GitHub Pages instead of Firebase Hosting, enable Pages for the repository and deploy rules and functions with the CLI.

### 2. Server secrets

Set with `firebase functions:secrets:set NAME`, then redeploy functions.

| Secret | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | AI image review. If missing or failing, the proof goes to manual admin review. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | Email deadline reminders. |
| `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM` | SMS deadline reminders. |

The scheduled function runs every minute and sends one reminder within five minutes of a deadline, only on channels the member opted into. SMS needs a verified sender and destination under your provider's rules.

### 3. Grant an admin

Create the intended admin account through the app first. From a trusted machine with Firebase Admin credentials run `node functions/set-admin.js admin@example.com`. The admin signs out and back in, then opens `/admin/`. Regular accounts are rejected.

## Behaviour notes (both modes)

- Membership is a ₹99 / 30-day simulation. No payment is collected. The expiry date is fixed when activated; pressing *Extend membership* again does not move it. It resets with the page session.
- Points, demo rewards and membership are per page session and reset on refresh. Trial usage and tasks belong to the account.
- A task earns +100 only after AI or admin approval. An expired task loses 500 once. AI can make mistakes: uncertain results are escalated to a human.
