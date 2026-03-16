import { readFile } from "node:fs/promises";
import { getBoard, previewDiskPath, type BoardRecord } from "./storage.js";

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

export type EvaluationConfig = {
  providerId: string;
  endpoint: string;
  apiKey: string;
  model: string;
};

export type LlmValidationResult = {
  ok: true;
  model: string;
  providerId: string;
  endpoint: string;
};

type ChatCompletionsResponseShape = {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | Array<{
        type?: string;
        text?: string;
      }>;
    };
  }>;
};

const RUBRIC = [
  { criterionId: "requirements", title: "Requirements Clarity", maxScore: 5 },
  { criterionId: "architecture", title: "Architecture Decomposition", maxScore: 5 },
  { criterionId: "data_flow", title: "Data Flow And Storage", maxScore: 5 },
  { criterionId: "scalability", title: "Scalability And Reliability", maxScore: 5 },
  { criterionId: "tradeoffs", title: "Tradeoffs And Reasoning", maxScore: 5 },
  { criterionId: "security_ops", title: "Security And Operations", maxScore: 5 }
] as const;

export async function evaluateBoardWithOpenAI(
  boardId: string,
  config: EvaluationConfig
): Promise<BoardEvaluationResult | null> {
  const { providerId, endpoint, apiKey, model } = config;
  const board = await getBoard(boardId);
  if (!board) {
    return null;
  }

  const previewDataUrl = await getBoardPreviewDataUrl(board.meta.id);
  const requestBody = {
    model,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "You are a senior system design interviewer. Evaluate the provided system design board using the supplied rubric. Be concrete, fair, and technically rigorous. Score each rubric item from 0 to its maxScore. Reward clear structure, tradeoff discussion, scalability thinking, and operational realism. Do not invent components that are not present on the board. Return only valid JSON."
      },
      {
        role: "user",
        content: buildUserContent(buildEvaluationInput(board), previewDataUrl, providerId)
      }
    ]
  };

  const response = await postChatCompletion(config, requestBody);

  if (!response.ok) {
    throw new Error(await readOpenAIError(response));
  }

  const raw = (await response.json()) as ChatCompletionsResponseShape;
  const outputText = getOutputText(raw);
  if (!outputText) {
    throw new Error("LLM evaluation returned no text output.");
  }

  return normalizeEvaluationResult(raw.model ?? model, parseEvaluationJson(outputText));
}

export async function validateLlmConfig(config: EvaluationConfig): Promise<LlmValidationResult> {
  const requestBody = {
    model: config.model,
    temperature: 0,
    max_tokens: 16,
    messages: [
      {
        role: "system",
        content: "Reply with exactly OK."
      },
      {
        role: "user",
        content: "Connection test"
      }
    ]
  };

  const response = await postChatCompletion(config, requestBody);

  if (!response.ok) {
    throw new Error(await readOpenAIError(response));
  }

  const raw = (await response.json()) as ChatCompletionsResponseShape;
  return {
    ok: true,
    model: raw.model ?? config.model,
    providerId: config.providerId,
    endpoint: config.endpoint
  };
}

export function buildEvaluationInput(board: BoardRecord) {
  const elements = Array.isArray(board.scene.elements) ? board.scene.elements : [];
  const typeCounts = new Map<string, number>();
  const textLabels: string[] = [];

  for (const element of elements) {
    if (!element || typeof element !== "object") {
      continue;
    }

    const record = element as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : "unknown";
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);

    const text = typeof record.text === "string" ? record.text.trim() : "";
    if (text) {
      textLabels.push(text.replace(/\s+/g, " "));
    }
  }

  const sortedCounts = [...typeCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([type, count]) => `${type}: ${count}`)
    .join(", ");

  const textPreview = textLabels.slice(0, 25).map((value, index) => `${index + 1}. ${value}`).join("\n");

  return [
    `Board title: ${board.meta.title}`,
    `Board id: ${board.meta.id}`,
    `Updated at: ${board.meta.updatedAt}`,
    `Element count: ${elements.length}`,
    `Element types: ${sortedCounts || "none"}`,
    "",
    "Visible text snippets from the diagram:",
    textPreview || "None",
    "",
    "Evaluate this board like an interview artifact. Focus on what is actually present on the board."
  ].join("\n");
}

