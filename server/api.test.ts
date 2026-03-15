import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "./index.js";

test("board CRUD API lifecycle", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "whiteboard-api-"));
  process.env.WHITEBOARD_DATA_DIR = tempDir;

  const app = createApp();
  const server = app.listen(0);
  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    server.close();
    delete process.env.WHITEBOARD_DATA_DIR;
    await rm(tempDir, { recursive: true, force: true });
  });

  const createResponse = await fetch(`${baseUrl}/api/boards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "API Test Board" })
  });
  assert.equal(createResponse.status, 201);
  const createdBoard = await createResponse.json() as { id: string; title: string };
  assert.equal(createdBoard.title, "API Test Board");
  assert.match(createdBoard.id, /^b_/);

  const listResponse = await fetch(`${baseUrl}/api/boards`);
  assert.equal(listResponse.status, 200);
  const boards = await listResponse.json() as Array<{ id: string; title: string }>;
  assert.equal(boards.length, 1);
  assert.equal(boards[0]?.id, createdBoard.id);

  const getResponse = await fetch(`${baseUrl}/api/boards/${createdBoard.id}`);
  assert.equal(getResponse.status, 200);
  const boardRecord = await getResponse.json() as {
    meta: { id: string; title: string; previewPath: string | null };
    scene: { type: string; elements: unknown[] };
  };
  assert.equal(boardRecord.meta.title, "API Test Board");
  assert.equal(boardRecord.scene.type, "excalidraw");
  assert.deepEqual(boardRecord.scene.elements, []);

  const updateResponse = await fetch(`${baseUrl}/api/boards/${createdBoard.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Renamed Board",
      scene: {
        type: "excalidraw",
        version: 2,
        source: "test-suite",
        elements: [
          {
            id: "shape-1",
            type: "rectangle",
            x: 10,
            y: 20,
            width: 30,
            height: 40,
            updated: 123,
            versionNonce: 999
          }
        ],
        appState: {
          theme: "light",
          zoom: { value: 1 },
          openMenu: "should-be-filtered"
        },
        files: {}
      }
    })
  });
  assert.equal(updateResponse.status, 200);
  const updatedBoard = await updateResponse.json() as {
    meta: { title: string };
    scene: { appState: Record<string, unknown>; elements: Array<Record<string, unknown>> };
  };
  assert.equal(updatedBoard.meta.title, "Renamed Board");
  assert.equal(updatedBoard.scene.appState.theme, "light");
  assert.equal(updatedBoard.scene.appState.openMenu, undefined);
  assert.equal(updatedBoard.scene.elements[0]?.updated, 123);

  const recordingResponse = await fetch(`${baseUrl}/api/boards/${createdBoard.id}/recordings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Mock Interview Replay",
      durationMs: 32000,
      audioMimeType: "audio/webm",
      audioBase64: "data:audio/webm;base64,ZmFrZQ==",
      frames: [
        {
          timestampMs: 0,
          imageBase64: "data:image/png;base64,ZmFrZQ=="
        }
      ]
    })
  });
  assert.equal(recordingResponse.status, 201);
  const createdRecording = await recordingResponse.json() as {
    id: string;
    title: string;
    audioPath: string;
    audioMimeType: string;
    frames: Array<{ timestampMs: number; imagePath: string }>;
  };
  assert.equal(createdRecording.title, "Mock Interview Replay");
  assert.match(createdRecording.id, /^r_/);
  assert.equal(createdRecording.audioMimeType, "audio/webm");
  assert.match(createdRecording.audioPath, /\.webm$/);
  assert.equal(createdRecording.frames.length, 1);

  const listRecordingsResponse = await fetch(`${baseUrl}/api/boards/${createdBoard.id}/recordings`);
  assert.equal(listRecordingsResponse.status, 200);
  const recordings = await listRecordingsResponse.json() as Array<{ id: string }>;
  assert.equal(recordings.length, 1);
  assert.equal(recordings[0]?.id, createdRecording.id);

  const getRecordingResponse = await fetch(`${baseUrl}/api/boards/${createdBoard.id}/recordings/${createdRecording.id}`);
  assert.equal(getRecordingResponse.status, 200);
  const fetchedRecording = await getRecordingResponse.json() as {
    id: string;
    audioPath: string;
    audioMimeType: string;
    frames: Array<{ imagePath: string }>;
  };
  assert.equal(fetchedRecording.id, createdRecording.id);
  assert.equal(fetchedRecording.audioMimeType, "audio/webm");
  assert.match(fetchedRecording.audioPath, /\/recordings\//);
  assert.match(fetchedRecording.frames[0]?.imagePath ?? "", /\/recordings\//);

  const deleteRecordingResponse = await fetch(`${baseUrl}/api/boards/${createdBoard.id}/recordings/${createdRecording.id}`, {
    method: "DELETE"
  });
  assert.equal(deleteRecordingResponse.status, 204);

  const missingRecordingResponse = await fetch(`${baseUrl}/api/boards/${createdBoard.id}/recordings/${createdRecording.id}`);
  assert.equal(missingRecordingResponse.status, 404);

  const deleteResponse = await fetch(`${baseUrl}/api/boards/${createdBoard.id}`, {
    method: "DELETE"
  });
  assert.equal(deleteResponse.status, 204);

  const missingResponse = await fetch(`${baseUrl}/api/boards/${createdBoard.id}`);
  assert.equal(missingResponse.status, 404);
});

test("board evaluation API validates inputs and returns normalized rubric output", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "whiteboard-eval-api-"));
  process.env.WHITEBOARD_DATA_DIR = tempDir;

  const originalFetch = globalThis.fetch;
  let capturedAuthorization = "";
  let capturedModel = "";

  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    assert.equal(String(input), "https://api.openai.com/v1/responses");
    capturedAuthorization = String(init?.headers && (init.headers as Record<string, string>).Authorization);
    const body = JSON.parse(String(init?.body)) as { model: string };
    capturedModel = body.model;

    return new Response(
      JSON.stringify({
        model: "gpt-5-mini-2025-08-07",
        output_text: JSON.stringify({
          summary: "The design has a solid backbone but leaves scaling details thin.",
          totalScore: 21,
          maxScore: 30,
          rubric: [
            {
              criterionId: "requirements",
              title: "Requirements Clarity",
              score: 4,
              maxScore: 5,
              justification: "The board shows the main use case and user flow."
            }
          ],
          strengths: ["Clear top-level service boundaries."],
          gaps: ["No explicit capacity plan."],
          recommendations: ["Add datastore partitioning and failure handling."]
        })
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );
  }) as typeof fetch;

  const app = createApp();
  const server = app.listen(0);
  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    server.close();
    globalThis.fetch = originalFetch;
    delete process.env.WHITEBOARD_DATA_DIR;
    await rm(tempDir, { recursive: true, force: true });
  });

  const createResponse = await originalFetch(`${baseUrl}/api/boards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Evaluation Board" })
  });
  assert.equal(createResponse.status, 201);
  const createdBoard = await createResponse.json() as { id: string };

  const missingKeyResponse = await originalFetch(`${baseUrl}/api/boards/${createdBoard.id}/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey: "", model: "gpt-5-mini" })
  });
  assert.equal(missingKeyResponse.status, 400);

  const evaluationResponse = await originalFetch(`${baseUrl}/api/boards/${createdBoard.id}/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey: "test-key", model: "gpt-5-mini" })
  });
  assert.equal(evaluationResponse.status, 200);

  const evaluation = await evaluationResponse.json() as {
    model: string;
    summary: string;
    totalScore: number;
    maxScore: number;
    rubric: Array<{ criterionId: string; title: string; score: number; maxScore: number }>;
    strengths: string[];
    gaps: string[];
    recommendations: string[];
  };

  assert.equal(capturedAuthorization, "Bearer test-key");
  assert.equal(capturedModel, "gpt-5-mini");
  assert.equal(evaluation.model, "gpt-5-mini-2025-08-07");
  assert.equal(evaluation.totalScore, 4);
  assert.equal(evaluation.maxScore, 30);
  assert.equal(evaluation.rubric.length, 6);
  assert.equal(evaluation.rubric[0]?.criterionId, "requirements");
  assert.deepEqual(evaluation.strengths, ["Clear top-level service boundaries."]);
  assert.deepEqual(evaluation.gaps, ["No explicit capacity plan."]);
  assert.deepEqual(evaluation.recommendations, ["Add datastore partitioning and failure handling."]);
});
