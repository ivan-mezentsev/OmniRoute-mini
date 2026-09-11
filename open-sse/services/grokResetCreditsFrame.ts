import { probeFrameHeader } from "./grokCliQuotaFrame.ts";

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LENGTH_DELIMITED = 2;
const WIRE_FIXED32 = 5;
const GRPC_WEB_TRAILER_FLAG = 0x80;
const FIELD_RESET_TOKEN = 10;
const TOKEN_FIELDS = {
  id: [1, 10],
  expires: [3, 30],
} as const;
const REDEEM_TOKEN_ID_FIELD = 10;

type ProtoField =
  | { wireType: typeof WIRE_VARINT; value: number }
  | {
      wireType: typeof WIRE_FIXED64 | typeof WIRE_LENGTH_DELIMITED | typeof WIRE_FIXED32;
      bytes: Buffer;
    };

type TaggedField = { fieldNumber: number; field: ProtoField };

export interface GrokResetCreditToken {
  tokenId: string;
  expiresAt: string | null;
}

export type GrokResetCreditsDecode =
  | { ok: true; tokens: GrokResetCreditToken[] }
  | { ok: false; reason: "empty-buffer" | "no-data-frame" | "malformed" | "trailer-nonzero" };

function encodeVarint(value: number): Buffer {
  const bytes: number[] = [];
  let remaining = Math.floor(value);
  while (remaining > 0x7f) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining = Math.floor(remaining / 128);
  }
  bytes.push(remaining);
  return Buffer.from(bytes);
}

export function encodeRedeemResetRequest(tokenId: string): Buffer {
  const body = Buffer.from(tokenId, "utf8");
  return Buffer.concat([
    encodeVarint((REDEEM_TOKEN_ID_FIELD << 3) | WIRE_LENGTH_DELIMITED),
    encodeVarint(body.length),
    body,
  ]);
}

export function encodeGrpcWebRequest(payload: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

function readVarint(buffer: Buffer, offset: number): { value: number; next: number } | null {
  let value = 0n;
  let shift = 0n;
  let cursor = offset;
  while (cursor < buffer.length && shift <= 70n) {
    const byte = buffer[cursor++];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value: Number(value), next: cursor };
    shift += 7n;
  }
  return null;
}

function readField(buffer: Buffer, offset: number): { tagged: TaggedField; next: number } | null {
  const tag = readVarint(buffer, offset);
  if (!tag) return null;
  const fieldNumber = tag.value >>> 3;
  const wireType = tag.value & 7;
  if (!fieldNumber) return null;

  if (wireType === WIRE_VARINT) {
    const result = readVarint(buffer, tag.next);
    return result
      ? {
          tagged: { fieldNumber, field: { wireType: WIRE_VARINT, value: result.value } },
          next: result.next,
        }
      : null;
  }

  if (wireType === WIRE_LENGTH_DELIMITED) {
    const length = readVarint(buffer, tag.next);
    if (!length || length.value < 0 || length.next + length.value > buffer.length) return null;
    const end = length.next + length.value;
    return {
      tagged: {
        fieldNumber,
        field: {
          wireType: WIRE_LENGTH_DELIMITED,
          bytes: buffer.subarray(length.next, end),
        },
      },
      next: end,
    };
  }

  const width = wireType === WIRE_FIXED32 ? 4 : wireType === WIRE_FIXED64 ? 8 : 0;
  if (!width || tag.next + width > buffer.length) return null;
  return {
    tagged: {
      fieldNumber,
      field: {
        wireType: wireType === WIRE_FIXED32 ? WIRE_FIXED32 : WIRE_FIXED64,
        bytes: buffer.subarray(tag.next, tag.next + width),
      },
    },
    next: tag.next + width,
  };
}

function walkFields(buffer: Buffer): TaggedField[] | null {
  const fields: TaggedField[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const result = readField(buffer, offset);
    if (!result) return null;
    fields.push(result.tagged);
    offset = result.next;
  }
  return fields;
}

function parseTrailer(buffer: Buffer): { status: number | null; message: string | null } {
  const text = buffer.toString("utf8");
  const status = text.match(/grpc-status:\s*(\d+)/)?.[1];
  const rawMessage = text.match(/grpc-message:\s*([^\r\n]+)/)?.[1] ?? null;
  let message = rawMessage;
  if (rawMessage) {
    try {
      message = decodeURIComponent(rawMessage.replace(/\+/g, " "));
    } catch {
      message = rawMessage;
    }
  }
  return { status: status ? Number(status) : null, message };
}

