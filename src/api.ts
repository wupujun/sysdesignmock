export type SceneData = {
  type: "excalidraw";
  version: number;
  source: string;
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
};

export type BoardMeta = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  previewPath: string | null;
};

export type BoardRecord = {
  meta: BoardMeta;
  scene: SceneData;
};

export type EvaluationCriterion = {
  criterionId: string;
  title: string;
  score: number;
  maxScore: number;
  justification: string;
};

export type BoardEvaluationResult = {
  model: string;
  summary: string;
  totalScore: number;
  maxScore: number;
  rubric: EvaluationCriterion[];
  strengths: string[];
  gaps: string[];
  recommendations: string[];
};

export type RecordingFrame = {
  timestampMs: number;
  imagePath: string;
};

export type RecordingMeta = {
  id: string;
  boardId: string;
  title: string;
  createdAt: string;
  durationMs: number;
  audioPath: string;
  audioMimeType: string;
  frames: RecordingFrame[];
};

export type LlmValidationResult = {
  ok: true;
  model: string;
  providerId: string;
  endpoint: string;
};

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchBoards() {
  return parseJson<BoardMeta[]>(await fetch("/api/boards"));
}

export async function createBoard(title = "Untitled board") {
  return parseJson<BoardMeta>(
    await fetch("/api/boards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title })
    })
  );
}

export async function fetchBoard(id: string) {
  return parseJson<BoardRecord>(await fetch(`/api/boards/${id}`));
}

export async function saveBoard(id: string, payload: { title: string; scene: SceneData; preview?: string | null }) {
  return parseJson<BoardRecord>(
    await fetch(`/api/boards/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
  );
}

export async function removeBoard(id: string) {
  const response = await fetch(`/api/boards/${id}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(`Delete failed with ${response.status}`);
  }
}

export async function fetchRecordings(boardId: string) {
  return parseJson<RecordingMeta[]>(await fetch(`/api/boards/${boardId}/recordings`));
}

export async function fetchRecording(boardId: string, recordingId: string) {
  return parseJson<RecordingMeta>(await fetch(`/api/boards/${boardId}/recordings/${recordingId}`));
}

export async function createRecording(
  boardId: string,
  payload: {
    title: string;
    durationMs: number;
    audioMimeType: string;
    audioBase64: string;
    frames: Array<{ timestampMs: number; imageBase64: string }>;
  }
) {
  return parseJson<RecordingMeta>(
    await fetch(`/api/boards/${boardId}/recordings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
  );
}

export async function removeRecording(boardId: string, recordingId: string) {
  const response = await fetch(`/api/boards/${boardId}/recordings/${recordingId}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(`Delete failed with ${response.status}`);
  }
}

export async function evaluateBoard(
  boardId: string,
  payload: {
    providerId: string;
    endpoint: string;
    apiKey: string;
    model: string;
  }
) {
  return parseJson<BoardEvaluationResult>(
    await fetch(`/api/boards/${boardId}/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
  );
}

export async function validateLlmConfig(payload: {
  providerId: string;
  endpoint: string;
  apiKey: string;
  model: string;
}) {
  return parseJson<LlmValidationResult>(
    await fetch("/api/llm/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
  );
}

export async function generateImprovedBoard(
  boardId: string,
  payload: {
    providerId: string;
    endpoint: string;
    apiKey: string;
    model: string;
    evaluation: BoardEvaluationResult;
  }
) {
  return parseJson<BoardMeta>(
    await fetch(`/api/boards/${boardId}/generate-improved`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
  );
}
