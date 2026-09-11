import test from "node:test";
import assert from "node:assert/strict";

import { getGrokBuildClientVersion } from "../../open-sse/config/grokBuild.ts";
import {
  getModelTargetFormat,
  getProviderModels,
  supportsXHighEffort,
} from "../../open-sse/config/providerModels.ts";
import { GrokCliExecutor } from "../../open-sse/executors/grok-cli.ts";
import { grokCli } from "../../src/lib/oauth/providers/grok-cli.ts";
import { resolvePublicCred } from "../../open-sse/utils/publicCreds.ts";
import { oauthImportTokenSchema } from "../../src/shared/validation/schemas.ts";

test("Grok Build is registered with Responses models and current client fingerprint", () => {
  assert.deepEqual(
    getProviderModels("gc").map((model) => model.id),
    ["grok-4.6", "grok-4.5", "grok-composer-2.5-fast"]
  );
  assert.equal(getModelTargetFormat("gc", "grok-4.5"), "openai-responses");
  assert.equal(
    getProviderModels("gc").find((model) => model.id === "grok-4.5")?.supportsXHighEffort,
    true
  );
  assert.equal(supportsXHighEffort("gc", "grok-4.5"), true);
  assert.equal(supportsXHighEffort("gc", "grok-composer-2.5-fast"), false);
  assert.equal(getGrokBuildClientVersion(), "0.2.106");
  assert.ok(resolvePublicCred("grok_id"));
});

test("Grok Build executor uses Responses URL, session fingerprints and request normalization", () => {
  const executor = new GrokCliExecutor();
  assert.equal(executor.buildUrl(), "https://cli-chat-proxy.grok.com/v1/responses");
  const headers = executor.buildHeaders(
    {
      accessToken: "token",
      providerSpecificData: { userId: "user-1", email: "user@example.com" },
    },
    true,
    null,
    "grok-4.5"
  );
  assert.equal(headers.Authorization, "Bearer token");
  assert.equal(headers["x-grok-client-identifier"], "grok-shell");
  assert.equal(headers["x-grok-client-version"], "0.2.106");
  assert.equal(headers["x-grok-model-override"], "grok-4.5");
  assert.equal(headers["x-userid"], "user-1");
  assert.equal(headers["x-email"], "user@example.com");

  const body = executor.transformRequest(
    "grok-4.5",
    { reasoning_effort: "xhigh", tools: Array.from({ length: 205 }, (_, id) => ({ id })) },
    true,
    {}
  ) as Record<string, unknown>;
  assert.equal(body.reasoning_effort, undefined);
  assert.deepEqual(body.reasoning, { effort: "xhigh" });
  assert.equal((body.tools as unknown[]).length, 200);
  assert.deepEqual(body.include, ["reasoning.encrypted_content"]);
  assert.equal(body.store, false);
});

test("Grok Build OAuth maps official device-flow tokens with refresh credentials", () => {
  assert.equal(grokCli.flowType, "device_code");
  assert.equal(grokCli.config.clientId, resolvePublicCred("grok_id", "GROK_OAUTH_CLIENT_ID"));
  const payload = Buffer.from(
    JSON.stringify({ sub: "user-1", email: "user@example.com", exp: 4102444800 })
  ).toString("base64url");
  const jwt = `eyJhbGciOiJub25lIn0.${payload}.signature`;
  const mapped = grokCli.mapTokens({
    access_token: jwt,
    refresh_token: "refresh-token",
  });
  assert.equal(mapped.accessToken, jwt);
  assert.equal(mapped.refreshToken, "refresh-token");
  assert.equal(mapped.email, "user@example.com");
  assert.equal(mapped.providerSpecificData.userId, "user-1");
  assert.equal(oauthImportTokenSchema.safeParse({ token: { accessToken: {} } }).success, false);
});

test("Grok Build starts the official browser device flow without a local CLI", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), "https://auth.x.ai/oauth2/device/code");
    assert.equal(new Headers(init?.headers).get("x-grok-client-version"), "0.2.106");
    return new Response(
      JSON.stringify({
        device_code: "device-code",
        user_code: "GROK-CODE",
        verification_uri: "https://accounts.x.ai/activate",
        expires_in: 600,
        interval: 5,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  const result = await grokCli.requestDeviceCode();
  assert.equal(result.device_code, "device-code");
  assert.equal(result.verification_uri, "https://accounts.x.ai/activate");
});

test("Grok Build refresh preserves rotated refresh tokens and principal metadata", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let requestBody = "";
  let requestHeaders: HeadersInit | undefined;
  globalThis.fetch = (async (_input, init) => {
    requestBody = String(init?.body);
    requestHeaders = init?.headers;
    return new Response(
      JSON.stringify({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 900,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  const refreshed = await new GrokCliExecutor().refreshCredentials({
    refreshToken: "old-refresh",
    providerSpecificData: { principalType: "Team", principalId: "team-1" },
  });
  const form = new URLSearchParams(requestBody);
  const headers = new Headers(requestHeaders);
  assert.equal(form.get("principal_type"), "Team");
  assert.equal(form.get("principal_id"), "team-1");
  assert.equal(headers.get("x-grok-client-version"), "0.2.106");
  assert.equal(headers.get("x-grok-client-surface"), "ui");
  assert.equal(refreshed?.accessToken, "new-access");
  assert.equal(refreshed?.refreshToken, "new-refresh");
});
