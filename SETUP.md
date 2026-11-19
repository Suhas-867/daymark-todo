# Daymark setup

Daymark runs in two modes.

## Demo mode (default, no setup)

If `firebase-config.js` still contains the `REPLACE_…` placeholders, the app and the admin console use the built-in demo backend. Nothing to configure:

1. Serve the folder (`python -m http.server 8000`) or open the GitHub Pages site.
2. Create an account in the app, then open `/admin/` in another tab of the **same browser**.
3. Sign in to the admin console with `admin@daymark.demo` / `Admin@12345`.

Everything is stored in that browser's `localStorage`, so it does not sync between devices.

### Real email in demo mode (EmailJS)

Verified members get real reminder emails. `messaging-config.js` holds the public EmailJS ids (service, template, public key). To use your own account:

1. Create an EmailJS account, connect an email service and create a template with **To email** = `{{to_email}}`, and the variables `{{name}}`, `{{time}}`, `{{message}}` (optionally `{{subject}}` as the template subject).
2. Put your Service ID, Template ID and Public Key in `messaging-config.js`. These are public identifiers; never add a private key.
3. In EmailJS → Security add your site's origin (for example `https://suhas-867.github.io`) as the allowed domain if your plan allows it. The free plan allows 200 requests a month, one domain, and shows a footer.

Emails are sent from the open page. On `localhost` delivery is skipped (EmailJS rejects that origin) and the verification code is displayed instead. The email path has limits: 5 verification codes an hour, a 60-second resend cooldown, 5 wrong attempts per code and 20 reminder emails a day per member.

### Real text messages in demo mode (Twilio + Cloudflare Worker)

Twilio's secrets cannot live in a web page, so `worker/sms-relay.js` is a tiny Cloudflare Worker that holds them. Follow [`worker/README.md`](worker/README.md), then put the Worker URL in `smsConfig.relayUrl` in `messaging-config.js`. Until that URL is set, text messages are simulated and shown in the admin *Reminder outbox*. Phone numbers are verified with a texted 6-digit code (3 codes an hour, 5 attempts per code) and each member gets at most 5 reminder texts a day. A Twilio trial can only text numbers you verified in Twilio and starts each message with a trial notice.

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
