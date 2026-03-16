import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createBoard,
  createRecording,
  deleteBoard,
  deleteRecording,
  getBoard,
  getRecording,
  listBoards,
  listRecordings,
  saveBoard,
  type SceneData
} from "./storage.js";
import { evaluateBoardWithOpenAI, validateLlmConfig } from "./evaluation.js";

const currentFile = fileURLToPath(import.meta.url);

export function createApp() {
  const app = express();
  const clientDist = path.join(process.cwd(), "dist", "client");
  const isProduction = process.env.NODE_ENV === "production";
  const previewsDir = process.env.WHITEBOARD_DATA_DIR
    ? path.join(path.resolve(process.env.WHITEBOARD_DATA_DIR), "previews")
    : path.join(process.cwd(), "data", "previews");
  const recordingsDir = process.env.WHITEBOARD_DATA_DIR
    ? path.join(path.resolve(process.env.WHITEBOARD_DATA_DIR), "recordings")
    : path.join(process.cwd(), "data", "recordings");

  app.use(cors());
  app.use(express.json({ limit: "25mb" }));
  app.use("/previews", express.static(previewsDir));
  app.use(
    "/recordings",
    express.static(recordingsDir, {
      setHeaders(res, filePath) {
        if (filePath.endsWith(".webm")) {
          res.type("audio/webm");
          return;
        }
        if (filePath.endsWith(".ogg")) {
          res.type("audio/ogg");
          return;
        }
        if (filePath.endsWith(".mp4")) {
          res.type("audio/mp4");
        }
      }
    })
  );

  app.get("/api/boards", async (_req, res) => {
    const boards = await listBoards();
    res.json(boards);
  });

  app.post("/api/boards", async (req, res) => {
    const title = typeof req.body?.title === "string" && req.body.title.trim() ? req.body.title.trim() : "Untitled board";
    const board = await createBoard(title);
    res.status(201).json(board.meta);
  });

  app.get("/api/boards/:id", async (req, res) => {
    const board = await getBoard(req.params.id);
    if (!board) {
      res.status(404).json({ error: "Board not found" });
      return;
    }
    res.json(board);
  });

  app.put("/api/boards/:id", async (req, res) => {
    const title = typeof req.body?.title === "string" && req.body.title.trim() ? req.body.title.trim() : "Untitled board";
    const scene = req.body?.scene as SceneData | undefined;
    const preview = typeof req.body?.preview === "string" ? req.body.preview : null;

    if (!scene || scene.type !== "excalidraw") {
      res.status(400).json({ error: "Invalid scene payload" });
      return;
    }

    const board = await saveBoard(req.params.id, title, scene, preview);
    if (!board) {
      res.status(404).json({ error: "Board not found" });
      return;
    }

    res.json(board);
  });

  app.delete("/api/boards/:id", async (req, res) => {
    const deleted = await deleteBoard(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: "Board not found" });
      return;
    }
    res.status(204).send();
  });

  app.post("/api/boards/:id/evaluate", async (req, res) => {
    const providerId = typeof req.body?.providerId === "string" && req.body.providerId.trim()
      ? req.body.providerId.trim()
      : "openai";
    const endpoint = typeof req.body?.endpoint === "string" && req.body.endpoint.trim()
      ? req.body.endpoint.trim()
      : "https://api.openai.com/v1";
    const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
    const model = typeof req.body?.model === "string" && req.body.model.trim() ? req.body.model.trim() : "gpt-5-mini";

    if (!endpoint) {
      res.status(400).json({ error: "Endpoint is required" });
      return;
    }

    if (!apiKey) {
      res.status(400).json({ error: "API key is required" });
      return;
    }

    try {
      const evaluation = await evaluateBoardWithOpenAI(req.params.id, {
        providerId,
        endpoint,
        apiKey,
        model
      });
      if (!evaluation) {
        res.status(404).json({ error: "Board not found" });
        return;
      }
      res.json(evaluation);
    } catch (error) {
      res.status(502).json({
        error: error instanceof Error ? error.message : "Board evaluation failed"
      });
    }
  });

  app.get("/api/boards/:id/recordings", async (req, res) => {
    const recordings = await listRecordings(req.params.id);
    res.json(recordings);
  });

  app.post("/api/boards/:id/recordings", async (req, res) => {
    const title = typeof req.body?.title === "string" && req.body.title.trim() ? req.body.title.trim() : "Interview replay";
    const durationMs = typeof req.body?.durationMs === "number" ? req.body.durationMs : 0;
    const audioMimeType = typeof req.body?.audioMimeType === "string" ? req.body.audioMimeType : "";
    const audioBase64 = typeof req.body?.audioBase64 === "string" ? req.body.audioBase64 : "";
    const frames = Array.isArray(req.body?.frames) ? req.body.frames : [];

    if (!audioBase64 || frames.length === 0) {
      res.status(400).json({ error: "Recording requires audio and at least one frame" });
      return;
    }

    const recording = await createRecording(req.params.id, {
      title,
      durationMs,
      audioMimeType,
      audioBase64,
      frames
    });

    if (!recording) {
      res.status(404).json({ error: "Board not found" });
      return;
    }

    res.status(201).json(recording);
  });

  app.get("/api/boards/:id/recordings/:recordingId", async (req, res) => {
    const recording = await getRecording(req.params.id, req.params.recordingId);
    if (!recording) {
      res.status(404).json({ error: "Recording not found" });
      return;
    }
    res.json(recording);
  });

  app.delete("/api/boards/:id/recordings/:recordingId", async (req, res) => {
    const deleted = await deleteRecording(req.params.id, req.params.recordingId);
    if (!deleted) {
      res.status(404).json({ error: "Recording not found" });
      return;
    }
    res.status(204).send();
  });

  app.post("/api/llm/validate", async (req, res) => {
    const providerId = typeof req.body?.providerId === "string" && req.body.providerId.trim()
      ? req.body.providerId.trim()
      : "openai";
    const endpoint = typeof req.body?.endpoint === "string" && req.body.endpoint.trim()
      ? req.body.endpoint.trim()
      : "https://api.openai.com/v1";
    const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
    const model = typeof req.body?.model === "string" && req.body.model.trim() ? req.body.model.trim() : "";

    if (!endpoint) {
      res.status(400).json({ error: "Endpoint is required" });
      return;
    }

    if (!apiKey) {
      res.status(400).json({ error: "API key is required" });
      return;
    }

    if (!model) {
      res.status(400).json({ error: "Model is required" });
      return;
    }

    try {
      const result = await validateLlmConfig({
        providerId,
        endpoint,
        apiKey,
        model
      });
      res.json(result);
    } catch (error) {
      res.status(502).json({
        error: error instanceof Error ? error.message : "LLM validation failed"
      });
    }
  });

  if (isProduction) {
    app.use(express.static(clientDist));

    app.get("*", (_req, res) => {
      res.sendFile(path.join(clientDist, "index.html"));
    });
  }

  return app;
}

if (process.argv[1] === currentFile) {
  const defaultPort = process.env.NODE_ENV === "production" ? 3000 : 3001;
  const port = Number(process.env.PORT ?? defaultPort);
  createApp().listen(port, () => {
    console.log(`Local whiteboard app listening on http://localhost:${port}`);
  });
}
