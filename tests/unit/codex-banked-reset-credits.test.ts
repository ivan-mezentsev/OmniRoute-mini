import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-codex-usage-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.STORAGE_ENCRYPTION_KEY = "codex-usage-test-key-32-bytes-minimum";
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

const { fetchCodexQuota, invalidateCodexQuotaCache } =
  await import("../../open-sse/services/codexQuotaFetcher.ts");
const { getUsageForProvider } = await import("../../open-sse/services/usage.ts");

const originalFetch = globalThis.fetch;

function usagePayload(resetCredits: unknown): Record<string, unknown> {
  return {
    plan_type: "plus",
    rate_limit: {
      limit_reached: false,
      primary_window: { used_percent: 25, reset_after_seconds: 3600 },
      secondary_window: { used_percent: 50, reset_after_seconds: 604800 },
    },
    ...((resetCredits as Record<string, unknown>) || {}),
  };
}

async function directUsage(payload: Record<string, unknown>) {
  globalThis.fetch = (async () => Response.json(payload)) as typeof fetch;
  return (await getUsageForProvider({
    id: "codex-usage-test",
    provider: "codex",
    accessToken: "oauth-token",
    providerSpecificData: { workspaceId: "workspace-123" },
  })) as Record<string, unknown>;
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  invalidateCodexQuotaCache("codex-quota-test");
});

test.after(() => {
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("Codex usage exposes snake_case banked reset-credit count including zero", async () => {
  const usage = await directUsage(
    usagePayload({ rate_limit_reset_credits: { available_count: 0 } })
  );
  assert.equal(usage.bankedResetCredits, 0);
});

test("Codex usage exposes camelCase banked reset-credit count", async () => {
  const usage = await directUsage(usagePayload({ rateLimitResetCredits: { availableCount: 2 } }));
  assert.equal(usage.bankedResetCredits, 2);
});

test("Codex usage omits absent or invalid banked reset-credit counts", async () => {
  const absent = await directUsage(usagePayload({}));
  const invalid = await directUsage(
    usagePayload({ rate_limit_reset_credits: { available_count: "not-a-number" } })
  );
  assert.equal("bankedResetCredits" in absent, false);
  assert.equal("bankedResetCredits" in invalid, false);
});

test("Codex preflight quota carries camelCase banked reset-credit count", async () => {
  globalThis.fetch = (async () =>
    Response.json(usagePayload({ rateLimitResetCredits: { availableCount: 3 } }))) as typeof fetch;

  const quota = await fetchCodexQuota("codex-quota-test", {
    accessToken: "oauth-token",
    providerSpecificData: { workspaceId: "workspace-123" },
  });

  assert.equal(quota?.bankedResetCredits, 3);
});
