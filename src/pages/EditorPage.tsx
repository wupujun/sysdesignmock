import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import {
  createRecording,
  fetchBoard,
  fetchRecordings,
  removeRecording,
  saveBoard,
  type RecordingMeta,
  type SceneData
} from "../api";
import { ExcalidrawCanvas } from "../components/ExcalidrawCanvas";
import { sanitizeScene } from "../scene";
import {
  AUTOSAVE_INTERVAL_SECONDS,
  createSavedSnapshot,
  getAutosaveText,
  getNextAutosaveCountdown,
  getNextSaveStatus,
  type SaveStatus
} from "../editorState";

type RecordingStatus = "idle" | "recording" | "saving" | "error";
type RecordingFrameDraft = {
  timestampMs: number;
  imageBase64: string;
};

type RecordingMimeOption = {
  mimeType: string;
};

const RECORDING_FRAME_INTERVAL_MS = 5000;
const RECORDING_MIME_OPTIONS: RecordingMimeOption[] = [
  { mimeType: "audio/webm;codecs=opus" },
  { mimeType: "audio/webm" },
  { mimeType: "audio/ogg;codecs=opus" },
  { mimeType: "audio/ogg" },
  { mimeType: "audio/mp4;codecs=mp4a.40.2" },
  { mimeType: "audio/mp4" }
];

