# Daymark Focus Club — VS Code Learning Project

A browser-based task manager and presentation prototype for exploring a timed-task membership and rewards idea.

## Demo plan

- First 10 timed tasks are free; after task 10, task entry and timer controls are disabled until membership activation. The trial counter remains after deleting tasks.
- Membership: ₹99 for 30 days.
- Complete a timed task before its deadline: +100 points, with a temporary celebration overlay and party poppers.
- Miss a timer: −500 points, applied once, with a temporary timeout message.
- Points and earned demo rewards reset to 0 on refresh; demo membership resets on refresh, and its active-until date stays fixed when Extend is clicked during the current page session.
- Set a custom timer from 1 minute up to 24 hours.
- Reach each 1,000-point milestone: add a ₹30 demo reward.
- AI-assisted proof upload and review: future plan only; not implemented.

**Presentation demo only:** membership activation and rupee rewards are simulated in this browser. No payment, file upload, AI review, or payout occurs. This front-end stores demo state locally and is not a secure payment or account system.

## Open in VS Code

1. Choose **File → Open Folder** and select the `daymark-vscode-project` folder.
2. Open **Terminal → New Terminal** and start a server:

   ```powershell
   python -m http.server 8001
   ```

3. Visit [http://localhost:8001](http://localhost:8001). Keep the terminal open; press **Ctrl+C** to stop it.

Port `8001` lets this copy run beside the original app on port `8000`.

## Judge presentation flow

1. Add timed tasks and show the free-trial counter decrease from 10.
2. Show the membership prompt after the 10th task; activate the one-month demo membership and point out the no-payment notice.
3. Complete one task on time for +100 points; let another timer expire to demonstrate the −500 result.
4. Explain that the ₹30 reward appears in the demo for each 1,000-point milestone and is not paid out.
5. Show the **Future Plan** card for proposed AI-assisted proof review.

## Project files

- `index.html`, `styles.css` — accessible interface and responsive presentation.
- `app.js` — membership demo, countdowns, scoring, and interface updates.
- `tasks.js`, `rewards.js` — task timing and local demo reward calculations.
- `tests/tasks.test.js` — task behavior tests.
- `.github/workflows/ci.yml` — checks the project on pushes and pull requests.

Tasks and the free-trial counter remain in this browser's local storage. Points, earned demo rewards, and demo membership reset on refresh. No payment or payout service is connected.

