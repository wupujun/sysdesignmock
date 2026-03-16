import { readFile } from "node:fs/promises";
import { createBoard, getBoard, previewDiskPath, saveBoard, type BoardMeta, type BoardRecord, type SceneData } from "./storage.js";

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

type ImprovementSpec = {
  title: string;
  summary: string;
  nodes: Array<{
    id: string;
    label: string;
    kind: string;
  }>;
  edges: Array<{
    from: string;
    to: string;
    label?: string;
  }>;
  annotations: string[];
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

export async function generateImprovedBoardDraft(
  boardId: string,
  config: EvaluationConfig,
  evaluation: BoardEvaluationResult
): Promise<BoardMeta | null> {
  const board = await getBoard(boardId);
  if (!board) {
    return null;
  }

  const previewDataUrl = await getBoardPreviewDataUrl(board.meta.id);
  const requestBody = {
    model: config.model,
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content:
          "You are a systems design coach improving a whiteboard. Return only valid JSON. Propose a cleaner improved system design using a compact graph spec with nodes, edges, annotations, title, and summary. Keep the design realistic and aligned to the original board plus feedback."
      },
      {
        role: "user",
        content: buildImprovementContent(board, evaluation, previewDataUrl, config.providerId)
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
    throw new Error("LLM improvement generation returned no text output.");
  }

  const spec = parseImprovementSpec(outputText);
  const scene = buildSceneFromImprovementSpec(spec);
  const draft = await createBoard(`${board.meta.title} (Improved Draft)`);
  const saved = await saveBoard(draft.meta.id, spec.title || draft.meta.title, scene);
  return saved?.meta ?? draft.meta;
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

function buildImprovementContent(
  board: BoardRecord,
  evaluation: BoardEvaluationResult,
  previewDataUrl: string | null,
  providerId: string
) {
  const prompt = [
    buildEvaluationInput(board),
    "",
    "Evaluation summary:",
    evaluation.summary,
    "",
    "Strengths:",
    ...evaluation.strengths.map((item) => `- ${item}`),
    "",
    "Gaps:",
    ...evaluation.gaps.map((item) => `- ${item}`),
    "",
    "Recommendations:",
    ...evaluation.recommendations.map((item) => `- ${item}`),
    "",
    "Return JSON with exactly these keys:",
    "title, summary, nodes, edges, annotations",
    "",
    "Node shape:",
    '{"id":"string","label":"string","kind":"service|database|cache|queue|client|external|worker|storage"}',
    "Edge shape:",
    '{"from":"nodeId","to":"nodeId","label":"optional string"}',
    "annotations: string[] with up to 5 concise notes"
  ].join("\n");

  if (!previewDataUrl || !supportsImageInput(providerId)) {
    return prompt;
  }

  return [
    { type: "text", text: prompt },
    { type: "image_url", image_url: { url: previewDataUrl } }
  ];
}

function parseImprovementSpec(value: string): ImprovementSpec {
  const parsed = parseJsonObject(value) as Partial<ImprovementSpec>;
  const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
  const edges = Array.isArray(parsed.edges) ? parsed.edges : [];
  const annotations = Array.isArray(parsed.annotations) ? parsed.annotations : [];

  return {
    title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : "Improved System Design Draft",
    summary: typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : "Improved board draft",
    nodes: nodes
      .filter((node): node is { id: string; label: string; kind: string } => {
        return !!node && typeof node === "object" && typeof node.id === "string" && typeof node.label === "string";
      })
      .slice(0, 12)
      .map((node) => ({
        id: node.id.trim(),
        label: node.label.trim(),
        kind: typeof node.kind === "string" && node.kind.trim() ? node.kind.trim() : "service"
      }))
      .filter((node) => node.id && node.label),
    edges: edges
      .filter((edge): edge is { from: string; to: string; label?: string } => {
        return !!edge && typeof edge === "object" && typeof edge.from === "string" && typeof edge.to === "string";
      })
      .slice(0, 20)
      .map((edge) => ({
        from: edge.from.trim(),
        to: edge.to.trim(),
        label: typeof edge.label === "string" ? edge.label.trim() : ""
      }))
      .filter((edge) => edge.from && edge.to),
    annotations: annotations
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 5)
  };
}

function buildSceneFromImprovementSpec(spec: ImprovementSpec): SceneData {
  const elements: unknown[] = [];
  const nodeLayout = new Map<string, { x: number; y: number; width: number; height: number }>();
  const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(spec.nodes.length || 1))));
  const width = 220;
  const height = 100;
  const xGap = 120;
  const yGap = 120;

  spec.nodes.forEach((node, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = column * (width + xGap);
    const y = row * (height + yGap);
    nodeLayout.set(node.id, { x, y, width, height });
    elements.push(createRectangleElement(node.id, x, y, width, height, getNodeStyle(node.kind)));
    elements.push(createTextElement(`${node.id}_label`, node.label, x + 20, y + 32, 28));
  });

  spec.edges.forEach((edge, index) => {
    const from = nodeLayout.get(edge.from);
    const to = nodeLayout.get(edge.to);
    if (!from || !to) {
      return;
    }

    const arrowId = `edge_${index}_${edge.from}_${edge.to}`;
    const startX = from.x + from.width;
    const startY = from.y + from.height / 2;
    const endX = to.x;
    const endY = to.y + to.height / 2;
    elements.push(createArrowElement(arrowId, startX, startY, endX - startX, endY - startY));
    if (edge.label) {
      elements.push(createTextElement(`${arrowId}_label`, edge.label, startX + (endX - startX) / 2 - 40, startY + (endY - startY) / 2 - 28, 22));
    }
  });

  spec.annotations.forEach((annotation, index) => {
    const baseY = Math.ceil(spec.nodes.length / columns) * (height + yGap) + 40;
    elements.push(createTextElement(`annotation_${index}`, `• ${annotation}`, 0, baseY + index * 34, 24, "#8f291c"));
  });

  return {
    type: "excalidraw",
    version: 2,
    source: "local-whiteboard-app",
    elements,
    appState: {
      viewBackgroundColor: "#ffffff",
      gridSize: null,
      zoom: { value: 1 }
    },
    files: {}
  };
}