export function decodeGrokGrpcWebRpc(
  buffer: Buffer,
  headerStatus?: string | null,
  headerMessage?: string | null
): { grpcStatus: string; grpcMessage: string | null } {
  let status: number | null = null;
  let message: string | null = null;
  let offset = 0;
  while (offset < buffer.length) {
    const frame = probeFrameHeader(buffer, offset);
    if (!frame) break;
    const end = frame.payloadStart + frame.payloadLength;
    if ((frame.flag & GRPC_WEB_TRAILER_FLAG) !== 0) {
      const trailer = parseTrailer(buffer.subarray(frame.payloadStart, end));
      if (trailer.status !== null) status = trailer.status;
      if (trailer.message) message = trailer.message;
    }
    offset = end;
  }
  return {
    grpcStatus: status !== null ? String(status) : headerStatus?.trim() || "13",
    grpcMessage: message || headerMessage || null,
  };
}

function timestampSeconds(field: ProtoField): number | null {
  if (field.wireType === WIRE_VARINT) return Number.isFinite(field.value) ? field.value : null;
  if (field.wireType !== WIRE_LENGTH_DELIMITED) return null;
  const nested = walkFields(field.bytes);
  const seconds = nested?.find(
    (item) => item.fieldNumber === 1 && item.field.wireType === WIRE_VARINT
  );
  return seconds?.field.wireType === WIRE_VARINT ? seconds.field.value : null;
}

function includesField(fieldNumber: number, allowed: readonly number[]): boolean {
  return allowed.includes(fieldNumber);
}

function decodeInventory(payload: Buffer, nowMs: number): GrokResetCreditToken[] | null {
  if (!payload.length) return [];
  const fields = walkFields(payload);
  if (!fields) return null;
  const tokens: GrokResetCreditToken[] = [];

  for (const item of fields) {
    if (item.fieldNumber !== FIELD_RESET_TOKEN) continue;
    if (item.field.wireType !== WIRE_LENGTH_DELIMITED) return null;
    const nested = walkFields(item.field.bytes);
    if (!nested) return null;
    const idField = nested.find(
      (field) =>
        includesField(field.fieldNumber, TOKEN_FIELDS.id) &&
        field.field.wireType === WIRE_LENGTH_DELIMITED
    );
    if (!idField || idField.field.wireType !== WIRE_LENGTH_DELIMITED) return null;
    const tokenId = idField.field.bytes.toString("utf8").trim();
    if (!tokenId) return null;

    const expiryField = nested.find((field) =>
      includesField(field.fieldNumber, TOKEN_FIELDS.expires)
    );
    const expirySeconds = expiryField ? timestampSeconds(expiryField.field) : null;
    if (expirySeconds !== null && expirySeconds * 1000 < nowMs) continue;
    tokens.push({
      tokenId,
      expiresAt: expirySeconds === null ? null : new Date(expirySeconds * 1000).toISOString(),
    });
  }

  return tokens;
}

export function decodeGrokResetCreditsFrame(
  buffer: Buffer,
  nowMs = Date.now()
): GrokResetCreditsDecode {
  if (!buffer.length) return { ok: false, reason: "empty-buffer" };

  try {
    if (!probeFrameHeader(buffer)) {
      const tokens = decodeInventory(buffer, nowMs);
      return tokens ? { ok: true, tokens } : { ok: false, reason: "malformed" };
    }

    let offset = 0;
    let data: Buffer | null = null;
    let sawData = false;
    let trailerStatus: number | null = null;
    while (offset < buffer.length) {
      const frame = probeFrameHeader(buffer, offset);
      if (!frame) return { ok: false, reason: "malformed" };
      const end = frame.payloadStart + frame.payloadLength;
      const body = buffer.subarray(frame.payloadStart, end);
      if ((frame.flag & GRPC_WEB_TRAILER_FLAG) !== 0) {
        const status = parseTrailer(body).status;
        if (status !== null) trailerStatus = status;
      } else if (!sawData) {
        sawData = true;
        data = body;
      }
      offset = end;
    }

    if (trailerStatus !== null && trailerStatus !== 0) {
      return { ok: false, reason: "trailer-nonzero" };
    }
    if (!sawData || data === null) return { ok: false, reason: "no-data-frame" };
    const tokens = decodeInventory(data, nowMs);
    return tokens ? { ok: true, tokens } : { ok: false, reason: "malformed" };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}
