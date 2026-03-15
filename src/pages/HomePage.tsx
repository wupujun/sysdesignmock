import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createBoard, evaluateBoard, fetchBoards, removeBoard, type BoardEvaluationResult, type BoardMeta } from "../api";

const EVALUATION_STORAGE_KEY = "sysdesignmock-evaluation-config";

export function HomePage() {
  const navigate = useNavigate();
  const [boards, setBoards] = useState<BoardMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evaluationApiKey, setEvaluationApiKey] = useState("");
  const [evaluationModel, setEvaluationModel] = useState("gpt-5-mini");
  const [evaluationBusy, setEvaluationBusy] = useState(false);
  const [evaluationError, setEvaluationError] = useState<string | null>(null);
  const [evaluationResult, setEvaluationResult] = useState<BoardEvaluationResult | null>(null);

  useEffect(() => {
    void loadBoards();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const stored = window.localStorage.getItem(EVALUATION_STORAGE_KEY);
    if (!stored) {
      return;
    }

    try {
      const parsed = JSON.parse(stored) as { apiKey?: string; model?: string };
      setEvaluationApiKey(typeof parsed.apiKey === "string" ? parsed.apiKey : "");
      setEvaluationModel(typeof parsed.model === "string" && parsed.model.trim() ? parsed.model : "gpt-5-mini");
    } catch {
      // Ignore malformed local state.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      EVALUATION_STORAGE_KEY,
      JSON.stringify({
        apiKey: evaluationApiKey,
        model: evaluationModel
      })
    );
  }, [evaluationApiKey, evaluationModel]);

  async function loadBoards() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchBoards();
      setBoards(data);
      setSelectedId((current) => current ?? data[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load boards");
    } finally {
      setLoading(false);
    }
  }

  const filteredBoards = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return boards;
    }
    return boards.filter((board) => board.title.toLowerCase().includes(query));
  }, [boards, search]);

  const selectedBoard =
    filteredBoards.find((board) => board.id === selectedId) ??
    boards.find((board) => board.id === selectedId) ??
    null;

  useEffect(() => {
    setEvaluationError(null);
    setEvaluationResult(null);
  }, [selectedBoard?.id]);

  async function handleCreate() {
    setBusy(true);
    try {
      const board = await createBoard();
      navigate(`/boards/${board.id}/edit`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create board");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!selectedBoard) {
      return;
    }
    const confirmed = window.confirm(`Delete "${selectedBoard.title}"?`);
    if (!confirmed) {
      return;
    }

    setBusy(true);
    try {
      await removeBoard(selectedBoard.id);
      const remaining = boards.filter((board) => board.id !== selectedBoard.id);
      setBoards(remaining);
      setSelectedId(remaining[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete board");
    } finally {
      setBusy(false);
    }
  }

  async function handleEvaluate() {
    if (!selectedBoard) {
      return;
    }

    setEvaluationBusy(true);
    setEvaluationError(null);
    try {
      const result = await evaluateBoard(selectedBoard.id, {
        apiKey: evaluationApiKey,
        model: evaluationModel
      });
      setEvaluationResult(result);
    } catch (err) {
      setEvaluationError(err instanceof Error ? err.message : "Failed to evaluate board");
    } finally {
      setEvaluationBusy(false);
    }
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Local whiteboards</p>
          <h1>Boards</h1>
        </div>
        <button className="primary-button" onClick={handleCreate} disabled={busy}>
          + New board
        </button>
        <label className="search">
          <span>Search</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a board" />
        </label>
        <div className="sidebar-list">
          {filteredBoards.map((board) => (
            <button
              key={board.id}
              className={`sidebar-item ${board.id === selectedId ? "selected" : ""}`}
              onClick={() => setSelectedId(board.id)}
            >
              <strong>{board.title}</strong>
              <span>{formatDate(board.updatedAt)}</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="content">
        <header className="content-header">
          <div>
            <p className="eyebrow">Workspace</p>
            <h2>Recent boards</h2>
          </div>
          <button className="secondary-button" onClick={loadBoards} disabled={loading}>
            Refresh
          </button>
        </header>

        {error ? <div className="panel error">{error}</div> : null}

        {loading ? (
          <div className="panel">Loading boards...</div>
        ) : (
          <div className="board-grid">
            {filteredBoards.map((board) => (
              <button
                key={board.id}
                className="board-card"
                onClick={() => setSelectedId(board.id)}
                onDoubleClick={() => navigate(`/boards/${board.id}/edit`)}
              >
                <div className="board-thumb">
                  {board.previewPath ? <img src={board.previewPath} alt={board.title} /> : <span>Blank board</span>}
                </div>
                <div className="board-card-body">
                  <strong>{board.title}</strong>
                  <span>{formatDate(board.updatedAt)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      <section className="detail-panel">
        {selectedBoard ? (
          <>
            <p className="eyebrow">Selected board</p>
            <h3>{selectedBoard.title}</h3>
            <p className="muted">Updated {formatDate(selectedBoard.updatedAt)}</p>
            <div className="detail-preview">
              {selectedBoard.previewPath ? (
                <img src={selectedBoard.previewPath} alt={selectedBoard.title} />
              ) : (
                <span>No preview yet. Save from the editor to generate one.</span>
              )}
            </div>
            <div className="detail-actions">
              <button className="primary-button" onClick={() => navigate(`/boards/${selectedBoard.id}/edit`)}>
                Open
              </button>
              <button className="danger-button" onClick={handleDelete} disabled={busy}>
                Delete
              </button>
            </div>
            <div className="evaluation-panel">
              <div className="evaluation-panel-header">
                <div>
                  <p className="eyebrow">Evaluation</p>
                  <h3>LLM Review</h3>
                </div>
                {evaluationResult ? (
                  <div className="evaluation-score">
                    {evaluationResult.totalScore}/{evaluationResult.maxScore}
                  </div>
                ) : null}
              </div>
              <p className="muted">Run a rubric-based review against the selected saved board.</p>
              <label className="search evaluation-field">
                <span>API Key</span>
                <input
                  type="password"
                  value={evaluationApiKey}
                  onChange={(event) => setEvaluationApiKey(event.target.value)}
                  placeholder="sk-..."
                />
              </label>
              <label className="search evaluation-field">
                <span>Model</span>
                <input
                  value={evaluationModel}
                  onChange={(event) => setEvaluationModel(event.target.value)}
                  placeholder="gpt-5-mini"
                />
              </label>
              <div className="evaluation-actions">
                <button
                  className="primary-button"
                  onClick={handleEvaluate}
                  disabled={evaluationBusy || !evaluationApiKey.trim()}
                >
                  {evaluationBusy ? "Evaluating..." : "Evaluate Board"}
                </button>
                <span className="muted">Using: {selectedBoard.title}</span>
              </div>
              {evaluationError ? <div className="panel error">{evaluationError}</div> : null}
              {evaluationResult ? (
                <div className="evaluation-results">
                  <div className="panel">
                    <strong>Summary</strong>
                    <p>{evaluationResult.summary}</p>
                    <p className="muted">Model: {evaluationResult.model}</p>
                  </div>
                  <div className="evaluation-rubric">
                    {evaluationResult.rubric.map((criterion) => (
                      <article key={criterion.criterionId} className="panel evaluation-rubric-card">
                        <div className="evaluation-rubric-header">
                          <strong>{criterion.title}</strong>
                          <span className="evaluation-score-chip">
                            {criterion.score}/{criterion.maxScore}
                          </span>
                        </div>
                        <p>{criterion.justification}</p>
                      </article>
                    ))}
                  </div>
                  <div className="panel">
                    <strong>Strengths</strong>
                    <ul className="evaluation-list">
                      {evaluationResult.strengths.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="panel">
                    <strong>Gaps</strong>
                    <ul className="evaluation-list">
                      {evaluationResult.gaps.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="panel">
                    <strong>Recommendations</strong>
                    <ul className="evaluation-list">
                      {evaluationResult.recommendations.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <h3>No board selected</h3>
            <p>Create a board to start drawing.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
