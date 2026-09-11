export const ANTIGRAVITY_PUBLIC_MODELS = Object.freeze([
  // Gemini 3.8 Flash
  {
    id: "gemini-3.8-flash-high",
    name: "Gemini 3.8 Flash (High)",
    contextLength: 1048576,
    maxOutputTokens: 65536,
    supportsReasoning: true,
    supportsVision: true,
    toolCalling: true,
  },
  {
    id: "gemini-3.8-flash-medium",
    name: "Gemini 3.8 Flash (Medium)",
    contextLength: 1048576,
    maxOutputTokens: 65536,
    supportsReasoning: true,
    supportsVision: true,
    toolCalling: true,
  },
  {
    id: "gemini-3.8-flash-low",
    name: "Gemini 3.8 Flash (Low)",
    contextLength: 1048576,
    maxOutputTokens: 65536,
    supportsReasoning: true,
    supportsVision: true,
    toolCalling: true,
  },
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    contextLength: 1048576,
    maxOutputTokens: 65536,
    supportsReasoning: true,
    supportsVision: true,
    toolCalling: true,
  },
  // Gemini 3.7 Flash
  {
    id: "gemini-3.7-flash-high",
    name: "Gemini 3.7 Flash (High)",
    contextLength: 1048576,
    maxOutputTokens: 65536,
    supportsReasoning: true,
    supportsVision: true,
    toolCalling: true,
  },
  {
    id: "gemini-3.7-flash-medium",
    name: "Gemini 3.7 Flash (Medium)",
    contextLength: 1048576,
    maxOutputTokens: 65536,
    supportsReasoning: true,
    supportsVision: true,
    toolCalling: true,
  },
  {
    id: "gemini-3.7-flash-low",
    name: "Gemini 3.7 Flash (Low)",
    contextLength: 1048576,
    maxOutputTokens: 65536,
    supportsReasoning: true,
    supportsVision: true,
    toolCalling: true,
  },
  // Gemini 3.6 Flash
  {
    id: "gemini-3.6-flash-high",
    name: "Gemini 3.6 Flash (High)",
    contextLength: 1048576,
    maxOutputTokens: 65536,
    supportsReasoning: true,
    supportsVision: true,
    toolCalling: true,
  },
  {
    id: "gemini-3.6-flash-medium",
    name: "Gemini 3.6 Flash (Medium)",
    contextLength: 1048576,
    maxOutputTokens: 65536,
    supportsReasoning: true,
    supportsVision: true,
    toolCalling: true,
  },
  {
    id: "gemini-3.6-flash-low",
    name: "Gemini 3.6 Flash (Low)",
    contextLength: 1048576,
    maxOutputTokens: 65536,
    supportsReasoning: true,
    supportsVision: true,
    toolCalling: true,
  },
  // Gemini 3.1 Pro
  {
    id: "gemini-pro-agent",
    name: "Gemini 3.1 Pro (High)",
    contextLength: 1048576,
    maxOutputTokens: 65535,
    supportsReasoning: true,
    supportsVision: true,
    toolCalling: true,
  },
  {
    id: "gemini-3.1-pro-low",
    name: "Gemini 3.1 Pro (Low)",
    contextLength: 1048576,
    maxOutputTokens: 65535,
    supportsReasoning: true,
    supportsVision: true,
    toolCalling: true,
  },
  // Claude (Antigravity backend). The upstream ids are accepted verbatim.
  {
    id: "claude-opus-4-6-thinking",
    name: "Claude Opus 4.6 (Thinking)",
    contextLength: 1048576,
    maxOutputTokens: 65536,
    supportsReasoning: true,
    supportsVision: true,
    toolCalling: true,
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6 (Thinking)",
    contextLength: 1048576,
    maxOutputTokens: 65536,
    supportsReasoning: true,
    supportsVision: true,
    toolCalling: true,
  },
  {
    id: "gpt-oss-120b-medium",
    name: "GPT-OSS 120B (Medium)",
    contextLength: 131072,
    maxOutputTokens: 32768,
    supportsReasoning: true,
    toolCalling: true,
  },
]);

