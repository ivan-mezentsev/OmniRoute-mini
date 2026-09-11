import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeGrokResetCreditsFrame,
  encodeRedeemResetRequest,
} from "../../open-sse/services/grokResetCreditsFrame.ts";
import {
  GROK_REDEEM_RESET_URL,
  GROK_RESET_CREDITS_URL,
  listGrokResetCredits,
  redeemGrokResetCredit,
  ResetCreditError,
} from "../../open-sse/services/grokResetCredits.ts";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.tsx";

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

function field(fieldNumber: number, wireType: number): Buffer {
  return encodeVarint((fieldNumber << 3) | wireType);
}

function varintField(fieldNumber: number, value: number): Buffer {
  return Buffer.concat([field(fieldNumber, 0), encodeVarint(value)]);
}

function bytesField(fieldNumber: number, body: Buffer): Buffer {
  return Buffer.concat([field(fieldNumber, 2), encodeVarint(body.length), body]);
}

function grpcFrame(flag: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header[0] = flag;
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

function grpcResponse(payload: Buffer, status = 0, message?: string): Response {
  const trailer = Buffer.from(
    `grpc-status:${status}\r\n${message ? `grpc-message:${encodeURIComponent(message)}\r\n` : ""}`,
    "utf8"
  );
  const body = Buffer.concat([grpcFrame(0, payload), grpcFrame(0x80, trailer)]);
  return new Response(body as unknown as BodyInit, {
    status: 200,
    headers: { "Content-Type": "application/grpc-web+proto" },
  });
}

function compactToken(id: string, expires: number): Buffer {
  return bytesField(
    10,
    Buffer.concat([
      bytesField(1, Buffer.from(id, "utf8")),
      varintField(2, expires - 3600),
      varintField(3, expires),
    ])
  );
}

function liveToken(id: string, expires: number): Buffer {
  const timestamp = (value: number) => varintField(1, value);
  return bytesField(
    10,
    Buffer.concat([
      bytesField(10, Buffer.from(id, "utf8")),
      bytesField(20, timestamp(expires - 3600)),
      bytesField(30, timestamp(expires)),
    ])
  );
}

test("Grok reset-credit decoder supports compact and live token shapes and filters expiry", () => {
  const now = 2_000_000_000_000;
  const payload = Buffer.concat([
    compactToken("compact", now / 1000 + 7200),
    liveToken("live", now / 1000 + 3600),
    compactToken("expired", now / 1000 - 1),
  ]);
  const decoded = decodeGrokResetCreditsFrame(
    Buffer.concat([grpcFrame(0, payload), grpcFrame(0x80, Buffer.from("grpc-status:0\r\n"))]),
    now
  );

  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.deepEqual(
    decoded.tokens.map((token) => token.tokenId),
    ["compact", "live"]
  );
  assert.equal(
    decodeGrokResetCreditsFrame(grpcFrame(0x80, Buffer.from("grpc-status:7\r\n"))).ok,
    false
  );
});

test("listGrokResetCredits sends OAuth and Grok fingerprints and sorts by expiry", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const fetchImpl = (async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return grpcResponse(
      Buffer.concat([liveToken("later", 2_100_000_000), liveToken("first", 2_050_000_000)])
    );
  }) as typeof fetch;

  const result = await listGrokResetCredits("oauth-token", fetchImpl);
  const headers = new Headers(capturedInit?.headers);
  assert.equal(capturedUrl, GROK_RESET_CREDITS_URL);
  assert.equal(headers.get("authorization"), "Bearer oauth-token");
  assert.equal(headers.get("x-grpc-web"), "1");
  assert.equal(headers.get("x-grok-client-identifier"), "grok-shell");
  assert.deepEqual(Array.from(capturedInit?.body as Uint8Array), [0, 0, 0, 0, 0]);
  assert.equal(result.availableCount, 2);
  assert.deepEqual(
    result.credits.map((credit) => credit.selectionToken),
    ["first", "later"]
  );
});

test("redeemGrokResetCredit encodes opaque token in protobuf field 10", async () => {
  let capturedUrl = "";
  let capturedBody: Uint8Array | undefined;
  const fetchImpl = (async (input, init) => {
    capturedUrl = String(input);
    capturedBody = init?.body as Uint8Array;
    return grpcResponse(Buffer.alloc(0));
  }) as typeof fetch;

  assert.equal(await redeemGrokResetCredit("oauth-token", "opaque-token", fetchImpl), "reset");
  assert.equal(capturedUrl, GROK_REDEEM_RESET_URL);
  const encoded = encodeRedeemResetRequest("opaque-token");
  assert.deepEqual(Array.from(capturedBody || []), [0, 0, 0, 0, encoded.length, ...encoded]);
});

test("redeemGrokResetCredit maps unavailable credits to a conflict", async () => {
  const fetchImpl = (async () =>
    grpcResponse(Buffer.alloc(0), 9, "token does not exist")) as typeof fetch;

  await assert.rejects(
    () => redeemGrokResetCredit("oauth-token", "missing", fetchImpl),
    (error: unknown) =>
      error instanceof ResetCreditError && error.status === 409 && error.code === "no_credit"
  );
});

test("Provider Limits creates a dedicated non-percentage reset-credit row", () => {
  const quotas = parseQuotaData("grok-cli", {
    bankedResetCredits: 1,
    quotas: {
      weekly: { used: 20, total: 100, remainingPercentage: 80 },
    },
  });
  const reset = quotas.find((quota) => quota.isResetCredits);

  assert.equal(quotas.length, 2);
  assert.ok(reset);
  assert.equal(reset.creditCount, 1);
  assert.equal(reset.unlimited, true);
  assert.equal(reset.remainingPercentage, 100);

  const zero = parseQuotaData("grok-cli", { bankedResetCredits: 0, quotas: {} });
  assert.equal(zero.find((quota) => quota.isResetCredits)?.creditCount, 0);
  assert.equal(parseQuotaData("grok-cli", { bankedResetCredits: null, quotas: {} }).length, 0);
});
