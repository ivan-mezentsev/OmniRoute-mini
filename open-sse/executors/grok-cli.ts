import { PROVIDERS } from "../config/constants.ts";
import {
  getGrokBuildSessionHeaders,
  GROK_BUILD_DEFAULT_REASONING_EFFORT,
  GROK_BUILD_REASONING_INCLUDE,
  GROK_BUILD_RESPONSES_URL,
  GROK_BUILD_SUPPORTED_REASONING_EFFORTS,
} from "../config/grokBuild.ts";
import { refreshGrokCliCredentials } from "../services/grokCliTokenRefresh.ts";
import { BaseExecutor, type ExecutorLog, type ProviderCredentials } from "./base.ts";

const GROK_BUILD_MAX_TOOLS = 200;
const GROK_BUILD_REASONING_EFFORT_SET = new Set(GROK_BUILD_SUPPORTED_REASONING_EFFORTS);
const GROK_BUILD_UNSUPPORTED_PARAMS = [
  "presencePenalty",
  "frequencyPenalty",
  "logprobs",
  "topLogprobs",
  "presence_penalty",
  "frequency_penalty",
  "top_logprobs",
  "reasoning_effort",
];

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sanitizeFunctionCallOutput(output: unknown): string {
  if (output == null) return "";
  if (typeof output === "string") {
    try {
      return JSON.stringify(JSON.parse(output));
    } catch {
      return output
        .replace(/\\u([0-9A-Fa-f]{0,3})(?![0-9A-Fa-f])/g, "")
        .replace(/[\uD800-\uDFFF]/g, "\uFFFD");
    }
  }
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

export class GrokCliExecutor extends BaseExecutor {
  constructor() {
    super("grok-cli", PROVIDERS["grok-cli"]);
  }

  buildUrl() {
    return GROK_BUILD_RESPONSES_URL;
  }

  refreshCredentials(credentials: ProviderCredentials, log?: ExecutorLog | null) {
    return refreshGrokCliCredentials(credentials, log);
  }

  buildHeaders(
    credentials: ProviderCredentials,
    stream = true,
    clientHeaders?: Record<string, string> | null,
    model?: string
  ) {
    const headers = super.buildHeaders(credentials, stream, clientHeaders, model);
    const providerData = credentials.providerSpecificData || {};
    const sessionHeaders = getGrokBuildSessionHeaders({
      model,
      stream,
      userId: nonEmptyString(providerData.userId),
      email: nonEmptyString(providerData.email),
      principalType: nonEmptyString(providerData.principalType),
    });

    return { ...headers, ...sessionHeaders };
  }

  transformRequest(
    model: string,
    body: unknown,
    stream: boolean,
    credentials: ProviderCredentials
  ) {
    const base = super.transformRequest(model, body, stream, credentials);
    const transformed =
      base && typeof base === "object" && !Array.isArray(base)
        ? { ...(base as Record<string, unknown>) }
        : {};

    transformed.model = model || transformed.model || "grok-composer-2.5-fast";
    transformed.stream = !!stream;
    if (transformed.store === undefined) transformed.store = false;
    const include = Array.isArray(transformed.include) ? [...transformed.include] : [];
    if (!include.includes(GROK_BUILD_REASONING_INCLUDE)) include.push(GROK_BUILD_REASONING_INCLUDE);
    transformed.include = include;

    const legacyReasoningEffort = nonEmptyString(transformed.reasoning_effort);

    for (const param of GROK_BUILD_UNSUPPORTED_PARAMS) delete transformed[param];

    const reasoning =
      transformed.reasoning && typeof transformed.reasoning === "object"
        ? { ...(transformed.reasoning as Record<string, unknown>) }
        : {};
    if (reasoning.effort === undefined && legacyReasoningEffort) {
      reasoning.effort = legacyReasoningEffort;
    }
    if (!GROK_BUILD_REASONING_EFFORT_SET.has(String(reasoning.effort))) delete reasoning.effort;
    if (model === "grok-composer-2.5-fast") delete reasoning.effort;
    else if (model === "grok-4.5" && reasoning.effort === undefined) {
      reasoning.effort = GROK_BUILD_DEFAULT_REASONING_EFFORT;
    }
    if (Object.keys(reasoning).length) transformed.reasoning = reasoning;
    else delete transformed.reasoning;

    if (Array.isArray(transformed.tools) && transformed.tools.length > GROK_BUILD_MAX_TOOLS) {
      transformed.tools = transformed.tools.slice(0, GROK_BUILD_MAX_TOOLS);
    }

    if (Array.isArray(transformed.input)) {
      transformed.input = transformed.input.map((item) => {
        if (!item || typeof item !== "object") return item;
        const record = item as Record<string, unknown>;
        if (record.type !== "function_call_output") return item;
        return { ...record, output: sanitizeFunctionCallOutput(record.output) };
      });
    }

    return transformed;
  }
}
