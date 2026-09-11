import { getGrokBuildClientHeaders } from "../config/grokBuild.ts";
import {
  decodeGrokGrpcWebRpc,
  decodeGrokResetCreditsFrame,
  encodeGrpcWebRequest,
  encodeRedeemResetRequest,
  type GrokResetCreditToken,
} from "./grokResetCreditsFrame.ts";

export const GROK_RESET_CREDITS_URL =
  "https://grok.com/prod_mc_billing.ConsumerUiSvc/GetRemainingResets";
export const GROK_REDEEM_RESET_URL = "https://grok.com/prod_mc_billing.ConsumerUiSvc/RedeemReset";

const EMPTY_REQUEST_FRAME = Buffer.from([0, 0, 0, 0, 0]);

export interface PublicResetCredit {
  selectionToken: string;
  expiresAt: string | null;
}

export class ResetCreditError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ResetCreditError";
  }
}

function rpcHeaders(accessToken: string): Record<string, string> {
  return {
    ...getGrokBuildClientHeaders("headless"),
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/grpc-web+proto",
    "X-Grpc-Web": "1",
  };
}

function toPublicCredits(tokens: GrokResetCreditToken[]): PublicResetCredit[] {
  const expiry = (value: string | null): number => {
    if (!value) return Number.POSITIVE_INFINITY;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
  };

  return tokens
    .map((token, index) => ({ token, index }))
    .sort(
      (left, right) =>
        expiry(left.token.expiresAt) - expiry(right.token.expiresAt) || left.index - right.index
    )
    .map(({ token }) => ({ selectionToken: token.tokenId, expiresAt: token.expiresAt }));
}

export async function listGrokResetCredits(
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ credits: PublicResetCredit[]; availableCount: number }> {
  if (!accessToken.trim()) {
    throw new ResetCreditError(401, "access_token_missing", "Grok OAuth access token is missing.");
  }

  const response = await fetchImpl(GROK_RESET_CREDITS_URL, {
    method: "POST",
    headers: rpcHeaders(accessToken),
    body: EMPTY_REQUEST_FRAME,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new ResetCreditError(
      response.status,
      "reset_credit_upstream_error",
      `Grok reset-credit API returned HTTP ${response.status}.`
    );
  }

  const decoded = decodeGrokResetCreditsFrame(Buffer.from(await response.arrayBuffer()));
  if (!decoded.ok) {
    throw new ResetCreditError(
      502,
      "reset_credit_decode_failed",
      "Grok reset-credit inventory could not be decoded."
    );
  }
  const credits = toPublicCredits(decoded.tokens);
  return { credits, availableCount: credits.length };
}

export async function fetchGrokResetCreditCount(
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<number | null> {
  if (!accessToken.trim()) return null;
  try {
    return (await listGrokResetCredits(accessToken, fetchImpl)).availableCount;
  } catch {
    return null;
  }
}

export async function redeemGrokResetCredit(
  accessToken: string,
  selectionToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<"reset" | "alreadyRedeemed"> {
  if (!accessToken.trim()) {
    throw new ResetCreditError(401, "access_token_missing", "Grok OAuth access token is missing.");
  }
  const tokenId = selectionToken.trim();
  if (!tokenId) {
    throw new ResetCreditError(400, "credit_id_required", "A reset credit must be selected.");
  }

  const response = await fetchImpl(GROK_REDEEM_RESET_URL, {
    method: "POST",
    headers: rpcHeaders(accessToken),
    body: new Uint8Array(encodeGrpcWebRequest(encodeRedeemResetRequest(tokenId))),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new ResetCreditError(
      response.status,
      "reset_credit_upstream_error",
      `Grok reset-credit API returned HTTP ${response.status}.`
    );
  }

  const rpc = decodeGrokGrpcWebRpc(
    Buffer.from(await response.arrayBuffer()),
    response.headers.get("grpc-status"),
    response.headers.get("grpc-message")
  );
  if (rpc.grpcStatus === "0") return "reset";
  if (rpc.grpcStatus === "9" && (rpc.grpcMessage || "").toLowerCase().includes("already")) {
    return "alreadyRedeemed";
  }
  if (
    rpc.grpcStatus === "9" ||
    (rpc.grpcStatus === "3" && (rpc.grpcMessage || "").toLowerCase().includes("token_id"))
  ) {
    throw new ResetCreditError(409, "no_credit", "The selected reset credit is unavailable.");
  }
  throw new ResetCreditError(502, "reset_credit_failed", "Grok rejected the reset request.");
}
