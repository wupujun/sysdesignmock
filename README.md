# SysDesignMock

Local-first system design practice app built on top of the official Excalidraw editor.

It lets you:
- create, open, update, and delete whiteboards
- autosave boards to a local server
- record narrated design walkthroughs
- replay saved interview recordings with synced screenshots
- manage saved replays from the editor

## Features

- Embedded Excalidraw editor using `@excalidraw/excalidraw`
- Board CRUD from a custom home page
- Manual save plus autosave every 30 seconds when the board is dirty
- Dirty-state tracking that ignores unstable Excalidraw metadata
- PNG preview generation for saved boards
- Microphone recording during board editing
- Screenshot capture during recording
- Replay page for audio + synced screenshots
- Delete saved replays
- Local filesystem persistence with no cloud dependency

## Tech Stack

- React
- Vite
- Express
- TypeScript
- Excalidraw

## Development

Install dependencies:

```powershell
npm.cmd install
```

Start both frontend and backend in development mode:

```powershell
npm.cmd run dev
```

Frontend:
- `http://localhost:5173`

Backend API:
- `http://localhost:3001`

Notes:
- In development, the web UI is only served by Vite on `5173`.
- The Express server on `3001` is API/static-assets only and does not serve the app shell.

## Docker

Run the app locally in Docker:

```powershell
docker compose up --build
```

Open:
- `http://localhost:3000`

Notes:
- In Docker, the client is served by the Node server from the production build on `3000`.
- Board data, previews, and recordings are persisted in the named Docker volume `sysdesignmock-data`.

Stop the containers:

```powershell
docker compose down
```

Remove the persisted data volume too:

```powershell
docker compose down -v
```

## Production Build

Build the client and server:

```powershell
npm.cmd run build
```

Start the production server:

```powershell
npm.cmd start
```

Open:
- `http://localhost:3000`

## Testing

Run the automated tests:

```powershell
npm.cmd test
```

Current automated coverage includes:
- board CRUD API lifecycle
- recording create/get/delete API path
- autosave countdown logic
- dirty-state detection logic

## How It Works

### Boards

- A board is stored as Excalidraw scene JSON plus metadata.
- Opening a board loads the saved scene into the embedded Excalidraw editor.
- Saving writes scene data and preview images to local disk.

### Autosave

- Autosave runs every 30 seconds only when the board has unsaved changes.
- No autosave runs when there is no real scene or title change.

### Recording and Replay

- While editing a board, the user can start microphone recording.
- The app captures board screenshots during the walkthrough.
- On stop, the app saves:
  - audio
  - replay metadata
  - screenshot frames
- Replays can be opened from the editor and played back later.

Important:
- Replay is implemented as audio + synced screenshots inside the app.
- It is not currently exported as a standalone video file like `.mp4`.

## Local Storage Layout

App data is written under:

```text
data/
  boards/
  meta/
  previews/
  recordings/
```

In Docker, this maps to:

```text
/app/data
```

Typical recording layout:

```text
data/
  recordings/
    <board-id>/
      <recording-id>.json
      <recording-id>.webm
      <recording-id>-frame-0.png
      <recording-id>-frame-1.png
```

## API Overview

Board endpoints:
- `GET /api/boards`
- `POST /api/boards`
- `GET /api/boards/:id`
- `PUT /api/boards/:id`
- `DELETE /api/boards/:id`

Recording endpoints:
- `GET /api/boards/:id/recordings`
- `POST /api/boards/:id/recordings`
- `GET /api/boards/:id/recordings/:recordingId`
- `DELETE /api/boards/:id/recordings/:recordingId`

## Notes

- The editor UX comes from Excalidraw, but the surrounding app shell is custom.
- The production client bundle is large because Excalidraw ships a substantial editor runtime.
- Recording playback support depends on browser audio format support.
