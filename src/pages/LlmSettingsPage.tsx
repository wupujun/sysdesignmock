import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { validateLlmConfig } from "../api";
import {
  DEFAULT_LLM_CONFIG,
  LLM_PROVIDER_PRESETS,
  getProviderPreset,
  loadLlmConfig,
  saveLlmConfig,
  type LlmConfig,
  type LlmProviderId
} from "../llmConfig";

export function LlmSettingsPage() {
  const navigate = useNavigate();
  const [config, setConfig] = useState<LlmConfig>(DEFAULT_LLM_CONFIG);
  const [saved, setSaved] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testSuccess, setTestSuccess] = useState<string | null>(null);

  useEffect(() => {
    setConfig(loadLlmConfig());
  }, []);

  useEffect(() => {
    if (!saved) {
      return;
    }

    const timeout = window.setTimeout(() => setSaved(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [saved]);

  useEffect(() => {
    setTestError(null);
    setTestSuccess(null);
  }, [config]);

  const selectedProvider = useMemo(() => getProviderPreset(config.providerId), [config.providerId]);

  function applyProvider(providerId: LlmProviderId) {
    const preset = getProviderPreset(providerId);
    setConfig((current) => ({
      providerId,
      endpoint: preset.endpoint,
      apiKey: current.apiKey,
      model: preset.models[0] ?? current.model
    }));
  }

  function handleSave() {
    saveLlmConfig(config);
    setSaved(true);
  }

  async function handleTest() {
    setTestBusy(true);
    setTestError(null);
    setTestSuccess(null);

    try {
      const result = await validateLlmConfig(config);
      setTestSuccess(`Connected successfully. Server resolved model: ${result.model}`);
    } catch (error) {
      setTestError(error instanceof Error ? error.message : "Connection test failed");
    } finally {
      setTestBusy(false);
    }
  }

  return (
    <div className="settings-shell">
      <header className="settings-header">
        <div>
          <p className="eyebrow">Configuration</p>
          <h1>LLM Settings</h1>
          <p className="muted">Choose a provider preset, then adjust the endpoint, model, and API key if needed.</p>
        </div>
        <div className="settings-header-actions">
          <Link className="secondary-button settings-link-button" to="/">
            Back to boards
          </Link>
          <button className="primary-button" onClick={handleSave}>
            {saved ? "Saved" : "Save config"}
          </button>
        </div>
      </header>

      <section className="settings-layout">
        <div className="settings-main">
          <div className="settings-provider-grid">
            {LLM_PROVIDER_PRESETS.map((provider) => (
              <button
                key={provider.id}
                type="button"
                className={`provider-card ${provider.id === config.providerId ? "selected" : ""}`}
                onClick={() => applyProvider(provider.id)}
              >
                <strong>{provider.label}</strong>
                <span>{provider.notes}</span>
              </button>
            ))}
          </div>

          <div className="panel settings-panel">
            <div className="settings-panel-header">
              <div>
                <p className="eyebrow">Provider</p>
                <h3>{selectedProvider.label}</h3>
              </div>
              <span className="settings-badge">{selectedProvider.models.length || "Custom"} models</span>
            </div>

            <label className="search settings-field">
              <span>Endpoint</span>
              <input
                value={config.endpoint}
                onChange={(event) => setConfig((current) => ({ ...current, endpoint: event.target.value }))}
                placeholder="https://api.openai.com/v1"
              />
            </label>

            <label className="search settings-field">
              <span>Model</span>
              <select
                value={selectedProvider.models.includes(config.model) ? config.model : "__custom__"}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value !== "__custom__") {
                    setConfig((current) => ({ ...current, model: value }));
                  }
                }}
              >
                {selectedProvider.models.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
                <option value="__custom__">Custom model</option>
              </select>
            </label>

            <label className="search settings-field">
              <span>Custom model name</span>
              <input
                value={config.model}
                onChange={(event) => setConfig((current) => ({ ...current, model: event.target.value }))}
                placeholder="Enter a model id"
              />
            </label>

            <label className="search settings-field">
              <span>API key</span>
              <input
                type="password"
                value={config.apiKey}
                onChange={(event) => setConfig((current) => ({ ...current, apiKey: event.target.value }))}
                placeholder="Paste provider API key"
              />
            </label>

            <div className="settings-footer">
              <span className="muted">{selectedProvider.notes}</span>
              <div className="settings-footer-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={handleTest}
                  disabled={testBusy || !config.endpoint.trim() || !config.apiKey.trim() || !config.model.trim()}
                >
                  {testBusy ? "Testing..." : "Test connection"}
                </button>
                <button className="secondary-button" type="button" onClick={() => navigate("/")}>
                  Done
                </button>
              </div>
            </div>
            {testError ? <div className="panel error">{testError}</div> : null}
            {testSuccess ? <div className="panel settings-success">{testSuccess}</div> : null}
          </div>
        </div>

        <aside className="panel settings-aside">
          <p className="eyebrow">Quick Start</p>
          <h3>How this is used</h3>
          <p>
            Board evaluation reads this saved config and sends the selected board to the configured endpoint at run time.
          </p>
          <p className="muted">
            Presets are editable. If your gateway uses a different model id or base URL, change it here and save.
          </p>
        </aside>
      </section>
    </div>
  );
}