function createRectangleElement(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  style: { strokeColor: string; backgroundColor: string }
) {
  return {
    id,
    type: "rectangle",
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: style.strokeColor,
    backgroundColor: style.backgroundColor,
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: { type: 3 },
    seed: hashSeed(id),
    version: 1,
    versionNonce: hashSeed(`${id}_nonce`),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false
  };
}

function createTextElement(id: string, text: string, x: number, y: number, height: number, strokeColor = "#18392b") {
  return {
    id,
    type: "text",
    x,
    y,
    width: Math.max(80, Math.min(220, text.length * 7)),
    height,
    angle: 0,
    strokeColor,
    backgroundColor: "transparent",
    fillStyle: "hachure",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: hashSeed(id),
    version: 1,
    versionNonce: hashSeed(`${id}_nonce`),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    text,
    fontSize: 20,
    fontFamily: 1,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: null,
    originalText: text,
    lineHeight: 1.25,
    baseline: 18
  };
}

function createArrowElement(id: string, x: number, y: number, dx: number, dy: number) {
  return {
    id,
    type: "arrow",
    x,
    y,
    width: dx,
    height: dy,
    angle: 0,
    strokeColor: "#3c5a4d",
    backgroundColor: "transparent",
    fillStyle: "hachure",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: { type: 2 },
    seed: hashSeed(id),
    version: 1,
    versionNonce: hashSeed(`${id}_nonce`),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    points: [[0, 0], [dx, dy]],
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: "triangle"
  };
}

function getNodeStyle(kind: string) {
  switch (kind) {
    case "database":
      return { strokeColor: "#295a88", backgroundColor: "#dcecff" };
    case "cache":
      return { strokeColor: "#8a6a13", backgroundColor: "#fff2c7" };
    case "queue":
      return { strokeColor: "#7f3d8f", backgroundColor: "#f4e4fb" };
    case "client":
      return { strokeColor: "#1d6d4f", backgroundColor: "#dff7eb" };
    case "external":
      return { strokeColor: "#8f291c", backgroundColor: "#fde6e2" };
    case "worker":
      return { strokeColor: "#4a4a8f", backgroundColor: "#e9e9ff" };
    case "storage":
      return { strokeColor: "#475569", backgroundColor: "#e2e8f0" };
    default:
      return { strokeColor: "#18392b", backgroundColor: "#e7f0ec" };
  }
}

function hashSeed(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) || 1;
}

function parseJsonObject(value: string) {
  const trimmed = value.trim();

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const match = trimmed.match(/```json\s*([\s\S]*?)```/i) ?? trimmed.match(/(\{[\s\S]*\})/);
    if (!match?.[1]) {
      throw new Error("LLM generation returned invalid JSON.");
    }
    return JSON.parse(match[1]) as Record<string, unknown>;
  }
}