export function EditorPage() {
  const { boardId } = useParams();
  const navigate = useNavigate();
  const excalidrawRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const savedSnapshotRef = useRef<string>("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingFramesRef = useRef<RecordingFrameDraft[]>([]);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const recordingMimeTypeRef = useRef<string>("");
  const recordingsMenuRef = useRef<HTMLDivElement | null>(null);
  const [title, setTitle] = useState("Untitled board");
  const [initialScene, setInitialScene] = useState<SceneData | null>(null);
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [secondsUntilAutosave, setSecondsUntilAutosave] = useState(AUTOSAVE_INTERVAL_SECONDS);
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>("idle");
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<RecordingMeta[]>([]);
  const [deletingRecordingId, setDeletingRecordingId] = useState<string | null>(null);
  const [isRecordingsPanelOpen, setIsRecordingsPanelOpen] = useState(false);
  const [recordingsPopoverStyle, setRecordingsPopoverStyle] = useState<{ top: number; right: number; width: number } | null>(null);

  useEffect(() => {
    if (!boardId) {
      return;
    }
    void loadBoard(boardId);
    void loadRecordings(boardId);
  }, [boardId]);

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (status === "dirty" || status === "saving" || recordingStatus === "recording" || recordingStatus === "saving") {
        event.preventDefault();
        event.returnValue = "";
      }
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [status, recordingStatus]);

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    if (status === "dirty") {
      setSecondsUntilAutosave(AUTOSAVE_INTERVAL_SECONDS);
      const interval = window.setInterval(() => {
        setSecondsUntilAutosave((current) => {
          const next = getNextAutosaveCountdown(current);
          if (next.shouldAutosave) {
            void handleSave(true);
          }
          return next.nextSecondsUntilAutosave;
        });
      }, 1000);

      return () => window.clearInterval(interval);
    }

    setSecondsUntilAutosave(AUTOSAVE_INTERVAL_SECONDS);
  }, [isLoaded, status]);

  useEffect(() => {
    if (recordingStatus !== "recording") {
      return;
    }

    const interval = window.setInterval(() => {
      if (recordingStartedAtRef.current) {
        setRecordingElapsedMs(Date.now() - recordingStartedAtRef.current);
      }
    }, 500);

    return () => window.clearInterval(interval);
  }, [recordingStatus]);

  useEffect(() => {
    return () => {
      cleanupRecordingResources();
    };
  }, []);

  useEffect(() => {
    if (!isRecordingsPanelOpen) {
      return;
    }

    function updateRecordingsPopoverPosition() {
      const trigger = recordingsMenuRef.current;
      if (!trigger) {
        return;
      }

      const rect = trigger.getBoundingClientRect();
      const viewportPadding = 16;
      const width = Math.min(420, window.innerWidth - viewportPadding * 2);
      const left = Math.min(rect.right - width, window.innerWidth - viewportPadding - width);
      setRecordingsPopoverStyle({
        top: rect.bottom + 8,
        right: Math.max(viewportPadding, window.innerWidth - (left + width)),
        width
      });
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (recordingsMenuRef.current?.contains(target)) {
        return;
      }

      const popover = document.getElementById("recordings-popover");
      if (popover?.contains(target)) {
        return;
      }

      setIsRecordingsPanelOpen(false);
    }

    updateRecordingsPopoverPosition();
    window.addEventListener("resize", updateRecordingsPopoverPosition);
    window.addEventListener("scroll", updateRecordingsPopoverPosition, true);
    document.addEventListener("mousedown", handlePointerDown);

    return () => {
      window.removeEventListener("resize", updateRecordingsPopoverPosition);
      window.removeEventListener("scroll", updateRecordingsPopoverPosition, true);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isRecordingsPanelOpen]);

  async function loadBoard(id: string) {
    setStatus("loading");
    setError(null);
    try {
      const data = await fetchBoard(id);
      const sanitizedScene = sanitizeScene(data.scene);
      setTitle(data.meta.title);
      setInitialScene(sanitizedScene);
      savedSnapshotRef.current = createSavedSnapshot(data.meta.title, sanitizedScene);
      setStatus("saved");
      setIsLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load board");
      setStatus("error");
    }
  }

  async function loadRecordings(id: string) {
    try {
      setRecordings(await fetchRecordings(id));
    } catch {
      setRecordings([]);
    }
  }

  async function handleSave(isAutosave = false) {
    if (!boardId || !excalidrawRef.current) {
      return;
    }

    if (status === "saving") {
      return;
    }

    const currentScene = getCurrentSceneSnapshot(excalidrawRef.current);
    if (!currentScene) {
      return;
    }

    setStatus("saving");
    setError(null);

    try {
      const preview = await exportCurrentSceneAsDataUrl(excalidrawRef.current);
      await saveBoard(boardId, { title, scene: currentScene, preview });
      savedSnapshotRef.current = createSavedSnapshot(title, currentScene);
      setStatus("saved");
      setSecondsUntilAutosave(AUTOSAVE_INTERVAL_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${isAutosave ? "auto-save" : "save"} board`);
      setStatus("error");
    }
  }

  function handleSceneChange(elements: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) {
    if (!isLoaded) {
      return;
    }

    const currentScene = sanitizeScene({
      type: "excalidraw",
      version: 2,
      source: "local-whiteboard-app",
      elements: [...elements],
      appState,
      files
    });
    setStatus((current) => getNextSaveStatus(current, title, currentScene, savedSnapshotRef.current));
  }

  async function handleStartRecording() {
    if (!boardId || !excalidrawRef.current || recordingStatus === "recording" || recordingStatus === "saving") {
      return;
    }

    setRecordingError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getPreferredRecordingMimeType();
      recordingMimeTypeRef.current = normalizeAudioMimeType(mimeType?.mimeType ?? "");
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType: mimeType.mimeType } : undefined);
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = [];
      recordingFramesRef.current = [];
      recordingStartedAtRef.current = Date.now();
      setRecordingElapsedMs(0);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };

      await captureRecordingFrame();
      recorder.start();
      recordingIntervalRef.current = window.setInterval(() => {
        void captureRecordingFrame();
      }, RECORDING_FRAME_INTERVAL_MS);

      setRecordingStatus("recording");
    } catch (err) {
      setRecordingError(err instanceof Error ? err.message : "Unable to start microphone recording");
      setRecordingStatus("error");
      cleanupRecordingResources();
    }
  }

  async function handleStopRecording() {
    if (!boardId || !mediaRecorderRef.current || recordingStatus !== "recording") {
      return;
    }

    setRecordingStatus("saving");
    setRecordingError(null);

    try {
      await captureRecordingFrame();
      const audioBlob = await stopRecorder(mediaRecorderRef.current, recordingChunksRef.current);
      const audioMimeType = normalizeAudioMimeType(audioBlob.type || recordingMimeTypeRef.current);
      const audioBase64 = await blobToDataUrl(audioBlob);
      const durationMs = recordingStartedAtRef.current ? Date.now() - recordingStartedAtRef.current : recordingElapsedMs;
      const recording = await createRecording(boardId, {
        title: `${title} interview replay`,
        durationMs,
        audioMimeType,
        audioBase64,
        frames: recordingFramesRef.current
      });
      setRecordings((current) => [recording, ...current]);
      setRecordingStatus("idle");
      setRecordingElapsedMs(0);
    } catch (err) {
      setRecordingStatus("error");
      setRecordingError(err instanceof Error ? err.message : "Failed to save recording");
    } finally {
      cleanupRecordingResources();
    }
  }

  async function handleDeleteRecording(recordingId: string) {
    if (!boardId || deletingRecordingId) {
      return;
    }

    const confirmed = window.confirm("Delete this replay?");
    if (!confirmed) {
      return;
    }

    setDeletingRecordingId(recordingId);
    setRecordingError(null);
    try {
      await removeRecording(boardId, recordingId);
      setRecordings((current) => current.filter((recording) => recording.id !== recordingId));
    } catch (err) {
      setRecordingError(err instanceof Error ? err.message : "Failed to delete replay");
    } finally {
      setDeletingRecordingId(null);
    }
  }

  async function captureRecordingFrame() {
    if (!excalidrawRef.current || !recordingStartedAtRef.current) {
      return;
    }

    const imageBase64 = await exportCurrentSceneAsDataUrl(excalidrawRef.current);
    recordingFramesRef.current.push({
      timestampMs: Date.now() - recordingStartedAtRef.current,
      imageBase64
    });
  }

  function cleanupRecordingResources() {
    if (recordingIntervalRef.current !== null) {
      window.clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    mediaRecorderRef.current = null;
    recordingStartedAtRef.current = null;
    recordingMimeTypeRef.current = "";
    recordingChunksRef.current = [];
    recordingFramesRef.current = [];
  }

  function handleBack() {
    if (recordingStatus === "recording" || recordingStatus === "saving") {
      const confirmed = window.confirm("A recording is in progress. Leave and discard it?");
      if (!confirmed) {
        return;
      }
      cleanupRecordingResources();
      setRecordingStatus("idle");
      setRecordingElapsedMs(0);
    }

    if (status === "dirty" || status === "saving") {
      const confirmed = window.confirm("Leave without saving your latest changes?");
      if (!confirmed) {
        return;
      }
    }
    navigate("/");
  }

  if (!boardId) {
    return <div className="editor-shell">Missing board id.</div>;
  }

  if (status === "loading" || !initialScene) {
    return <div className="editor-shell">Loading board...</div>;
  }

  return (
    <div className="editor-shell">
      <header className="editor-header">
        <div className="editor-primary">
          <button className="secondary-button" onClick={handleBack}>
            Back
          </button>
          <label className="title-field compact">
            <span className="title-label">Board</span>
            <input
              value={title}
              onChange={(event) => {
                const nextTitle = event.target.value;
                setTitle(nextTitle);
                const currentScene = getCurrentSceneSnapshot(excalidrawRef.current);
                if (!currentScene) {
                  return;
                }
                setStatus((current) => getNextSaveStatus(current, nextTitle, currentScene, savedSnapshotRef.current));
              }}
            />
          </label>
        </div>
        <div className="editor-statuses">
          <div className="save-meta">
            <span className={`save-pill ${status}`}>{renderStatus(status)}</span>
            <span className="autosave-text">{getAutosaveText(status, secondsUntilAutosave)}</span>
          </div>
        </div>
        <div className="editor-actions">
          <div className="recordings-menu" ref={recordingsMenuRef}>
            <button
              type="button"
              className="secondary-button recordings-menu-toggle"
              onClick={() => setIsRecordingsPanelOpen((current) => !current)}
              aria-expanded={isRecordingsPanelOpen}
            >
              Replays ({recordings.length})
            </button>
            {isRecordingsPanelOpen && recordingsPopoverStyle
              ? createPortal(
              <div
                id="recordings-popover"
                className="recordings-popover"
                style={{
                  top: recordingsPopoverStyle.top,
                  right: recordingsPopoverStyle.right,
                  width: recordingsPopoverStyle.width
                }}
              >
                {recordings.length === 0 ? (
                  <div className="recordings-empty">Start recording during the walkthrough to save a replay.</div>
                ) : (
                  <div className="recordings-list compact">
                    {recordings.map((recording) => (
                      <article key={recording.id} className="recording-card compact">
                        <div className="recording-card-copy">
                          <strong>{recording.title}</strong>
                          <span className="muted">
                            {Math.round(recording.durationMs / 1000)}s | {new Date(recording.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <div className="recording-card-actions">
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => navigate(`/boards/${boardId}/replays/${recording.id}`)}
                          >
                            Replay
                          </button>
                          <button
                            type="button"
                            className="danger-button"
                            onClick={() => void handleDeleteRecording(recording.id)}
                            disabled={deletingRecordingId === recording.id}
                          >
                            {deletingRecordingId === recording.id ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>,
              document.body
            ) : null}
          </div>
          {recordingStatus === "recording" ? (
            <button type="button" className="danger-button" onClick={() => void handleStopRecording()}>
              Stop Recording
            </button>
          ) : (
            <button type="button" className="secondary-button" onClick={() => void handleStartRecording()} disabled={recordingStatus === "saving"}>
              Start Recording
            </button>
          )}
          <button type="button" className="primary-button" onClick={() => void handleSave()} disabled={status === "saving"}>
            Save
          </button>
        </div>
      </header>

      {error ? <div className="editor-banner error">{error}</div> : null}
      {recordingError ? <div className="editor-banner error">{recordingError}</div> : null}

      <div className="editor-canvas">
        <ExcalidrawCanvas
          scene={initialScene}
          onReady={(api) => {
            excalidrawRef.current = api;
          }}
          onChange={handleSceneChange}
        />
      </div>
    </div>
  );
}

function renderStatus(status: SaveStatus) {
  switch (status) {
    case "saved":
      return "Saved";
    case "dirty":
      return "Unsaved";
    case "saving":
      return "Saving";
    case "error":
      return "Error";
    default:
      return "Loading";
  }
}

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getCurrentSceneSnapshot(api: ExcalidrawImperativeAPI | null): SceneData | null {
  if (!api) {
    return null;
  }

  return sanitizeScene({
    type: "excalidraw",
    version: 2,
    source: "local-whiteboard-app",
    elements: api.getSceneElementsIncludingDeleted(),
    appState: api.getAppState(),
    files: api.getFiles()
  });
}

async function exportCurrentSceneAsDataUrl(api: ExcalidrawImperativeAPI) {
  const elements = api.getSceneElementsIncludingDeleted();
  const appState = api.getAppState();
  const files = api.getFiles();
  const { exportToBlob } = await import("@excalidraw/excalidraw");
  const previewBlob = await exportToBlob({
    elements: elements.filter((element) => !element.isDeleted),
    appState: {
      ...appState,
      exportBackground: true
    },
    files,
    mimeType: "image/png"
  });

  return blobToDataUrl(previewBlob);
}

function stopRecorder(recorder: MediaRecorder, chunks: Blob[]) {
  return new Promise<Blob>((resolve, reject) => {
    recorder.onerror = () => reject(recorder.error ?? new Error("Recording failed"));
    recorder.onstop = () =>
      resolve(new Blob(chunks, { type: normalizeAudioMimeType(recorder.mimeType || chunks[0]?.type || "") || "audio/webm" }));
    recorder.stop();
  });
}

function getPreferredRecordingMimeType() {
  if (typeof MediaRecorder === "undefined") {
    return null;
  }

  return RECORDING_MIME_OPTIONS.find((option) => MediaRecorder.isTypeSupported(option.mimeType)) ?? null;
}

function normalizeAudioMimeType(mimeType: string) {
  if (mimeType.startsWith("audio/mp4")) {
    return "audio/mp4";
  }
  if (mimeType.startsWith("audio/ogg")) {
    return "audio/ogg";
  }
  if (mimeType.startsWith("audio/webm")) {
    return "audio/webm";
  }
  return "";
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to read blob"));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}
