# Daymark To-Do App

A browser-based task manager for learning and experimenting in Visual Studio Code. This copy lives in its own folder in the public repository and saves tasks in this browser's local storage.

## Features

- Add, complete, reopen, and delete tasks.
- Filter tasks and clear completed items.
- View task counts and completion progress.
- Responsive desktop and mobile layout.
- Automated tests run locally and through GitHub Actions.

## Open in VS Code

1. Choose **File → Open Folder** and select the repository's daymark-vscode-project/app folder.
2. Open a terminal in that folder and run: python -m http.server 8001
3. Visit http://localhost:8001 and leave the terminal open while using the app. Press **Ctrl+C** to stop the server.

Port 8001 lets this copy run alongside the original app on port 8000.

## Project files

- index.html — page structure and controls.
- styles.css — visual design and responsive layout.
- app.js — connects browser events to the interface.
- tasks.js — task operations, filtering, progress, and storage.
- tests/tasks.test.js — unit tests for task behavior and saved data.
- ../../.github/workflows/daymark-vscode-learning.yml — test workflow for pushes and pull requests.

## Run the tests

Install Node.js 22 or newer, open the terminal in the app folder, and run: npm test

No third-party packages are required.

## Suggested learning path

1. Follow the Add task form from index.html through app.js to addTask in tasks.js.
2. Trace a checkbox change through toggleTask and the render function.
3. Change a color in styles.css, save, and refresh.
4. Make a small behavior change, add or update a test, and run npm test.
5. Review your changes in VS Code's **Source Control** panel before committing.

Tasks stay in this browser on this computer. They do not sync to the original app or another device.
