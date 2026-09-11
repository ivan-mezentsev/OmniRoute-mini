import { getProviderConnectionById } from "@/lib/db/providers";
import {
  fetchAndPersistProviderLimits,
  refreshAndUpdateCredentials,
} from "@/lib/usage/providerLimits";
import {
  listGrokResetCredits,
  redeemGrokResetCredit,
  ResetCreditError,
  type PublicResetCredit,
} from "@omniroute/open-sse/services/grokResetCredits.ts";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error.ts";

type JsonRecord = Record<string, unknown>;
type ResetOutcome = "reset" | "alreadyRedeemed";

interface ResetCreditConnection extends JsonRecord {
  id: string;
  provider: string;
  authType?: string;
  accessToken?: string;
}

interface ResetCreditAdapter {
  list: (accessToken: string) => Promise<{
    credits: PublicResetCredit[];
    availableCount: number;
  }>;
  redeem: (accessToken: string, selectionToken: string) => Promise<ResetOutcome>;
}

const RESET_CREDIT_ADAPTERS: Record<string, ResetCreditAdapter> = {
  "grok-cli": {
    list: listGrokResetCredits,
    redeem: redeemGrokResetCredit,
  },
};

async function loadConnection(connectionId: string): Promise<{
  connection: ResetCreditConnection;
  adapter: ResetCreditAdapter;
}> {
  const stored = (await getProviderConnectionById(
    connectionId
  )) as unknown as ResetCreditConnection | null;
  if (!stored) throw new ResetCreditError(404, "connection_not_found", "Connection not found.");
  const adapter = RESET_CREDIT_ADAPTERS[stored.provider];
  if (!adapter) {
    throw new ResetCreditError(
      400,
      "reset_credits_unsupported",
      "Reset credits are unavailable for this provider."
    );
  }
  if (stored.authType !== "oauth") {
    throw new ResetCreditError(400, "oauth_required", "Reset credits require an OAuth connection.");
  }

  try {
    const refreshed = await refreshAndUpdateCredentials(stored);
    return { connection: refreshed.connection as ResetCreditConnection, adapter };
  } catch (error) {
    throw new ResetCreditError(
      401,
      "credential_refresh_failed",
      sanitizeErrorMessage(error) || "OAuth credentials could not be refreshed."
    );
  }
}

function accessToken(connection: ResetCreditConnection): string {
  const token = typeof connection.accessToken === "string" ? connection.accessToken.trim() : "";
  if (!token) {
    throw new ResetCreditError(401, "access_token_missing", "OAuth access token is missing.");
  }
  return token;
}

export async function listResetCredits(connectionId: string) {
  const { connection, adapter } = await loadConnection(connectionId);
  return adapter.list(accessToken(connection));
}

export async function redeemResetCredit(connectionId: string, selectionToken: string) {
  const { connection, adapter } = await loadConnection(connectionId);
  const outcome = await adapter.redeem(accessToken(connection), selectionToken);
  const refreshed = await fetchAndPersistProviderLimits(connectionId, "manual");
  return { outcome, usage: refreshed.usage };
}

export { ResetCreditError };
