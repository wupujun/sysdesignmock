import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { evaluateBoard, fetchBoard, generateImprovedBoard, type BoardEvaluationResult, type BoardRecord } from "../api";
import { getProviderPreset, loadLlmConfig, type LlmConfig } from "../llmConfig";

export function EvaluationPage() {
  const { boardId } = useParams();
  const navigate = useNavigate();
  const [board, setBoard] = useState<BoardRecord | null>(null);
  const [llmConfig, setLlmConfig] = useState<LlmConfig>(loadLlmConfig());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [evaluationBusy, setEvaluationBusy] = useState(false);
  const [evaluationError, setEvaluationError] = useState<string | null>(null);
  const [evaluationResult, setEvaluationResult] = useState<BoardEvaluationResult | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  useEffect(() => {
    if (!boardId) {
      return;
    }
    void loadBoard(boardId);
  }, [boardId]);

  useEffect(() => {
    const handleStorage = () => {
      setLlmConfig(loadLlmConfig());
    };

    window.addEventListener("storage", handleStorage);
    handleStorage();
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  async function loadBoard(id: string) {
    setLoading(true);
    setError(null);
    try {
      setBoard(await fetchBoard(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load board");
    } finally {
      setLoading(false);
    }
  }

  async function handleEvaluate() {
    if (!boardId) {
      return;
    }

    setEvaluationBusy(true);
    setEvaluationError(null);
    try {
      const result = await evaluateBoard(boardId, {
        providerId: llmConfig.providerId,
        endpoint: llmConfig.endpoint,
        apiKey: llmConfig.apiKey,
        model: llmConfig.model
      });
      setEvaluationResult(result);
    } catch (err) {
      setEvaluationError(err instanceof Error ? err.message : "Failed to evaluate board");
    } finally {
      setEvaluationBusy(false);
    }
  }

  async function handleGenerateDraft() {
    if (!boardId || !evaluationResult) {
      return;
    }

    setDraftBusy(true);
    setDraftError(null);
    try {
      const draft = await generateImprovedBoard(boardId, {
        providerId: llmConfig.providerId,
        endpoint: llmConfig.endpoint,
        apiKey: llmConfig.apiKey,
        model: llmConfig.model,
        evaluation: evaluationResult
      });
      navigate(`/boards/${draft.id}/edit`);
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "Failed to generate improved draft");
    } finally {
      setDraftBusy(false);
    }
  }

  if (!boardId) {
    return <div className="evaluation-page-shell">Missing board id.</div>;
  }

  const provider = getProviderPreset(llmConfig.providerId);

  return (
    <div className="evaluation-page-shell">
      <header className="evaluation-page-header">
        <div>
          <p className="eyebrow">Board Evaluation</p>
          <h1>{board?.meta.title ?? "Loading board..."}</h1>
          <p className="muted">Evaluation runs against the last saved version of this board.</p>
        </div>
        <div className="evaluation-page-actions">
          <Link className="secondary-button settings-link-button" to="/settings/llm">
            LLM config
          </Link>
          <button className="secondary-button" onClick={() => navigate(`/boards/${boardId}/edit`)}>
            Back to editor
          </button>
        </div>
      </header>

      {loading ? <div className="panel">Loading board...</div> : null}
      {error ? <div className="panel error">{error}</div> : null}

      {board ? (
        <div className="evaluation-page-layout">
          <aside className="panel evaluation-page-sidebar">
            <p className="eyebrow">Input</p>
            <h3>{board.meta.title}</h3>
            <p className="muted">Updated {formatDate(board.meta.updatedAt)}</p>
            <div className="detail-preview evaluation-page-preview">
              {board.meta.previewPath ? (
                <img src={board.meta.previewPath} alt={board.meta.title} />
              ) : (
                <span>No preview yet. Save from the editor first.</span>
              )}
            </div>
            <div className="panel evaluation-config-summary">
              <div>
                <strong>{provider.label}</strong>
                <p className="muted">
                  {llmConfig.model} via {llmConfig.endpoint}
                </p>
              </div>
            </div>
            <button
              className="primary-button"
              onClick={handleEvaluate}
              disabled={evaluationBusy || !llmConfig.endpoint.trim() || !llmConfig.apiKey.trim() || !llmConfig.model.trim()}
            >
              {evaluationBusy ? "Evaluating..." : "Run Evaluation"}
            </button>
            {!llmConfig.apiKey.trim() ? (
              <div className="panel error">Configure an API key in LLM config before running evaluation.</div>
            ) : null}
            {evaluationError ? <div className="panel error">{evaluationError}</div> : null}
            {draftError ? <div className="panel error">{draftError}</div> : null}
          </aside>

          <main className="evaluation-page-results">
            {evaluationResult ? (
              <div className="evaluation-results">
                <div className="panel evaluation-result-hero">
                  <div className="evaluation-panel-header">
                    <div>
                      <p className="eyebrow">Result</p>
                      <h3>Rubric Score</h3>
                    </div>
                    <div className="evaluation-score">
                      {evaluationResult.totalScore}/{evaluationResult.maxScore}
                    </div>
                  </div>
                  <p>{evaluationResult.summary}</p>
                  <p className="muted">Model: {evaluationResult.model}</p>
                  <div className="evaluation-actions">
                    <button className="primary-button" onClick={handleGenerateDraft} disabled={draftBusy}>
                      {draftBusy ? "Generating Draft..." : "Generate Improved Board"}
                    </button>
                    <span className="muted">Creates a new draft board instead of overwriting this one.</span>
                  </div>
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
            ) : (
              <div className="panel evaluation-empty-state">
                Run evaluation to see the rubric score, strengths, gaps, and recommendations here.
              </div>
            )}
          </main>
        </div>
      ) : null}
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
