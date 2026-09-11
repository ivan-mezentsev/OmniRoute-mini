import test from "node:test";
import assert from "node:assert/strict";

import {
  ANTIGRAVITY_PUBLIC_MODELS,
  getClientVisibleAntigravityModelName,
  getAntigravityModelThinkingLevel,
  isUserCallableAntigravityModelId,
  resolveAntigravityModelId,
  toClientAntigravityModelId,
} from "../../open-sse/config/antigravityModelAliases.ts";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.ts";
import { openaiToAntigravityRequest } from "../../open-sse/translator/request/openai-to-gemini.ts";

function getPublicModel(id: string) {
  return ANTIGRAVITY_PUBLIC_MODELS.find((model) => model.id === id) as any;
}

const EXPECTED_PUBLIC_MODEL_IDS = [
  "gemini-3.8-flash-high",
  "gemini-3.8-flash-medium",
  "gemini-3.8-flash-low",
  "gemini-3.8-flash",
  "gemini-3.7-flash-high",
  "gemini-3.7-flash-medium",
  "gemini-3.7-flash-low",
  "gemini-3.6-flash-high",
  "gemini-3.6-flash-medium",
  "gemini-3.6-flash-low",
  "gemini-pro-agent",
  "gemini-3.1-pro-low",
  "claude-opus-4-6-thinking",
  "claude-sonnet-4-6",
  "gpt-oss-120b-medium",
] as const;

test("resolveAntigravityModelId maps current Antigravity aliases to upstream IDs", () => {
  assert.equal(resolveAntigravityModelId("gemini-3.8-flash"), "gemini-3.8-flash-medium");
  assert.equal(resolveAntigravityModelId("gemini-3.8-flash-high"), "gemini-3.8-flash-high");
  assert.equal(resolveAntigravityModelId("gemini-3.7-flash"), "gemini-3.7-flash-tiered");
  assert.equal(resolveAntigravityModelId("gemini-3.7-flash-high"), "gemini-3.7-flash-tiered");
  assert.equal(resolveAntigravityModelId("gemini-3.7-flash-medium"), "gemini-3.7-flash-tiered");
  assert.equal(resolveAntigravityModelId("gemini-3.7-flash-low"), "gemini-3.7-flash-tiered");
  assert.equal(resolveAntigravityModelId("gemini-3.6-flash"), "gemini-3.6-flash-tiered");
  assert.equal(resolveAntigravityModelId("gemini-3.6-flash-high"), "gemini-3.6-flash-tiered");
  assert.equal(resolveAntigravityModelId("gemini-3.6-flash-medium"), "gemini-3.6-flash-tiered");
  assert.equal(resolveAntigravityModelId("gemini-3.6-flash-low"), "gemini-3.6-flash-tiered");
  assert.equal(resolveAntigravityModelId("gpt-oss-120b"), "gpt-oss-120b-medium");
  assert.equal(resolveAntigravityModelId("gemini-3.1-pro-high"), "gemini-pro-agent");
  assert.equal(resolveAntigravityModelId("unknown-model"), "unknown-model");
});

test("getAntigravityModelThinkingLevel resolves current Flash tiers and bare defaults", () => {
  assert.equal(getAntigravityModelThinkingLevel("antigravity/gemini-3.8-flash"), "medium");
  assert.equal(getAntigravityModelThinkingLevel("gemini-3.8-flash-high"), "high");
  assert.equal(getAntigravityModelThinkingLevel("gemini-3.7-flash-medium"), "medium");
  assert.equal(getAntigravityModelThinkingLevel("gemini-3.6-flash-low"), "low");
  assert.equal(getAntigravityModelThinkingLevel("gemini-pro-agent"), null);
});

test("toClientAntigravityModelId preserves public upstream IDs", () => {
  assert.equal(toClientAntigravityModelId("gemini-3.8-flash"), "gemini-3.8-flash");
  assert.equal(toClientAntigravityModelId("gemini-3.7-flash-high"), "gemini-3.7-flash-high");
  assert.equal(toClientAntigravityModelId("gemini-pro-agent"), "gemini-pro-agent");
  assert.equal(toClientAntigravityModelId("gpt-oss-120b-medium"), "gpt-oss-120b-medium");
  assert.equal(toClientAntigravityModelId("claude-sonnet-4-6"), "claude-sonnet-4-6");
  assert.equal(toClientAntigravityModelId("claude-opus-4-6-thinking"), "claude-opus-4-6-thinking");
});

test("isUserCallableAntigravityModelId accepts current models and aliases", () => {
  for (const modelId of EXPECTED_PUBLIC_MODEL_IDS) {
    assert.equal(isUserCallableAntigravityModelId(modelId), true);
  }
  assert.equal(isUserCallableAntigravityModelId("gemini-3.6-flash"), true);
  assert.equal(isUserCallableAntigravityModelId("gemini-3.7-flash"), true);
  assert.equal(isUserCallableAntigravityModelId("gpt-oss-120b"), true);
  assert.equal(isUserCallableAntigravityModelId("gemini-3.1-pro-high"), true);
  assert.equal(isUserCallableAntigravityModelId("unknown-model"), false);
});

