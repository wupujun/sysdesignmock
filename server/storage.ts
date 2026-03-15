import { mkdir, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";

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

const APP_STATE_KEYS = new Set([
  "theme",
  "viewBackgroundColor",
  "currentItemBackgroundColor",
  "currentItemEndArrowhead",
  "currentItemFillStyle",
  "currentItemFontFamily",
  "currentItemFontSize",
  "currentItemOpacity",
  "currentItemRoughness",
  "currentItemRoundness",
  "currentItemArrowType",
  "currentItemStartArrowhead",
  "currentItemStrokeColor",
  "currentItemStrokeStyle",
  "currentItemStrokeWidth",
  "currentItemTextAlign",
  "gridSize",
  "gridStep",
  "gridModeEnabled",
  "isBindingEnabled",
  "scrollX",
  "scrollY",
  "zoom",
  "name"
]);

const emptyScene = (): SceneData => ({
  type: "excalidraw",
  version: 2,
  source: "local-whiteboard-app",
  elements: [],
  appState: {},
  files: {}
});

function sanitizeScene(scene: SceneData): SceneData {
  const appStateEntries = Object.entries(scene.appState ?? {}).filter(([key]) => APP_STATE_KEYS.has(key));

  return {
    type: "excalidraw",
    version: 2,
    source: "local-whiteboard-app",
    elements: Array.isArray(scene.elements) ? scene.elements : [],
    appState: Object.fromEntries(appStateEntries),
    files: scene.files && typeof scene.files === "object" ? scene.files : {}
  };
}

async function ensureStorage() {
  const { boardsDir, metaDir, previewsDir, recordingsDir } = getStoragePaths();
  await Promise.all([
    mkdir(boardsDir, { recursive: true }),
    mkdir(metaDir, { recursive: true }),
    mkdir(previewsDir, { recursive: true }),
    mkdir(recordingsDir, { recursive: true })
  ]);
}

function scenePath(id: string) {
  const { boardsDir } = getStoragePaths();
  return path.join(boardsDir, `${id}.scene.json`);
}

function metaPath(id: string) {
  const { metaDir } = getStoragePaths();
  return path.join(metaDir, `${id}.json`);
}

function previewDiskPath(id: string) {
  const { previewsDir } = getStoragePaths();
  return path.join(previewsDir, `${id}.png`);
}

export { previewDiskPath };

function recordingBoardDir(boardId: string) {
  const { recordingsDir } = getStoragePaths();
  return path.join(recordingsDir, boardId);
}

function recordingMetaPath(boardId: string, recordingId: string) {
  return path.join(recordingBoardDir(boardId), `${recordingId}.json`);
}

function recordingAudioDiskPath(boardId: string, recordingId: string, extension: string) {
  return path.join(recordingBoardDir(boardId), `${recordingId}.${extension}`);
}

function recordingFrameDiskPath(boardId: string, recordingId: string, index: number) {
  return path.join(recordingBoardDir(boardId), `${recordingId}-frame-${index}.png`);
}

function recordingAudioPublicPath(boardId: string, recordingId: string, extension: string) {
  return `/recordings/${boardId}/${recordingId}.${extension}`;
}

function recordingFramePublicPath(boardId: string, recordingId: string, index: number) {
  return `/recordings/${boardId}/${recordingId}-frame-${index}.png`;
}

export async function listBoards(): Promise<BoardMeta[]> {
  await ensureStorage();
  const { metaDir } = getStoragePaths();
  const files = await readdir(metaDir);
  const items = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => {
        const content = await readFile(path.join(metaDir, file), "utf8");
        return JSON.parse(content) as BoardMeta;
      })
  );

  return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createBoard(title = "Untitled board"): Promise<BoardRecord> {
  await ensureStorage();
  const id = `b_${nanoid(10)}`;
  const now = new Date().toISOString();
  const meta: BoardMeta = {
    id,
    title,
    createdAt: now,
    updatedAt: now,
    previewPath: null
  };
  const scene = emptyScene();

  await Promise.all([
    writeFile(metaPath(id), JSON.stringify(meta, null, 2), "utf8"),
    writeFile(scenePath(id), JSON.stringify(scene, null, 2), "utf8")
  ]);

  return { meta, scene };
}

export async function getBoard(id: string): Promise<BoardRecord | null> {
  await ensureStorage();
  try {
    const [metaRaw, sceneRaw] = await Promise.all([
      readFile(metaPath(id), "utf8"),
      readFile(scenePath(id), "utf8")
    ]);
    return {
      meta: JSON.parse(metaRaw) as BoardMeta,
      scene: sanitizeScene(JSON.parse(sceneRaw) as SceneData)
    };
  } catch {
    return null;
  }
}

export async function saveBoard(
  id: string,
  title: string,
  scene: SceneData,
  previewBase64?: string | null
): Promise<BoardRecord | null> {
  await ensureStorage();
  const existing = await getBoard(id);
  if (!existing) {
    return null;
  }

  const updatedMeta: BoardMeta = {
    ...existing.meta,
    title,
    updatedAt: new Date().toISOString(),
    previewPath: previewBase64 ? `/previews/${id}.png` : existing.meta.previewPath
  };
  const sanitizedScene = sanitizeScene(scene);

  const writes: Array<Promise<unknown>> = [
    writeFile(metaPath(id), JSON.stringify(updatedMeta, null, 2), "utf8"),
    writeFile(scenePath(id), JSON.stringify(sanitizedScene, null, 2), "utf8")
  ];

  if (previewBase64) {
    const payload = previewBase64.replace(/^data:image\/png;base64,/, "");
    writes.push(writeFile(previewDiskPath(id), payload, "base64"));
  }

  await Promise.all(writes);

  return { meta: updatedMeta, scene: sanitizedScene };
}

