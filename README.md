# Daymark — timed tasks, proof review and rewards

Daymark is a presentation-ready prototype of a **membership-based productivity rewards app**. Set a task, start a timer, upload a photo as proof, and earn points once the proof is approved.

**Live demo:** <https://suhas-867.github.io/daymark-todo/> · **Admin console:** <https://suhas-867.github.io/daymark-todo/admin/>

## The idea

| Rule | Value |
| --- | --- |
| Free trial | First 10 timed tasks are free |
| Membership | ₹99 for 1 month (simulated, no payment is taken) |
| Finish on time and get the proof approved | **+100 points** |
| Timer runs out | **−500 points**, applied once |
| Reward | **₹30 demo reward** for every 1,000 points |
| Timer length | 1, 5, 15, 30 minutes, 1 hour, or custom from 1 minute to 24 hours |

Points, demo rewards and the demo membership reset to zero when the page is refreshed. The 10-task trial count and the tasks themselves stay on the account.

## What works today

- **Accounts** — create an account or sign in with an **email address or a phone number** plus a password. After sign-up the app opens straight away.
- **Reminder consent** — at sign-up the member opts in separately to email and SMS reminders. If they decline, **Account & reminders** (and the *Deadline alerts* card) lets them enable it later.
- **Timed tasks** — countdown per task, flicker only while a timer is running, celebration with party poppers on success, “OOPS!” message on a missed timer, task input locks after the 10th free task.
- **Proof upload** — JPG/PNG/WebP up to 8 MB with a preview.
- **AI review** — an instant on-device check approves clear photos, rejects blank/blurry/duplicate ones, and sends uncertain ones to a human.
- **Manual review** — the proof goes to the **separate admin website**; points are awarded the moment the admin approves.
- **Live admin console** (`/admin/`) — review queue with images, history, members list with consent flags, and a reminder outbox. It updates live with the user app.
- **Deadline warnings** — pop-up in the app, an optional browser notification, plus email and SMS reminders for members who opted in.

## Two ways to run it

### 1. Demo mode (works out of the box)

This is what GitHub Pages serves. No setup. Accounts, tasks, proof images and the review queue are stored in the browser's `localStorage`, shared live between the user app and the admin site through the same origin. Open both in two tabs of the same browser to see a proof appear on the admin page and the points arrive on the user page.

- Demo admin: `admin@daymark.demo` / `Admin@12345` (shown on the admin sign-in page).
- Email and SMS reminders are **simulated**: they are written to the *Reminder outbox* in the admin console instead of being delivered.
- The AI check is an on-device heuristic (sharpness, contrast, exposure, resolution, duplicate detection). It is honest about being a demo and cannot tell *what* is in a photo.
- Data stays on that one device. Use **Reset demo data** in the admin console to start fresh.

### 2. Live mode (real accounts, cloud sync, real messages)

Fill in `firebase-config.js` and deploy the backend in `functions/`. The same screens then use Firebase Authentication, Firestore, Storage and Cloud Functions (OpenAI vision for the AI review, SMTP for email, Twilio for SMS). See [SETUP.md](SETUP.md). No keys are stored in this repository.

## Run locally

```powershell
python -m http.server 8000
```

Open <http://localhost:8000> (user app) and <http://localhost:8000/admin/> (admin console). Browser modules need HTTP, so opening `index.html` as a file will not work.

```powershell
npm test
```

## Project structure

```text
index.html, styles.css       User app (sign-in, dashboard, proof and settings dialogs)
auth.js                      Entry point: sign-in/sign-up UI, picks demo or Firebase backend
user-app.js                  Dashboard controller shared by both backends (timers, toasts, celebration)
local-db.js                  Demo backend: accounts, tasks, proofs, points, reminders in localStorage
demo-backend.js              Wires the demo database to the dashboard
ai-review.js                 On-device AI proof check
cloud-backend.js             Firebase backend adapter (Auth, Firestore, Storage, Functions)
firebase-config.js           Public Firebase web config (placeholders)
admin/                       Admin website: admin-demo.js (live demo) and admin-cloud.js (Firebase)
functions/                   Cloud Functions: AI review, points, reminders, admin role
firestore.rules, storage.rules, firebase.json   Firebase security rules and deployment
rewards.js, tasks.js         Scoring and task helpers used by the app and the tests
tests/                       Automated tests (npm test)
```

## Limits to be upfront about

- Payments and cash payouts do not exist; ₹99 and ₹30 are demonstration values.
- Demo mode is not secure storage: passwords are hashed in the browser and everything lives on that device. Live mode needs the Firebase setup.
- AI review is an assistive check, not proof of completion. Uncertain cases go to a human admin.

## Ideas for next steps

Streaks and weekly leaderboards, task templates, a proof appeal flow, push notifications, real payments through a payment provider, and a vision-model review in demo mode through a small server.
