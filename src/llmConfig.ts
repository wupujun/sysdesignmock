export type LlmProviderId = "openai" | "claude" | "gemini" | "deepseek" | "glm" | "custom";

export type LlmProviderPreset = {
  id: LlmProviderId;
  label: string;
  endpoint: string;
  models: string[];
  notes: string;
};

export type LlmConfig = {
  providerId: LlmProviderId;
  endpoint: string;
  apiKey: string;
  model: string;
};

export const LLM_CONFIG_STORAGE_KEY = "sysdesignmock-llm-config";

export const LLM_PROVIDER_PRESETS: LlmProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    endpoint: "https://api.openai.com/v1",
    models: ["gpt-5-mini", "gpt-5", "gpt-4.1-mini"],
    notes: "Native OpenAI endpoint. Best fit for the Responses-style feature set."
  },
  {
    id: "claude",
    label: "Claude",
    endpoint: "https://api.anthropic.com/v1",
    models: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-sonnet-4-5"],
    notes: "Uses Anthropic's OpenAI SDK compatibility layer."
  },
  {
    id: "gemini",
    label: "Gemini",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-3-flash-preview"],
    notes: "Uses Google's OpenAI-compatible Gemini endpoint."
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    endpoint: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
    notes: "OpenAI-compatible chat endpoint from DeepSeek."
  },
  {
    id: "glm",
    label: "GLM",
    endpoint: "https://open.bigmodel.cn/api/coding/paas/v4",
    models: ["glm-5", "glm-4.7", "glm-4.6"],
    notes: "Uses Zhipu's OpenAI-compatible coding endpoint."
  },
  {
    id: "custom",
    label: "Custom",
    endpoint: "https://api.openai.com/v1",
    models: [],
    notes: "Use any other OpenAI-compatible provider or gateway."
  }
];

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  providerId: "openai",
  endpoint: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-5-mini"
};

export function getProviderPreset(providerId: LlmProviderId) {
  return LLM_PROVIDER_PRESETS.find((provider) => provider.id === providerId) ?? LLM_PROVIDER_PRESETS[0];
}

export function loadLlmConfig(): LlmConfig {
  if (typeof window === "undefined") {
    return DEFAULT_LLM_CONFIG;
  }

  const stored = window.localStorage.getItem(LLM_CONFIG_STORAGE_KEY);
  if (!stored) {
    return DEFAULT_LLM_CONFIG;
  }

  try {
    const parsed = JSON.parse(stored) as Partial<LlmConfig>;
    return {
      providerId: isProviderId(parsed.providerId) ? parsed.providerId : DEFAULT_LLM_CONFIG.providerId,
      endpoint: typeof parsed.endpoint === "string" && parsed.endpoint.trim() ? parsed.endpoint : DEFAULT_LLM_CONFIG.endpoint,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      model: typeof parsed.model === "string" && parsed.model.trim() ? parsed.model : DEFAULT_LLM_CONFIG.model
    };
  } catch {
    return DEFAULT_LLM_CONFIG;
  }
}

export function saveLlmConfig(config: LlmConfig) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(LLM_CONFIG_STORAGE_KEY, JSON.stringify(config));
}

function isProviderId(value: unknown): value is LlmProviderId {
  return typeof value === "string" && LLM_PROVIDER_PRESETS.some((provider) => provider.id === value);
}
