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

type OpenAIResponseShape = {
  model?: string;
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
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

export async function evaluateBoardWithOpenAI(boardId: string, apiKey: string, model: string): Promise<BoardEvaluationResult | null> {
  const board = await getBoard(boardId);
  if (!board) {
    return null;
  }

  const previewDataUrl = await getBoardPreviewDataUrl(board.meta.id);
  const requestBody = {
    model,
    instructions:
      "You are a senior system design interviewer. Evaluate the provided system design board using the supplied rubric. Be concrete, fair, and technically rigorous. Score each rubric item from 0 to its maxScore. Reward clear structure, tradeoff discussion, scalability thinking, and operational realism. Do not invent components that are not present on the board.",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildEvaluationInput(board)
          },
          ...(previewDataUrl
            ? [
                {
                  type: "input_image" as const,
                  image_url: previewDataUrl,
                  detail: "high" as const
                }
              ]
            : [])
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "system_design_board_evaluation",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["summary", "totalScore", "maxScore", "rubric", "strengths", "gaps", "recommendations"],
          properties: {
            summary: { type: "string" },
            totalScore: { type: "number" },
            maxScore: { type: "number" },
            rubric: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["criterionId", "title", "score", "maxScore", "justification"],
                properties: {
                  criterionId: { type: "string" },
                  title: { type: "string" },
                  score: { type: "number" },
                  maxScore: { type: "number" },
                  justification: { type: "string" }
                }
              }
            },
            strengths: {
              type: "array",
              items: { type: "string" }
            },
            gaps: {
              type: "array",
              items: { type: "string" }
            },
            recommendations: {
              type: "array",
              items: { type: "string" }
            }
          }
        }
      }
    }
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    throw new Error(await readOpenAIError(response));
  }

  const raw = (await response.json()) as OpenAIResponseShape;
  const outputText = getOutputText(raw);
  if (!outputText) {
    throw new Error("OpenAI evaluation returned no text output.");
  }

  return normalizeEvaluationResult(raw.model ?? model, JSON.parse(outputText) as Partial<BoardEvaluationResult>);
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
  return text || `OpenAI request failed with ${response.status}`;
}

function getOutputText(response: OpenAIResponseShape) {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  for (const item of response.output ?? []) {
    if (item.type !== "message") {
      continue;
    }

    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string" && content.text.trim()) {
        return content.text;
      }
    }
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
