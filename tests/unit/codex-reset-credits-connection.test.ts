import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-codex-reset-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.STORAGE_ENCRYPTION_KEY = "codex-reset-credit-test-key-32-bytes-minimum";
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

const core = await import("../../src/lib/db/core.ts");
const providers = await import("../../src/lib/db/providers.ts");
const providerLimits = await import("../../src/lib/db/providerLimits.ts");
const resetCredits = await import("../../src/lib/usage/resetCredits.ts");

const originalFetch = globalThis.fetch;

function usageResponse(count: number): Response {
  return Response.json({
    plan_type: "plus",
    rate_limit: {
      limit_reached: count > 0,
      primary_window: { used_percent: count > 0 ? 100 : 0, reset_after_seconds: 3600 },
      secondary_window: { used_percent: 40, reset_after_seconds: 604800 },
    },
    rate_limit_reset_credits: { available_count: count },
  });
}

test.after(() => {
  globalThis.fetch = originalFetch;
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("Codex reset-credit service lists, redeems and refreshes persisted quota", async () => {
  const connection = (await providers.createProviderConnection({
    provider: "codex",
    authType: "oauth",
    name: "Codex reset test",
    email: "codex-reset@example.test",
    accessToken: "codex-oauth-token",
    refreshToken: "codex-refresh-token",
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    providerSpecificData: { workspaceId: "workspace-123" },
  })) as { id: string };

  let redeemed = false;
  let consumeBody: Record<string, unknown> | null = null;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.endsWith("/rate-limit-reset-credits/consume")) {
      consumeBody = JSON.parse(String(init?.body));
      redeemed = true;
      return Response.json({ outcome: "reset" });
    }
    if (url.endsWith("/rate-limit-reset-credits")) {
      return Response.json({
        available_count: redeemed ? 0 : 1,
        credits: redeemed ? [] : [{ credit_id: "opaque-codex-credit", status: "available" }],
      });
    }
    if (url.endsWith("/wham/usage")) return usageResponse(redeemed ? 0 : 1);
    return new Response(null, { status: 404 });
  }) as typeof fetch;

  const listed = await resetCredits.listResetCredits(connection.id);
  assert.equal(listed.availableCount, 1);
  assert.equal(listed.credits[0]?.selectionToken, "opaque-codex-credit");

  const result = await resetCredits.redeemResetCredit(
    connection.id,
    "opaque-codex-credit",
    "codex-request-id"
  );
  assert.equal(result.outcome, "reset");
  assert.deepEqual(consumeBody, {
    redeem_request_id: "codex-request-id",
    credit_id: "opaque-codex-credit",
  });
  assert.equal(result.usage.bankedResetCredits, 0);
  assert.equal(providerLimits.getProviderLimitsCache(connection.id)?.bankedResetCredits, 0);
  assert.equal(
    JSON.stringify(providerLimits.getProviderLimitsCache(connection.id)).includes(
      "opaque-codex-credit"
    ),
    false
  );
});
