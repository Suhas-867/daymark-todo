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
- Run automated unit tests locally and through GitHub Actions on pushes and pull requests.

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

1. Open the app and point out the task overview and progress card.
2. Add two tasks; show that the newest appears first.
3. Mark one complete and show the progress count update.
4. Use the sidebar's In progress and Completed filters, then try the Open and Done controls above the list. Both sets of filters show the matching tasks and stay in sync.
5. Delete a task and clear completed tasks.
6. Refresh the page to demonstrate local persistence.
7. Show the test output from `npm test` and the Actions run in GitHub after pushing.

## Project structure

```text
index.html                 App layout
styles.css                 Responsive visual design
app.js                     Browser interface and event handling
tasks.js                   Task operations and storage loading
tests/tasks.test.js        Automated unit tests
.github/workflows/ci.yml   GitHub Actions CI workflow
```


## VS Code learning copy

A separate learning-oriented version is available in [daymark-vscode-project/app](./daymark-vscode-project/app/README.md). It includes its own setup guide, tests, and automated checks without replacing this repository's root app.
