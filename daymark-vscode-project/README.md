# Daymark — VS Code learning project

A timed-task app with a membership and rewards idea, accounts, AI/manual proof review and a live admin website. This copy is meant to be opened in VS Code and explored.

**Live:** <https://suhas-867.github.io/daymark-todo/daymark-vscode-project/app/> · **Admin:** <https://suhas-867.github.io/daymark-todo/daymark-vscode-project/app/admin/>

## The rules

- First 10 timed tasks are free. After that the task input locks until the ₹99 / 1-month demo membership is activated. Pressing *Extend membership* again never moves the active-until date; refreshing resets it.
- Finish on time and get the proof approved: **+100 points** and a celebration with party poppers.
- Timer runs out: **−500 points** (once) and a timeout message. Only running tasks pulse.
- Every 1,000 points: ₹30 demo reward. Points, rewards and membership reset when the page is refreshed.
- Timers: 1, 5, 15, 30 minutes, 1 hour, or custom 1 minute – 24 hours.
- Sign in with an **email or phone number** plus password. Deadline reminders by email/SMS are opt-in at sign-up and can be enabled later in **Account & reminders**.
- Reminder **emails are real** (EmailJS) once the address is verified with a 6-digit code; SMS is still simulated.
- Proof photos go to **AI review** (instant, on-device demo check) or **manual review** on the separate admin site.

Everything is a prototype: no payments, no payouts. Verified emails are really sent; text messages are simulated.

## Open in VS Code

1. **File → Open Folder** and choose this `daymark-vscode-project` folder (or its `app` subfolder).
2. **Terminal → New Terminal**, then start a server:

   ```powershell
   python -m http.server 8001
   ```

3. Open <http://localhost:8001> for the app and <http://localhost:8001/admin/> for the admin console in two tabs of the same browser. Admin demo login: `admin@daymark.demo` / `Admin@12345`.
4. Run the tests with `npm test`.

## Try it (judge walk-through)

1. Create an account, tick the reminder boxes, and land in the dashboard.
2. Add a 1-minute task. Watch the *time is running out* pop-up and the simulated reminder, then let it expire (−500).
3. Add another task, press **Submit proof**, upload a clear photo with *AI review* → +100 and the celebration.
4. Add a third task, submit with *Manual review*, switch to the admin tab, press **Approve** → the points arrive live on the user tab.
5. Upload a blank image to see the AI send it back, then use the same photo twice to see duplicate detection.
6. Hit the 10th task to see the trial lock, then activate membership.

## Learning path

| Read | To learn |
| --- | --- |
| `rewards.js`, `tasks.js` | Pure scoring and task rules, tested in `tests/` |
| `email-service.js`, `messaging-config.js` | Sending email through EmailJS and the safety limits |
| `ai-review.js` | Image statistics and the approve / needs-human / reject decision |
| `local-db.js` | A tiny database with live updates across browser tabs |
| `demo-backend.js`, `cloud-backend.js` | The same adapter interface over localStorage or Firebase |
| `user-app.js` | One dashboard controller that works with either backend |
| `admin/admin-demo.js` | The live review console |
| `functions/index.js` | The production backend: AI vision, points, scheduled reminders |

See `SETUP.md` to connect real Firebase accounts, cloud sync, email and SMS.
