const FIELD_CREDITS_INFO = 1;
const CREDITS_FIELD_USAGE_PERCENT = 1;
const CREDITS_FIELD_RESET_TIMESTAMP = 5;
const TIMESTAMP_FIELD_SECONDS = 1;
const TIMESTAMP_FIELD_NANOS = 2;

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LENGTH_DELIMITED = 2;
const WIRE_FIXED32 = 5;
const GRPC_WEB_TRAILER_FLAG = 0x80;

type ProtoField =
  | { wireType: typeof WIRE_VARINT; value: number }
  | {
      wireType: typeof WIRE_FIXED64 | typeof WIRE_LENGTH_DELIMITED | typeof WIRE_FIXED32;
      bytes: Buffer;
    };

export interface GrokCreditsQuota {
  percentUsed: number;
  resetAt: string | null;
}

export interface GrokFrameHeader {
  flag: number;
  payloadStart: number;
  payloadLength: number;
}

export function probeFrameHeader(buffer: Buffer, offset = 0): GrokFrameHeader | null {
  if (offset < 0 || buffer.length - offset < 5) return null;
  const flag = buffer[offset];
  if (![0, 1, 0x80, 0x81].includes(flag)) return null;
  const payloadStart = offset + 5;
  const payloadLength = buffer.readUInt32BE(offset + 1);
  if (payloadLength > buffer.length - payloadStart) return null;
  return { flag, payloadStart, payloadLength };
}

function readVarint(buffer: Buffer, offset: number): { value: number; next: number } | null {
  let result = 0n;
  let shift = 0n;
  let cursor = offset;

  while (cursor < buffer.length && shift <= 70n) {
    const byte = buffer[cursor++];
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value: Number(result), next: cursor };
    shift += 7n;
  }

  return null;
}

function decodeFields(buffer: Buffer): Map<number, ProtoField> | null {
  const fields = new Map<number, ProtoField>();
  let offset = 0;

  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset);
    if (!tag) return null;
    const fieldNumber = tag.value >>> 3;
    const wireType = tag.value & 7;
    if (!fieldNumber) return null;
    offset = tag.next;

    if (wireType === WIRE_VARINT) {
      const value = readVarint(buffer, offset);
      if (!value) return null;
      fields.set(fieldNumber, { wireType: WIRE_VARINT, value: value.value });
      offset = value.next;
      continue;
    }

    if (wireType === WIRE_LENGTH_DELIMITED) {
      const length = readVarint(buffer, offset);
      if (!length || length.value < 0 || length.next + length.value > buffer.length) return null;
      const end = length.next + length.value;
      fields.set(fieldNumber, {
        wireType: WIRE_LENGTH_DELIMITED,
        bytes: buffer.subarray(length.next, end),
      });
      offset = end;
      continue;
    }

    const width = wireType === WIRE_FIXED32 ? 4 : wireType === WIRE_FIXED64 ? 8 : 0;
    if (!width || offset + width > buffer.length) return null;
    fields.set(fieldNumber, {
      wireType: wireType === WIRE_FIXED32 ? WIRE_FIXED32 : WIRE_FIXED64,
      bytes: buffer.subarray(offset, offset + width),
    });
    offset += width;
  }

  return fields;
}

function getDataPayload(buffer: Buffer): Buffer | null {
  if (!probeFrameHeader(buffer)) return buffer;

  let offset = 0;
  while (offset < buffer.length) {
    const frame = probeFrameHeader(buffer, offset);
    if (!frame) return null;
    const end = frame.payloadStart + frame.payloadLength;
    if ((frame.flag & GRPC_WEB_TRAILER_FLAG) === 0) {
      return buffer.subarray(frame.payloadStart, end);
    }
    offset = end;
  }

  return null;
}

function decodeTimestamp(field: ProtoField | undefined): string | null {
  if (!field || field.wireType !== WIRE_LENGTH_DELIMITED) return null;
  const fields = decodeFields(field.bytes);
  if (!fields) return null;
  const secondsField = fields.get(TIMESTAMP_FIELD_SECONDS);
  const nanosField = fields.get(TIMESTAMP_FIELD_NANOS);
  const seconds = secondsField?.wireType === WIRE_VARINT ? secondsField.value : 0;
  const nanos = nanosField?.wireType === WIRE_VARINT ? nanosField.value : 0;
  const date = new Date(seconds * 1000 + Math.round(nanos / 1_000_000));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function decodeGrokCreditsFrame(buffer: Buffer): GrokCreditsQuota | null {
  if (!buffer.length) return null;

  try {
    const payload = getDataPayload(buffer);
    if (!payload) return null;
    const topLevel = decodeFields(payload);
    const creditsField = topLevel?.get(FIELD_CREDITS_INFO);
    if (!creditsField || creditsField.wireType !== WIRE_LENGTH_DELIMITED) return null;
    const credits = decodeFields(creditsField.bytes);
    if (!credits) return null;

    const percentField = credits.get(CREDITS_FIELD_USAGE_PERCENT);
    let percentUsed = 0;
    if (percentField?.wireType === WIRE_FIXED32) percentUsed = percentField.bytes.readFloatLE(0);
    else if (percentField?.wireType === WIRE_FIXED64)
      percentUsed = percentField.bytes.readDoubleLE(0);
    else if (percentField) return null;
    if (!Number.isFinite(percentUsed) || percentUsed < 0) return null;

    return {
      percentUsed: Math.min(100, percentUsed),
      resetAt: decodeTimestamp(credits.get(CREDITS_FIELD_RESET_TIMESTAMP)),
    };
  } catch {
    return null;
  }
}