function normalizeEvaluationResult(model: string, raw: Partial<BoardEvaluationResult>): BoardEvaluationResult {
  const rubric = RUBRIC.map((criterion) => {
    const match = raw.rubric?.find((item) => item.criterionId === criterion.criterionId || item.title === criterion.title);
    return {
      criterionId: criterion.criterionId,
      title: criterion.title,
      maxScore: criterion.maxScore,
      score: clampScore(match?.score, criterion.maxScore),
      justification: typeof match?.justification === "string" && match.justification.trim()
        ? match.justification.trim()
        : "No justification returned."
    };
  });

  const maxScore = RUBRIC.reduce((sum, criterion) => sum + criterion.maxScore, 0);
  const totalScore = rubric.reduce((sum, criterion) => sum + criterion.score, 0);

  return {
    model,
    summary: typeof raw.summary === "string" && raw.summary.trim() ? raw.summary.trim() : "No summary returned.",
    totalScore,
    maxScore,
    rubric,
    strengths: sanitizeStringList(raw.strengths),
    gaps: sanitizeStringList(raw.gaps),
    recommendations: sanitizeStringList(raw.recommendations)
  };
}

async function getBoardPreviewDataUrl(boardId: string) {
  try {
    const file = await readFile(previewDiskPath(boardId));
    return `data:image/png;base64,${file.toString("base64")}`;
  } catch {
    return null;
  }
}

async function readOpenAIError(response: Response) {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    if (parsed.error?.message) {
      return parsed.error.message;
    }
  } catch {
    // Fall through to raw text.
  }
  return text || `LLM request failed with ${response.status}`;
}

function getOutputText(response: ChatCompletionsResponseShape) {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text?.trim() ?? "")
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function sanitizeStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function clampScore(score: unknown, maxScore: number) {
  if (typeof score !== "number" || Number.isNaN(score)) {
    return 0;
  }

  return Math.max(0, Math.min(maxScore, Math.round(score * 10) / 10));
}

function normalizeChatCompletionsEndpoint(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");

  if (!trimmed) {
    throw new Error("Evaluation endpoint is required.");
  }

  try {
    const url = new URL(trimmed);
    if (url.pathname.endsWith("/chat/completions")) {
      return url.toString();
    }

    url.pathname = `${url.pathname.replace(/\/+$/, "")}/chat/completions`;
    return url.toString();
  } catch {
    throw new Error("Evaluation endpoint must be a valid URL.");
  }
}

function parseEvaluationJson(value: string): Partial<BoardEvaluationResult> {
  const trimmed = value.trim();

  try {
    return JSON.parse(trimmed) as Partial<BoardEvaluationResult>;
  } catch {
    const match = trimmed.match(/```json\s*([\s\S]*?)```/i) ?? trimmed.match(/(\{[\s\S]*\})/);
    if (!match?.[1]) {
      throw new Error("LLM evaluation returned invalid JSON.");
    }
    return JSON.parse(match[1]) as Partial<BoardEvaluationResult>;
  }
}

function buildUserContent(summary: string, previewDataUrl: string | null, providerId: string) {
  const prompt = [
    summary,
    "",
    "Return JSON with exactly these keys:",
    "summary, totalScore, maxScore, rubric, strengths, gaps, recommendations",
    "",
    "Rubric items must use these criterion ids and max scores:",
    JSON.stringify(RUBRIC)
  ].join("\n");

  if (!previewDataUrl || !supportsImageInput(providerId)) {
    return prompt;
  }

  return [
    { type: "text", text: prompt },
    { type: "image_url", image_url: { url: previewDataUrl } }
  ];
}

function supportsImageInput(providerId: string) {
  return providerId === "openai" || providerId === "claude" || providerId === "gemini";
}

function postChatCompletion(config: EvaluationConfig, requestBody: Record<string, unknown>) {
  return fetch(normalizeChatCompletionsEndpoint(config.endpoint), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });
}
