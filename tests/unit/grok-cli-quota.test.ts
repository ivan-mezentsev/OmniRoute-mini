import test from "node:test";
import assert from "node:assert/strict";

import { decodeGrokCreditsFrame } from "../../open-sse/services/grokCliQuotaFrame.ts";
import {
  fetchGrokCliQuota,
  GROK_BUILD_BILLING_URL,
} from "../../open-sse/services/grokCliQuotaFetcher.ts";
import { getUsageForProvider, USAGE_FETCHER_PROVIDERS } from "../../open-sse/services/usage.ts";
import { USAGE_SUPPORTED_PROVIDERS } from "../../src/shared/constants/providers.ts";

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

function encodeField(fieldNumber: number, wireType: number): Buffer {
  return encodeVarint((fieldNumber << 3) | wireType);
}

function encodeLengthDelimited(fieldNumber: number, body: Buffer): Buffer {
  return Buffer.concat([encodeField(fieldNumber, 2), encodeVarint(body.length), body]);
}

function encodeTimestamp(seconds: number): Buffer {
  return encodeLengthDelimited(5, Buffer.concat([encodeField(1, 0), encodeVarint(seconds)]));
}

function buildCreditsPayload(usageRatio: number, resetSeconds = 1893456000): Buffer {
  const ratio = Buffer.alloc(4);
  ratio.writeFloatLE(usageRatio);
  const credits = Buffer.concat([encodeField(1, 5), ratio, encodeTimestamp(resetSeconds)]);
  return encodeLengthDelimited(1, credits);
}

function frame(payload: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

function buildResetCreditsResponse(): Buffer {
  const expiresAt = Math.floor(Date.now() / 1000) + 86_400;
  const token = Buffer.concat([
    encodeLengthDelimited(10, Buffer.from("selection-token", "utf8")),
    encodeLengthDelimited(30, Buffer.concat([encodeField(1, 0), encodeVarint(expiresAt)])),
  ]);
  const data = frame(encodeLengthDelimited(10, token));
  const trailerBody = Buffer.from("grpc-status:0\r\n", "utf8");
  const trailer = Buffer.alloc(5);
  trailer[0] = 0x80;
  trailer.writeUInt32BE(trailerBody.length, 1);
  return Buffer.concat([data, trailer, trailerBody]);
}

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("Grok Build quota decoder accepts raw and framed protobuf responses", () => {
  const payload = buildCreditsPayload(0.375);
  const raw = decodeGrokCreditsFrame(payload);
  const framed = decodeGrokCreditsFrame(frame(payload));

  assert.ok(raw);
  assert.ok(framed);
  assert.ok(Math.abs(raw.percentUsed - 37.5) < 0.001);
  assert.ok(Math.abs(framed.percentUsed - 37.5) < 0.001);
  assert.equal(raw.resetAt, "2030-01-01T00:00:00.000Z");
  assert.equal(decodeGrokCreditsFrame(Buffer.from([0xff, 0xff])), null);
});

test("Grok Build quota fetch uses OAuth bearer and Grok client fingerprint", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  globalThis.fetch = (async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(frame(buildCreditsPayload(0.2)) as unknown as BodyInit, {
      status: 200,
      headers: { "Content-Type": "application/grpc-web+proto" },
    });
  }) as typeof fetch;

  const quota = await fetchGrokCliQuota("oauth-access-token");
  const headers = new Headers(requestInit?.headers);

  assert.equal(requestUrl, GROK_BUILD_BILLING_URL);
  assert.equal(headers.get("authorization"), "Bearer oauth-access-token");
  assert.equal(headers.get("x-grpc-web"), "1");
  assert.equal(headers.get("x-grok-client-identifier"), "grok-shell");
  assert.equal(headers.get("x-grok-client-version"), "0.2.106");
  assert.deepEqual(Array.from(requestInit?.body as Uint8Array), [0, 0, 0, 0, 0]);
  assert.ok(quota);
  assert.ok(Math.abs(quota.remainingPercentage - 80) < 0.001);
});

test("Grok Build usage is exposed to dashboard and generic quota registration", async () => {
  globalThis.fetch = (async (input) => {
    const body = String(input).includes("GetRemainingResets")
      ? buildResetCreditsResponse()
      : frame(buildCreditsPayload(0.6));
    return new Response(body as unknown as BodyInit, { status: 200 });
  }) as typeof fetch;

  const usage = (await getUsageForProvider({
    id: "connection-1",
    provider: "grok-cli",
    accessToken: "oauth-access-token",
  })) as Record<string, any>;

  assert.ok(USAGE_FETCHER_PROVIDERS.includes("grok-cli"));
  assert.ok(USAGE_SUPPORTED_PROVIDERS.includes("grok-cli"));
  assert.equal(usage.plan, "Grok Build");
  assert.equal(usage.bankedResetCredits, 1);
  assert.equal(usage.quotas.weekly.displayName, "Shared Weekly Credits");
  assert.ok(Math.abs(usage.quotas.weekly.used - 60) < 0.001);
  assert.ok(Math.abs(usage.quotas.weekly.remainingPercentage - 40) < 0.001);
});

test("Grok Build quota failures remain unknown instead of reporting zero remaining", async () => {
  globalThis.fetch = (async () => new Response(null, { status: 401 })) as typeof fetch;

  assert.equal(await fetchGrokCliQuota("expired-token"), null);
  const usage = (await getUsageForProvider({
    provider: "grok-cli",
    accessToken: "expired-token",
  })) as Record<string, unknown>;
  assert.equal(typeof usage.message, "string");
  assert.equal("quotas" in usage, false);
});
