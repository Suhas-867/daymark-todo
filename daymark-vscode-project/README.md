# Daymark To-Do App

A complete browser-based task manager project for exploring and developing in Visual Studio Code. This copy is published inside this repository under daymark-vscode-project/app; it keeps tasks in this browser's local storage and does not change the original app.

## Features

- Add tasks, mark them complete or reopen them, and delete individual tasks.
- Filter the list to show all, active, or completed tasks.
- Clear completed tasks and view progress.
- Use the responsive layout on desktop and mobile.
- Run automated tests locally and through GitHub Actions.

## Open in VS Code

1. Open VS Code and choose **File → Open Folder**.
2. Select the daymark-vscode-project/app folder.
3. Open a terminal in that folder and run: python -m http.server 8001
4. Visit http://localhost:8001. Press **Ctrl+C** in the terminal to stop the server.

Port 8001 lets this copy run alongside the original app on port 8000.

Read the full setup and learning guide in app/README.md. Run tests from the app folder with npm test (Node.js 22 or newer required). No third-party packages are needed.
