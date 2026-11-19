# Daymark SMS relay (Cloudflare Worker + Twilio)

A web page cannot hold your Twilio secrets, so this tiny Worker sits in the middle. The page sends `{to, kind, code|title}`; the Worker checks it, writes the message itself and calls Twilio. The secrets live only in Cloudflare's encrypted settings.

## What it protects against

- Other websites using it (only `ALLOWED_ORIGINS` are answered).
- Texting strangers (only `ALLOWED_NUMBERS` can receive anything).
- Spam or phishing text (the page cannot send free text, only a one-time code or a task reminder).
- Runaway cost (optional hourly limit per number with a KV namespace named `RATE`).

## 1. Twilio (about 10 minutes)

1. Open the [Twilio Console](https://console.twilio.com). Note your **Account SID** and **Auth Token** (keep them private, you will paste them into Cloudflare only).
2. **Phone Numbers → Manage → Buy a number**: a trial account can claim one number for free. This is the *From* number.
3. **Phone Numbers → Manage → Verified Caller IDs**: verify **your own mobile number**. A trial account can text only verified numbers (up to 5).
4. **Messaging → Settings → Geo permissions**: enable the country you are texting (for example India).
5. Trial messages start with "Sent from your Twilio trial account". Messages to Indian numbers may also be filtered by carrier rules (DLT sender registration); if a message fails, the app shows Twilio's error.

## 2. Cloudflare (about 10 minutes)

1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com).
2. **Workers & Pages → Create → Create Worker**. Name it `daymark-sms` and click **Deploy**.
3. Click **Edit code**, delete the sample, paste the whole of [`sms-relay.js`](sms-relay.js) and click **Deploy**.
4. Open the Worker's **Settings → Variables and Secrets** and add:

   | Name | Type | Value |
   | --- | --- | --- |
   | `TWILIO_ACCOUNT_SID` | Secret | your Account SID |
   | `TWILIO_AUTH_TOKEN` | Secret | your Auth Token |
   | `TWILIO_FROM` | Text | your Twilio number, e.g. `+14155550100` |
   | `ALLOWED_ORIGINS` | Text | `https://suhas-867.github.io` |
   | `ALLOWED_NUMBERS` | Text | your verified mobile, e.g. `+919876543210` (comma-separate more) |

   Then click **Deploy** again.
5. Copy the Worker URL (like `https://daymark-sms.your-name.workers.dev`).

## 3. Connect the app

Put the Worker URL in `smsConfig.relayUrl` in `messaging-config.js` and publish. The URL is not a secret; the allow-lists above are what protect it. Do **not** paste the Auth Token anywhere in this repository.

## 4. Test

Sign in to the app, add your verified number in *Account & reminders*, switch on text reminders, press **Verify phone** and enter the code you receive. A 1-minute task will then text you a reminder.

On `localhost` the app never calls the relay (it shows the code on screen instead). Run `npm test` to exercise the relay logic locally; the tests use a fake Twilio.
