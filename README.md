# Daymark — To-Do List Web Application

Daymark is a responsive task manager built for a CDD minor project. It lets you add tasks, view and filter them, mark them complete, delete them, and keep them saved in the browser with local storage.

## Features

- Add tasks with a title of up to 120 characters.
- View all, in-progress, and completed tasks. The sidebar filters and list filters stay in sync, with live counts for each category.
- Mark tasks complete or reopen them.
- Delete one task or clear all completed tasks.
- See task counts and a live completion progress indicator.
- Keep tasks after closing and reopening the browser using `localStorage`.
- Use the responsive layout on desktop and mobile.
- Create the first 10 timed tasks free; after that, activate the one-month membership to continue.
- Explore the Focus Club demo: ₹99 for 30 days, timed tasks, and a points balance.
- Earn 100 points for an on-time task, lose 500 for a missed timer, and see a ₹30 demo reward at each 1,000-point milestone.
- Choose a custom timer from 1 minute to 24 hours; the points balance resets to 0 on refresh.
- Review the planned AI proof-upload feature in the in-app roadmap; proof review is not implemented.
- Run automated unit tests locally and through GitHub Actions on pushes and pull requests.

> **Presentation demo only:** membership activation and rupee rewards are simulated in this browser. No payments or payouts occur.

## Run locally

You need Node.js 22 or newer. No third-party packages are required.

```bash
npm test
```

If you do not have a static server command configured, you can use Python:

```bash
python -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000). Tasks are stored only in that browser on that device; there is no account or server synchronization.

## Git and GitHub

The project can be versioned with Git and pushed to a GitHub repository. The included workflow at `.github/workflows/ci.yml` runs `npm test` for each push and pull request. To connect your own repository:

```bash
git init
git add .
git commit -m "Build Daymark to-do app"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
git push -u origin main
```

Replace the example remote with your repository URL. Once pushed, GitHub Actions runs the test workflow automatically.

## Demonstration outline

1. Add up to 10 timed tasks without activating membership; the free-trial counter persists if tasks are deleted.
2. Show the membership prompt after the trial is used, then activate the one-month demo membership; no payment is charged.
3. Finish a task on time to show +100 points; let another task expire to show the −500 penalty.
4. Demonstrate the filters, completed-task controls, and local persistence.
5. Explain the ₹30 demo reward for each 1,000-point milestone.
6. Show the **Future Plan** card for proposed AI proof upload and review; it is not implemented.
7. Show the test workflow in GitHub Actions. This demo does not process payments or payouts.

## Project structure

```text
index.html                 App layout
styles.css                 Responsive visual design
app.js                     Browser interface and event handling
tasks.js                   Task operations and storage loading
tests/tasks.test.js        Automated unit tests
.github/workflows/ci.yml   GitHub Actions CI workflow
rewards.js                 Demo membership, points, and milestone calculations
```

## Membership and rewards demo

Create the first 10 timed tasks free, with a 1, 5, 15, or 30 minute timer, one hour, or a custom duration up to 24 hours. This lifetime trial counter remains after deleting tasks. After the trial, activate the ₹99 one-month demo membership to continue. Complete a task before its timer expires to earn 100 points. When a timer expires, the app deducts 500 points once. The current points balance resets to 0 on refresh, while membership and demo reward history remain saved. Every 1,000-point balance milestone adds ₹30 to the demo reward total. Demo points and membership state stay in this browser; they are not cash, a payment, or a payout.

The **Future Plan** card describes optional proof uploads and AI-assisted review. It is shown as a roadmap idea only; this build does not upload files or check proof with AI.

### Judge presentation flow

1. Add a one-minute task and show the free-trial counter decrease from 10.
2. Show the membership prompt after the 10th task, then activate the ₹99 one-month demo plan and point out the no-payment notice.
3. Complete one task in time to demonstrate the +100 celebration; let another expire to show the −500 penalty and failure message.
4. Explain that every 1,000-point milestone displays a ₹30 demo reward, with no actual payout.
5. Point to the AI proof review card as planned future work, not a current feature.