export async function deleteBoard(id: string): Promise<boolean> {
  await ensureStorage();
  const existing = await getBoard(id);
  if (!existing) {
    return false;
  }

  await Promise.all([
    rm(metaPath(id), { force: true }),
    rm(scenePath(id), { force: true }),
    rm(previewDiskPath(id), { force: true }),
    rm(recordingBoardDir(id), { recursive: true, force: true })
  ]);

  return true;
}

export async function hasPreview(id: string): Promise<boolean> {
  try {
    await stat(previewDiskPath(id));
    return true;
  } catch {
    return false;
  }
}

export async function listRecordings(boardId: string): Promise<RecordingMeta[]> {
  await ensureStorage();
  try {
    const files = await readdir(recordingBoardDir(boardId));
    const items = await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map(async (file) => normalizeRecordingMeta(JSON.parse(await readFile(path.join(recordingBoardDir(boardId), file), "utf8")) as RecordingMeta))
    );
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export async function getRecording(boardId: string, recordingId: string): Promise<RecordingMeta | null> {
  await ensureStorage();
  try {
    return normalizeRecordingMeta(JSON.parse(await readFile(recordingMetaPath(boardId, recordingId), "utf8")) as RecordingMeta);
  } catch {
    return null;
  }
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
): Promise<RecordingMeta | null> {
  await ensureStorage();
  const board = await getBoard(boardId);
  if (!board) {
    return null;
  }

  const recordingId = `r_${nanoid(10)}`;
  const audioMimeType = normalizeAudioMimeType(payload.audioMimeType);
  const audioExtension = getAudioExtension(audioMimeType);
  await mkdir(recordingBoardDir(boardId), { recursive: true });

  const frames: RecordingFrame[] = [];
  const writes: Array<Promise<unknown>> = [];

  payload.frames.forEach((frame, index) => {
    frames.push({
      timestampMs: frame.timestampMs,
      imagePath: recordingFramePublicPath(boardId, recordingId, index)
    });
    writes.push(
      writeFile(
        recordingFrameDiskPath(boardId, recordingId, index),
        frame.imageBase64.replace(/^data:image\/png;base64,/, ""),
        "base64"
      )
    );
  });

  writes.push(
    writeFile(
      recordingAudioDiskPath(boardId, recordingId, audioExtension),
      extractBase64Payload(payload.audioBase64),
      "base64"
    )
  );

  const meta: RecordingMeta = {
    id: recordingId,
    boardId,
    title: payload.title,
    createdAt: new Date().toISOString(),
    durationMs: payload.durationMs,
    audioPath: recordingAudioPublicPath(boardId, recordingId, audioExtension),
    audioMimeType,
    frames
  };

  writes.push(writeFile(recordingMetaPath(boardId, recordingId), JSON.stringify(meta, null, 2), "utf8"));
  await Promise.all(writes);
  return meta;
}

export async function deleteRecording(boardId: string, recordingId: string): Promise<boolean> {
  await ensureStorage();
  const recording = await getRecording(boardId, recordingId);
  if (!recording) {
    return false;
  }

  const audioFileName = path.basename(recording.audioPath);
  const frameFileNames = recording.frames.map((frame) => path.basename(frame.imagePath));

  await Promise.all([
    unlink(recordingMetaPath(boardId, recordingId)).catch(() => undefined),
    unlink(path.join(recordingBoardDir(boardId), audioFileName)).catch(() => undefined),
    ...frameFileNames.map((fileName) => unlink(path.join(recordingBoardDir(boardId), fileName)).catch(() => undefined))
  ]);

  return true;
}

function normalizeRecordingMeta(meta: RecordingMeta): RecordingMeta {
  const audioMimeType = normalizeAudioMimeType(meta.audioMimeType ?? inferAudioMimeType(meta.audioPath));
  return {
    ...meta,
    audioMimeType
  };
}

function extractBase64Payload(dataUrl: string) {
  const separatorIndex = dataUrl.indexOf(",");
  return separatorIndex >= 0 ? dataUrl.slice(separatorIndex + 1) : dataUrl;
}

function normalizeAudioMimeType(audioMimeType: string) {
  switch (audioMimeType) {
    case "audio/mp4":
    case "audio/mp4;codecs=mp4a.40.2":
      return "audio/mp4";
    case "audio/ogg":
    case "audio/ogg;codecs=opus":
      return "audio/ogg";
    case "audio/webm":
    case "audio/webm;codecs=opus":
      return "audio/webm";
    default:
      return "audio/webm";
  }
}

function getAudioExtension(audioMimeType: string) {
  switch (audioMimeType) {
    case "audio/mp4":
      return "mp4";
    case "audio/ogg":
      return "ogg";
    default:
      return "webm";
  }
}

function inferAudioMimeType(audioPath: string) {
  if (audioPath.endsWith(".mp4")) {
    return "audio/mp4";
  }
  if (audioPath.endsWith(".ogg")) {
    return "audio/ogg";
  }
  return "audio/webm";
}

function getStoragePaths() {
  const dataRoot = process.env.WHITEBOARD_DATA_DIR
    ? path.resolve(process.env.WHITEBOARD_DATA_DIR)
    : path.join(process.cwd(), "data");

  return {
    dataRoot,
    boardsDir: path.join(dataRoot, "boards"),
    metaDir: path.join(dataRoot, "meta"),
    previewsDir: path.join(dataRoot, "previews"),
    recordingsDir: path.join(dataRoot, "recordings")
  };
}
