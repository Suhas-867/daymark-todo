# Daymark setup

Daymark runs in two modes. The mode is chosen automatically by `firebase-config.js`.

| | Demo mode (default) | Online mode (Firebase free plan) |
| --- | --- | --- |
| Needs setup | No | About 15 minutes, no credit card |
| Where data lives | Each visitor's own browser | A shared online database |
| Customer on one device, admin on another | **No** (same browser only) | **Yes, live** |
| Real email reminders | Yes (EmailJS) | Yes (EmailJS) |

## Online mode: make the admin see customers on other devices

This uses Firebase Authentication and Firestore on the **free Spark plan**. It needs no billing, Cloud Functions or Cloud Storage (proof photos are stored as small compressed images inside Firestore).

### 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and click **Add project**. Name it `daymark`. Turn off Google Analytics. Click **Create**.
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable → Save.**
3. **Authentication → Settings → Authorized domains → Add domain:** `suhas-867.github.io` (and your own domain if you use one).
4. **Build → Firestore Database → Create database.** Pick a location close to you (for example `asia-south1`). Choose **Start in production mode** and click **Create**.

### 2. Publish the security rules

1. In **Firestore Database → Rules**, delete everything and paste the full contents of [`firestore.rules`](firestore.rules).
2. In the pasted text, replace `REPLACE_WITH_ADMIN_EMAIL` with the administrator's email address in **lower case** (for example `someone@example.com`). Keep the quotes.
3. Click **Publish**. If the editor shows a red error, fix the line it points to before publishing.

### 3. Connect the web app

1. **Project settings (gear icon) → General → Your apps → Web (`</>`).** Give it a nickname, leave Firebase Hosting off, click **Register app**.
2. Copy the `firebaseConfig` values (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`) into [`firebase-config.js`](firebase-config.js), replacing the `REPLACE_…` placeholders. These are public identifiers, not secrets; the rules above protect the data.
3. Publish the site. The app and the admin console now use the online database.

### 4. Become the administrator

1. Create an account in the app with the administrator email. Firebase emails a verification link to that address.
2. Click the link, then open `/admin/`, sign in, and press **I have verified**.
3. Only a **verified** account whose address matches the one in the rules can read other members' proofs or make manual decisions. The same address also gets unlimited tasks in the app (list kept in `access-config.js`, stored as a hash).

### Free plan limits

Firestore's free daily quota (about 50,000 reads and 20,000 writes per day) and 1 GB of storage are plenty for a prototype; each compressed proof photo is roughly 100 KB.

### Honest limits of online mode without a server

- The rules stop members from reading each other's data, forging admin decisions, skipping deadlines or exceeding the 10 free tasks. They **cannot** stop a technical member from editing the app in their own browser to change their own score, because there is no server code to recompute it. Tamper-proof scoring needs Cloud Functions on the paid Blaze plan.
- Accounts use email and password. Phone-number sign-in and real SMS are not part of online mode yet (texts stay simulated).
- The AI review runs on the member's device, so its decision is trusted by the app; anything the AI is unsure about goes to the admin.
- Reminder emails are sent from the member's open page, so the tab must be open when the timer gets close.

## Demo mode (no setup)

If `firebase-config.js` still contains the `REPLACE_…` placeholders, the app and the admin console use the built-in demo backend:

1. Serve the folder (`python -m http.server 8000`) or open the GitHub Pages site.
2. Create an account in the app. Accounts whose email is on the administrator list (`access-config.js`, hashed) get unlimited tasks and can sign in to `/admin/` with the same email and password. Use the same browser for both pages.

Everything is stored in that browser's `localStorage`, so nothing syncs between devices. It is a convenience check, not security.

## Real email (EmailJS), both modes

Verified members get real reminder emails. `messaging-config.js` holds the public EmailJS ids (service, template, public key). To use your own account:

1. Create an EmailJS account, connect an email service and create a template with **To email** = `{{to_email}}`, and the variables `{{name}}`, `{{time}}`, `{{message}}` (optionally `{{subject}}` as the template subject).
2. Put your Service ID, Template ID and Public Key in `messaging-config.js`. These are public identifiers; never add a private key.
3. In EmailJS → Security add your site's origin (for example `https://suhas-867.github.io`) as the allowed domain if your plan allows it. The free plan allows 200 requests a month and shows a footer.

On `localhost` delivery is skipped (EmailJS rejects that origin) and the verification code is displayed instead. Limits: 5 verification codes an hour, a 60-second resend cooldown, 5 wrong attempts per code and 20 reminder emails a day per member.

## Real text messages (Twilio + Cloudflare Worker), optional

Twilio's secrets cannot live in a web page, so `worker/sms-relay.js` is a tiny Cloudflare Worker that holds them. Follow [`worker/README.md`](worker/README.md), then put the Worker URL in `smsConfig.relayUrl` in `messaging-config.js`. Until that URL is set, text messages are simulated and shown in the admin *Reminder outbox*. SMS to Indian numbers also needs sender registration (DLT) for production.

## Behaviour notes

- Membership is a ₹99 / 30-day simulation. No payment is collected. The expiry date is fixed when activated; pressing *Extend membership* again does not move it. It resets with the page session.
- Points, demo rewards and membership are per page session and reset on refresh. Trial usage and tasks belong to the account.
- A task earns +100 only after AI or admin approval. An expired task loses 500 once.