test("ANTIGRAVITY_PUBLIC_MODELS matches the current upstream catalog", () => {
  assert.deepEqual(
    ANTIGRAVITY_PUBLIC_MODELS.map((model) => model.id),
    EXPECTED_PUBLIC_MODEL_IDS
  );
  assert.deepEqual(getPublicModel("gemini-3.8-flash-high"), {
    id: "gemini-3.8-flash-high",
    name: "Gemini 3.8 Flash (High)",
    contextLength: 1048576,
    maxOutputTokens: 65536,
    supportsReasoning: true,
    supportsVision: true,
    toolCalling: true,
  });
  assert.equal(
    getClientVisibleAntigravityModelName("gemini-3.8-flash-high"),
    "Gemini 3.8 Flash (High)"
  );
  assert.equal(getPublicModel("gemini-3.6-flash-low").name, "Gemini 3.6 Flash (Low)");
  assert.equal(getPublicModel("claude-opus-4-6-thinking").contextLength, 1048576);
  assert.equal(getPublicModel("claude-sonnet-4-6").name, "Claude Sonnet 4.6 (Thinking)");
  assert.deepEqual(getPublicModel("gpt-oss-120b-medium"), {
    id: "gpt-oss-120b-medium",
    name: "GPT-OSS 120B (Medium)",
    contextLength: 131072,
    maxOutputTokens: 32768,
    supportsReasoning: true,
    toolCalling: true,
  });
});

test("ANTIGRAVITY_PUBLIC_MODELS has no duplicate model IDs", () => {
  const ids = ANTIGRAVITY_PUBLIC_MODELS.map((model) => model.id);
  const seen = new Set<string>();
  const duplicates = ids.filter((id) => {
    if (seen.has(id)) return true;
    seen.add(id);
    return false;
  });
  assert.deepEqual(duplicates, [], `duplicate model IDs found: ${duplicates.join(", ")}`);
});

test("AntigravityExecutor.transformRequest applies current Flash upstream IDs and tiers", async () => {
  const cases = [
    ["gemini-3.8-flash-high", "gemini-3.8-flash-high", "high"],
    ["gemini-3.8-flash", "gemini-3.8-flash-medium", "medium"],
    ["gemini-3.7-flash-low", "gemini-3.7-flash-tiered", "low"],
    ["gemini-3.6-flash-medium", "gemini-3.6-flash-tiered", "medium"],
  ] as const;

  for (const [modelId, upstreamModelId, thinkingLevel] of cases) {
    const executor = new AntigravityExecutor();
    const result = await executor.transformRequest(
      `antigravity/${modelId}`,
      {
        request: {
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
          generationConfig: {
            thinkingConfig: { thinkingBudget: 1024, includeThoughts: true },
          },
        },
      },
      true,
      { projectId: "project-1" }
    );

    if (result instanceof Response) throw new Error("Unexpected Response from transformRequest");
    assert.equal(result.model, upstreamModelId);
    assert.deepEqual((result.request.generationConfig as any).thinkingConfig, {
      thinkingLevel,
      includeThoughts: true,
    });
  }
});

test("AntigravityExecutor.transformRequest sends Claude through Gemini-compatible Cloud Code schema", async () => {
  const executor = new AntigravityExecutor();
  const bridged = openaiToAntigravityRequest(
    "claude-opus-4-6-thinking",
    {
      messages: [{ role: "user", content: "Hello" }],
      max_completion_tokens: 32_000,
      temperature: 0.5,
      reasoning_effort: "high",
    },
    true,
    { projectId: "project-1" } as any
  );

  const result = await executor.transformRequest(
    "antigravity/claude-opus-4-6-thinking",
    bridged,
    true,
    {
      projectId: "project-1",
    }
  );

  if (result instanceof Response) throw new Error("Unexpected Response from transformRequest");
  const request = result.request as any;
  assert.deepEqual(request.contents, [{ role: "user", parts: [{ text: "Hello" }] }]);
  assert.equal(request.generationConfig.maxOutputTokens, 32769);
  assert.equal(request.generationConfig.temperature, 0.5);
  assert.equal(request.generationConfig.topK, 40);
  assert.equal(request.generationConfig.topP, 1);
  assert.equal(request.messages, undefined);
  assert.equal(request.system, undefined);
  assert.equal(request.max_tokens, undefined);
  assert.equal(request.stream, undefined);
  assert.equal(request.temperature, undefined);
  assert.equal(request.thinking, undefined);
  assert.equal(request.generationConfig.thinkingConfig, undefined);
});
