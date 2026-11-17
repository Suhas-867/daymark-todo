# Daymark To-Do App

A complete browser-based task manager project for exploring and developing in Visual Studio Code. This is an independent local project folder; it does not alter or publish the original Daymark website.

## Features

- Add tasks, mark them complete or reopen them, and delete individual tasks.
- Filter the list to show all, open, or completed tasks.
- Clear all completed tasks with one button.
- Save tasks in this browser using local storage.
- Show task counts and a completion progress indicator.
- Responsive layout for desktop and mobile screens.
- Automated unit tests and a GitHub Actions workflow for pushes and pull requests.

## Open in VS Code

1. Open VS Code and choose **File → Open Folder**.
2. Select the `daymark-vscode-project` folder.
3. Use **Terminal → New Terminal** and start the local server:

   ```powershell
   python -m http.server 8001
   ```

4. Open `http://localhost:8001` in your browser. Keep the terminal open while using the app; press **Ctrl+C** in it to stop the server.

Port `8001` lets this copy run alongside the original app on port `8000`.

## Project files

- `index.html` builds the page structure and controls.
- `styles.css` defines the visual design and responsive layout.
- `app.js` connects browser events to the interface and saves changes.
- `tasks.js` contains task operations, filtering, progress calculations, and storage loading.
- `tests/tasks.test.js` checks task operations and malformed saved data.
- `.github/workflows/ci.yml` runs the automated tests on pushes and pull requests.

## Run the tests

Install Node.js 22 or newer, then open the VS Code terminal in this folder and run:

```powershell
npm test
```

No third-party packages are needed.

## Suggested learning path

1. Trace the Add task form from `index.html` to the submit handler in `app.js`, then to `addTask` in `tasks.js`.
2. Follow a checkbox change through `toggleTask` and the render function.
3. Change a color in `styles.css`, save, and refresh the browser.
4. Make a small behavior change, update or add a test, and run `npm test`.
5. Inspect your changes in VS Code's **Source Control** panel before committing them.

Tasks are saved only in the current browser on this computer. They do not sync with the original app or another device.
