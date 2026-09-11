import { getCodexBackendIdentityHeaders } from "../config/codexClient.ts";

export const CODEX_RESET_CREDITS_URL =
  "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
export const CODEX_RESET_CREDIT_CONSUME_URL = `${CODEX_RESET_CREDITS_URL}/consume`;

export interface CodexResetCreditContext {
  accessToken: string;
  workspaceId?: string | null;
}

export interface PublicCodexResetCredit {
  selectionToken: string;
  resetType?: string;
  status?: string;
  grantedAt?: string | null;
  expiresAt?: string | null;
  title?: string;
  description?: string;
}

export class CodexResetCreditError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "CodexResetCreditError";
  }
}

type JsonRecord = Record<string, unknown>;

function toRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function normalizeOutcome(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "") || null
  );
}

function extractOutcome(value: unknown): string | null {
  const direct = normalizeOutcome(value);
  if (direct) return direct;
  const record = toRecord(value);
  for (const key of ["code", "outcome", "status", "result", "type"]) {
    const candidate = normalizeOutcome(record[key]);
    if (candidate) return candidate;
  }
  return null;
}

function stringField(record: JsonRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function timestampField(record: JsonRecord, keys: string[]): string | null | undefined {
  for (const key of keys) {
    const value = record[key];
    if (value === null) return null;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function isUnavailable(record: JsonRecord): boolean {
  const status = normalizeOutcome(
    record.status ?? record.state ?? record.outcome ?? record.result ?? record.code
  );
  return (
    (status !== null &&
      ["consumed", "redeeming", "redeemed", "used", "expired", "unavailable"].includes(status)) ||
    record.consumed === true ||
    record.redeemed === true ||
    record.available === false
  );
}

function parseCredit(value: unknown): PublicCodexResetCredit | null {
  const record = toRecord(value);
  if (!Object.keys(record).length || isUnavailable(record)) return null;
  const selectionToken = stringField(record, ["credit_id", "creditId", "id"]);
  if (!selectionToken) return null;
  const expiresAt = timestampField(record, [
    "expires_at",
    "expiresAt",
    "expiration_at",
    "expirationAt",
  ]);
  if (expiresAt) {
    const expiry = Date.parse(expiresAt);
    if (Number.isFinite(expiry) && expiry <= Date.now()) return null;
  }

  const resetType = stringField(record, ["reset_type", "resetType"]);
  const status = stringField(record, ["status", "state"]);
  const grantedAt = timestampField(record, ["granted_at", "grantedAt"]);
  const title = stringField(record, ["title"]);
  const description = stringField(record, ["description"]);
  return {
    selectionToken,
    ...(resetType ? { resetType } : {}),
    ...(status ? { status } : {}),
    ...(grantedAt !== undefined ? { grantedAt } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
  };
}

function creditCandidates(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = toRecord(payload);
  for (const key of [
    "credits",
    "reset_credits",
    "resetCredits",
    "rate_limit_reset_credits",
    "rateLimitResetCredits",
    "items",
    "data",
  ]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function selectedCredit(payload: unknown, selectionToken: string): PublicCodexResetCredit {
  const credit = creditCandidates(payload)
    .map(parseCredit)
    .find((candidate) => candidate?.selectionToken === selectionToken);
  if (credit) return credit;
  throw new CodexResetCreditError(
    409,
    "selected_credit_unavailable",
    "The selected Codex reset credit is no longer available."
  );
}

function headers(context: CodexResetCreditContext): Record<string, string> {
  const token = context.accessToken.trim();
  if (!token) {
    throw new CodexResetCreditError(401, "access_token_missing", "Codex OAuth token is missing.");
  }
  return {
    ...getCodexBackendIdentityHeaders(),
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(context.workspaceId?.trim() ? { "chatgpt-account-id": context.workspaceId.trim() } : {}),
  };
}

async function payload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function knownConflict(value: unknown): never | void {
  const outcome = extractOutcome(value);
  if (outcome === "nocredit" || outcome === "nocredits") {
    throw new CodexResetCreditError(409, "no_credit", "No Codex reset credits are available.");
  }
  if (outcome === "nothingtoreset") {
    throw new CodexResetCreditError(
      409,
      "nothing_to_reset",
      "No exhausted Codex usage limit can be reset right now."
    );
  }
}

export async function listCodexResetCredits(
  context: CodexResetCreditContext,
  fetchImpl: typeof fetch = fetch
): Promise<{ credits: PublicCodexResetCredit[]; availableCount: number }> {
  const response = await fetchImpl(CODEX_RESET_CREDITS_URL, {
    method: "GET",
    headers: headers(context),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await payload(response);
  if (!response.ok) {
    knownConflict(body);
    throw new CodexResetCreditError(
      response.status,
      "reset_credit_upstream_error",
      `Codex reset-credit API returned HTTP ${response.status}.`
    );
  }

  const credits = creditCandidates(body)
    .map(parseCredit)
    .filter((credit): credit is PublicCodexResetCredit => credit !== null)
    .map((credit, index) => ({ credit, index }))
    .sort((left, right) => {
      const expiry = (credit: PublicCodexResetCredit) =>
        credit.expiresAt ? Date.parse(credit.expiresAt) : Number.POSITIVE_INFINITY;
      return expiry(left.credit) - expiry(right.credit) || left.index - right.index;
    })
    .map(({ credit }) => credit);
  const bodyRecord = toRecord(body);
  const reported = Number(bodyRecord.available_count ?? bodyRecord.availableCount);
  return {
    credits,
    availableCount: Number.isFinite(reported) ? Math.max(0, Math.trunc(reported)) : credits.length,
  };
}

export async function redeemCodexResetCredit(
  context: CodexResetCreditContext,
  selectionToken: string,
  idempotencyKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<"reset" | "alreadyRedeemed"> {
  const creditId = selectionToken.trim();
  if (!creditId) {
    throw new CodexResetCreditError(400, "credit_id_required", "A reset credit must be selected.");
  }
  const requestId = idempotencyKey.trim();
  if (!requestId) {
    throw new CodexResetCreditError(
      400,
      "idempotency_key_required",
      "An idempotency key is required."
    );
  }

  const creditsResponse = await fetchImpl(CODEX_RESET_CREDITS_URL, {
    method: "GET",
    headers: headers(context),
    signal: AbortSignal.timeout(15_000),
  });
  const creditsBody = await payload(creditsResponse);
  if (!creditsResponse.ok) {
    knownConflict(creditsBody);
    throw new CodexResetCreditError(
      creditsResponse.status,
      "reset_credit_upstream_error",
      `Codex reset-credit API returned HTTP ${creditsResponse.status}.`
    );
  }
  selectedCredit(creditsBody, creditId);

  const response = await fetchImpl(CODEX_RESET_CREDIT_CONSUME_URL, {
    method: "POST",
    headers: headers(context),
    body: JSON.stringify({ redeem_request_id: requestId, credit_id: creditId }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await payload(response);
  if (!response.ok) {
    knownConflict(body);
    throw new CodexResetCreditError(
      response.status,
      "reset_credit_upstream_error",
      `Codex reset-credit API returned HTTP ${response.status}.`
    );
  }

  const outcome = extractOutcome(body);
  if (outcome === "reset") return "reset";
  if (outcome === "alreadyredeemed") return "alreadyRedeemed";
  knownConflict(body);
  throw new CodexResetCreditError(
    502,
    "unknown_reset_credit_response",
    "Codex returned an unknown reset-credit response."
  );
}
