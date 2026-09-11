import test from "node:test";
import assert from "node:assert/strict";

import {
  CODEX_RESET_CREDIT_CONSUME_URL,
  CODEX_RESET_CREDITS_URL,
  CodexResetCreditError,
  listCodexResetCredits,
  redeemCodexResetCredit,
} from "../../open-sse/services/codexResetCredits.ts";

const context = { accessToken: "codex-oauth-token", workspaceId: "workspace-123" };

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

test("listCodexResetCredits parses aliases, filters unavailable credits and sorts expiry", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const future = new Date(Date.now() + 86_400_000);
  const later = new Date(Date.now() + 172_800_000);
  const expired = new Date(Date.now() - 1_000);
  const fetchImpl = (async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return jsonResponse({
      available_count: 3,
      reset_credits: [
        {
          creditId: "later-credit",
          expiresAt: later.toISOString(),
          resetType: "weekly",
          title: "Weekly reset",
        },
        {
          credit_id: "first-credit",
          expires_at: future.toISOString(),
          granted_at: future.toISOString(),
          status: "available",
          description: "Restores the exhausted limit.",
        },
        { id: "consumed-credit", status: "consumed" },
        { id: "expired-credit", expires_at: expired.toISOString() },
        { id: "no-expiry-credit" },
      ],
    });
  }) as typeof fetch;

  const result = await listCodexResetCredits(context, fetchImpl);
  const headers = new Headers(capturedInit?.headers);

  assert.equal(capturedUrl, CODEX_RESET_CREDITS_URL);
  assert.equal(capturedInit?.method, "GET");
  assert.equal(headers.get("authorization"), "Bearer codex-oauth-token");
  assert.equal(headers.get("chatgpt-account-id"), "workspace-123");
  assert.equal(headers.get("originator"), "codex_cli_rs");
  assert.match(headers.get("user-agent") || "", /^codex-cli\//);
  assert.ok(headers.get("version"));
  assert.equal(result.availableCount, 3);
  assert.deepEqual(
    result.credits.map((credit) => credit.selectionToken),
    ["first-credit", "later-credit", "no-expiry-credit"]
  );
  assert.equal(result.credits[0]?.description, "Restores the exhausted limit.");
  assert.equal(result.credits[1]?.title, "Weekly reset");
});

test("redeemCodexResetCredit sends exact consume body with stable request ID", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const fetchImpl = (async (input, init) => {
    const url = String(input);
    if (url === CODEX_RESET_CREDITS_URL) {
      return jsonResponse({ credits: [{ credit_id: "opaque-credit-id" }] });
    }
    capturedUrl = url;
    capturedInit = init;
    return jsonResponse({ outcome: "already_redeemed" });
  }) as typeof fetch;

  const outcome = await redeemCodexResetCredit(
    context,
    "opaque-credit-id",
    "stable-request-id",
    fetchImpl
  );

  assert.equal(outcome, "alreadyRedeemed");
  assert.equal(capturedUrl, CODEX_RESET_CREDIT_CONSUME_URL);
  assert.equal(capturedInit?.method, "POST");
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
    redeem_request_id: "stable-request-id",
    credit_id: "opaque-credit-id",
  });
});

test("redeemCodexResetCredit maps known conflicts and rejects unknown outcomes", async () => {
  await assert.rejects(
    () =>
      redeemCodexResetCredit(context, "credit", "request", (async (input) =>
        String(input) === CODEX_RESET_CREDITS_URL
          ? jsonResponse({ credits: [{ credit_id: "credit" }] })
          : jsonResponse({ code: "no_credits" }, 409)) as typeof fetch),
    (error: unknown) =>
      error instanceof CodexResetCreditError && error.status === 409 && error.code === "no_credit"
  );

  await assert.rejects(
    () =>
      redeemCodexResetCredit(context, "credit", "request", (async (input) =>
        String(input) === CODEX_RESET_CREDITS_URL
          ? jsonResponse({ credits: [{ credit_id: "credit" }] })
          : jsonResponse({ result: "nothing_to_reset" })) as typeof fetch),
    (error: unknown) =>
      error instanceof CodexResetCreditError &&
      error.status === 409 &&
      error.code === "nothing_to_reset"
  );

  await assert.rejects(
    () =>
      redeemCodexResetCredit(context, "credit", "request", (async (input) =>
        String(input) === CODEX_RESET_CREDITS_URL
          ? jsonResponse({ credits: [{ credit_id: "credit" }] })
          : jsonResponse({ outcome: "unexpected" })) as typeof fetch),
    (error: unknown) =>
      error instanceof CodexResetCreditError &&
      error.status === 502 &&
      error.code === "unknown_reset_credit_response"
  );
});

test("redeemCodexResetCredit rejects a stale selection before consume", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      redeemCodexResetCredit(context, "stale-credit", "request", (async () => {
        calls += 1;
        return jsonResponse({ credits: [{ credit_id: "different-credit" }] });
      }) as typeof fetch),
    (error: unknown) =>
      error instanceof CodexResetCreditError &&
      error.status === 409 &&
      error.code === "selected_credit_unavailable"
  );
  assert.equal(calls, 1);
});
