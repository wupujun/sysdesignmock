import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createBoard, fetchBoards, removeBoard, type BoardMeta } from "../api";

export function HomePage() {
  const navigate = useNavigate();
  const [boards, setBoards] = useState<BoardMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadBoards();
  }, []);

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

  return (
    <div className="shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Local whiteboards</p>
          <h1>Boards</h1>
        </div>
        <Link className="secondary-button nav-link-button" to="/settings/llm">
          LLM config
        </Link>
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
              <button className="secondary-button" onClick={() => navigate(`/boards/${selectedBoard.id}/evaluation`)}>
                Evaluation
              </button>
              <button className="danger-button" onClick={handleDelete} disabled={busy}>
                Delete
              </button>
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
