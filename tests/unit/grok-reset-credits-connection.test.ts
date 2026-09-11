import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-grok-reset-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.STORAGE_ENCRYPTION_KEY = "grok-reset-credit-test-key-32-bytes-minimum";
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

const core = await import("../../src/lib/db/core.ts");
const providers = await import("../../src/lib/db/providers.ts");
const providerLimits = await import("../../src/lib/db/providerLimits.ts");
const resetCredits = await import("../../src/lib/usage/resetCredits.ts");

const originalFetch = globalThis.fetch;

function encodeVarint(value: number): Buffer {
  const bytes: number[] = [];
  let remaining = BigInt(value);
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining) byte |= 0x80;
    bytes.push(byte);
  } while (remaining);
  return Buffer.from(bytes);
}

function field(number: number, wireType: number): Buffer {
  return encodeVarint((number << 3) | wireType);
}

function varintField(number: number, value: number): Buffer {
  return Buffer.concat([field(number, 0), encodeVarint(value)]);
}

function bytesField(number: number, body: Buffer): Buffer {
  return Buffer.concat([field(number, 2), encodeVarint(body.length), body]);
}

function frame(flag: number, body: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header[0] = flag;
  header.writeUInt32BE(body.length, 1);
  return Buffer.concat([header, body]);
}

function response(body: Buffer): Response {
  return new Response(body as unknown as BodyInit, {
    status: 200,
    headers: { "Content-Type": "application/grpc-web+proto" },
  });
}

function resetInventory(count: number): Response {
  const expires = Math.floor(Date.now() / 1000) + 86_400;
  const payload = Buffer.concat(
    Array.from({ length: count }, (_, index) =>
      bytesField(
        10,
        Buffer.concat([
          bytesField(10, Buffer.from(`reset-${index}`, "utf8")),
          bytesField(30, varintField(1, expires)),
        ])
      )
    )
  );
  return response(
    Buffer.concat([frame(0, payload), frame(0x80, Buffer.from("grpc-status:0\r\n"))])
  );
}

function quotaResponse(ratio: number): Response {
  const float = Buffer.alloc(4);
  float.writeFloatLE(ratio);
  const reset = bytesField(5, varintField(1, Math.floor(Date.now() / 1000) + 604_800));
  const payload = bytesField(1, Buffer.concat([field(1, 5), float, reset]));
  return response(frame(0, payload));
}

test.after(() => {
  globalThis.fetch = originalFetch;
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("Grok reset-credit connection service lists, redeems and refreshes persisted quota", async () => {
  const connection = (await providers.createProviderConnection({
    provider: "grok-cli",
    authType: "oauth",
    name: "Grok reset test",
    email: "grok-reset@example.test",
    accessToken: "oauth-access-token",
    refreshToken: "oauth-refresh-token",
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  })) as { id: string };

  let redeemed = false;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.includes("RedeemReset")) {
      redeemed = true;
      return response(
        Buffer.concat([frame(0, Buffer.alloc(0)), frame(0x80, Buffer.from("grpc-status:0\r\n"))])
      );
    }
    if (url.includes("GetRemainingResets")) return resetInventory(redeemed ? 0 : 1);
    if (url.includes("GetGrokCreditsConfig")) return quotaResponse(0.25);
    return new Response(null, { status: 404 });
  }) as typeof fetch;

  const listed = await resetCredits.listResetCredits(connection.id);
  assert.equal(listed.availableCount, 1);
  assert.equal(listed.credits[0]?.selectionToken, "reset-0");

  const result = await resetCredits.redeemResetCredit(connection.id, "reset-0");
  assert.equal(result.outcome, "reset");
  assert.equal(result.usage.bankedResetCredits, 0);
  assert.equal(providerLimits.getProviderLimitsCache(connection.id)?.bankedResetCredits, 0);
});