export const ANTIGRAVITY_MODEL_ALIASES = Object.freeze({
  // Bare Flash IDs select the medium tier. Gemini 3.7 and 3.6 share tiered upstream
  // endpoints; the executor sends the selected level in generationConfig.thinkingConfig.
  "gemini-3.8-flash": "gemini-3.8-flash-medium",
  "gemini-3.7-flash": "gemini-3.7-flash-tiered",
  "gemini-3.7-flash-high": "gemini-3.7-flash-tiered",
  "gemini-3.7-flash-medium": "gemini-3.7-flash-tiered",
  "gemini-3.7-flash-low": "gemini-3.7-flash-tiered",
  "gemini-3.6-flash": "gemini-3.6-flash-tiered",
  "gemini-3.6-flash-high": "gemini-3.6-flash-tiered",
  "gemini-3.6-flash-medium": "gemini-3.6-flash-tiered",
  "gemini-3.6-flash-low": "gemini-3.6-flash-tiered",
  "gpt-oss-120b": "gpt-oss-120b-medium",
  "gemini-3.1-pro-high": "gemini-pro-agent",
});

type AntigravityModelAliasMap = Record<string, string>;
export type AntigravityThinkingLevel = "high" | "medium" | "low";

const ANTIGRAVITY_MODEL_THINKING_LEVELS: Readonly<Record<string, AntigravityThinkingLevel>> =
  Object.freeze({
    "gemini-3.8-flash": "medium",
    "gemini-3.8-flash-high": "high",
    "gemini-3.8-flash-medium": "medium",
    "gemini-3.8-flash-low": "low",
    "gemini-3.7-flash": "medium",
    "gemini-3.7-flash-high": "high",
    "gemini-3.7-flash-medium": "medium",
    "gemini-3.7-flash-low": "low",
    "gemini-3.6-flash": "medium",
    "gemini-3.6-flash-high": "high",
    "gemini-3.6-flash-medium": "medium",
    "gemini-3.6-flash-low": "low",
  });

export const ANTIGRAVITY_REVERSE_MODEL_ALIASES: AntigravityModelAliasMap = Object.freeze({});

const CLIENT_VISIBLE_MODEL_NAMES = Object.freeze(
  ANTIGRAVITY_PUBLIC_MODELS.reduce<Record<string, string>>((acc, model) => {
    acc[model.id] = model.name;
    return acc;
  }, {})
);

const PUBLIC_MODEL_IDS = new Set(ANTIGRAVITY_PUBLIC_MODELS.map((model) => model.id));
const UPSTREAM_PUBLIC_MODEL_IDS = new Set(
  ANTIGRAVITY_PUBLIC_MODELS.map((model) => resolveAntigravityModelId(model.id))
);

export function resolveAntigravityModelId(modelId: string): string {
  if (!modelId) return modelId;
  return (ANTIGRAVITY_MODEL_ALIASES as AntigravityModelAliasMap)[modelId] || modelId;
}

export function getAntigravityModelThinkingLevel(modelId: string): AntigravityThinkingLevel | null {
  if (!modelId) return null;
  const cleanModelId = modelId.includes("/") ? modelId.split("/").pop()! : modelId;
  return ANTIGRAVITY_MODEL_THINKING_LEVELS[cleanModelId] || null;
}

export function toClientAntigravityModelId(modelId: string): string {
  if (!modelId) return modelId;
  return ANTIGRAVITY_REVERSE_MODEL_ALIASES[modelId] || modelId;
}

export function getClientVisibleAntigravityModelName(
  modelId: string,
  fallbackName?: string
): string {
  return CLIENT_VISIBLE_MODEL_NAMES[modelId] || fallbackName || modelId;
}

export function isUserCallableAntigravityModelId(modelId: string): boolean {
  if (!modelId) return false;
  const clientId = toClientAntigravityModelId(modelId);
  const upstreamId = resolveAntigravityModelId(modelId);
  return PUBLIC_MODEL_IDS.has(clientId) || UPSTREAM_PUBLIC_MODEL_IDS.has(upstreamId);
}
