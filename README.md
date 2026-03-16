# SysDesignMock

System design practice app built on top of Excalidraw, with local board storage, narrated replay, LLM-based evaluation, and draft regeneration.

## What It Does

- Create, edit, save, and delete system design boards
- Autosave board changes to a local server
- Record walkthrough audio with synced screenshot frames
- Replay saved walkthroughs inside the app
- Configure an OpenAI-compatible LLM provider
- Evaluate a saved board against a rubric
- Generate an improved draft board from evaluation feedback

## Core Features

- Embedded Excalidraw editor using `@excalidraw/excalidraw`
- Board CRUD from a custom home page
- Manual save plus autosave while the board is dirty
- PNG preview generation for saved boards
- Replay capture with audio and screenshot frames
- Dedicated replay page with playback controls
- Dedicated LLM settings page with provider presets
- Server-side LLM connection validation
- Dedicated evaluation page per board
- Improved-board draft generation that preserves the original board
- Local filesystem persistence with no required cloud storage

## Supported LLM Providers

The app uses OpenAI-compatible endpoints and includes presets for:

- OpenAI
- Claude
- Gemini
- DeepSeek
- GLM
- Custom OpenAI-compatible endpoint

The LLM settings flow lets you configure:

- provider preset
- endpoint URL
- model
- API key

It also includes a `Test connection` action that validates the configured endpoint, key, and model through the backend.

## Main Routes

- `/` home page with board list and board management
- `/settings/llm` LLM configuration page
- `/boards/:boardId/edit` board editor
- `/boards/:boardId/evaluation` evaluation page for a saved board
- `/boards/:boardId/replays/:recordingId` replay page

## Development

Install dependencies:

```powershell
npm.cmd install
```

Start the local development stack:

```powershell
npm.cmd run dev
```

Development runtime split:

- UI: `http://localhost:5173`
- API: `http://localhost:3001`

Important:

- In development, the web UI is served only by Vite on `5173`.
- The Express server on `3001` is API-only in development.
- If you open `http://localhost:3001` in dev mode, you should not expect the app shell there.

## Docker

Run the production-style app locally in Docker:

```powershell
docker compose up --build
```

Open:

- `http://localhost:3000`

Notes:

- In Docker, the Node server serves both the built client and API on `3000`.
- Board data, previews, and recordings are persisted in the named Docker volume `sysdesignmock-data`.

Stop the containers:

```powershell
docker compose down
```

Remove the persisted volume too:

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

## Evaluation Workflow

1. Open a saved board.
2. Click `Evaluation` from the editor or the board list.
3. Ensure LLM settings are configured in `/settings/llm`.
4. Run the evaluation.
5. Review rubric scores, summary, strengths, gaps, and recommendations.

Evaluation uses the saved board data and preview image as LLM input. The current integration is built around OpenAI-compatible `chat/completions` endpoints.

## Improved Draft Generation

After an evaluation completes, the app can generate an improved draft board.

How it works:

- The server sends the saved board plus evaluation feedback to the configured LLM.
- The LLM returns a constrained improvement spec.
- Server code compiles that spec into Excalidraw scene JSON deterministically.
- A new draft board is created instead of overwriting the original.

This keeps the regeneration path safer than accepting arbitrary raw Excalidraw JSON directly from the model.

## Replay Workflow

- While editing a board, you can record microphone audio.
- The app captures screenshot frames during the walkthrough.
- On stop, the server stores:
  - replay metadata
  - audio
  - screenshot frames
- Replays can then be opened and played back later inside the app.

Important:

- Replay is audio plus synced screenshots inside the app.
- It is not exported as a standalone video file such as `.mp4`.
- Playback depends on browser support for the recorded audio format.

## Testing

Run the automated tests:

```powershell
npm.cmd test
```

Current automated coverage includes:

- board CRUD API lifecycle
- recording create, fetch, and delete API flow
- autosave countdown logic
- dirty-state detection logic
- board evaluation API flow
- LLM connection validation endpoint
- improved-board draft generation endpoint

## API Overview

Board endpoints:

- `GET /api/boards`
- `POST /api/boards`
- `GET /api/boards/:id`
- `PUT /api/boards/:id`
- `DELETE /api/boards/:id`

Replay endpoints:

- `GET /api/boards/:id/recordings`
- `POST /api/boards/:id/recordings`
- `GET /api/boards/:id/recordings/:recordingId`
- `DELETE /api/boards/:id/recordings/:recordingId`

LLM and evaluation endpoints:

- `POST /api/llm/validate`
- `POST /api/boards/:id/evaluate`
- `POST /api/boards/:id/generate-improved`

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

Typical replay storage layout:

```text
data/
  recordings/
    <board-id>/
      <recording-id>.json
      <recording-id>.webm
      <recording-id>-frame-0.png
      <recording-id>-frame-1.png
```

## Tech Stack

- React
- Vite
- Express
- TypeScript
- Excalidraw

## Notes

- The editor itself comes from Excalidraw, while the surrounding workflow is custom.
- The production client bundle is relatively large because the editor runtime is substantial.
- LLM evaluation quality depends on the selected provider, model, and prompt adherence.
