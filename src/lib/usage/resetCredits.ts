import { getProviderConnectionById } from "@/lib/db/providers";
import { resolveProxyForConnection } from "@/lib/db/settings";
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
import {
  CodexResetCreditError,
  listCodexResetCredits,
  redeemCodexResetCredit,
} from "@omniroute/open-sse/services/codexResetCredits.ts";
import { invalidateCodexQuotaCache } from "@omniroute/open-sse/services/codexQuotaFetcher.ts";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error.ts";
import { runWithProxyContext } from "@omniroute/open-sse/utils/proxyFetch.ts";

type JsonRecord = Record<string, unknown>;
type ResetOutcome = "reset" | "alreadyRedeemed";

interface ResetCreditConnection extends JsonRecord {
  id: string;
  provider: string;
  authType?: string;
  accessToken?: string;
  providerSpecificData?: JsonRecord;
}

interface ResetCreditAdapter {
  list: (connection: ResetCreditConnection) => Promise<{
    credits: PublicResetCredit[];
    availableCount: number;
  }>;
  redeem: (
    connection: ResetCreditConnection,
    selectionToken: string,
    idempotencyKey: string
  ) => Promise<ResetOutcome>;
  invalidate?: (connectionId: string) => void;
}

const RESET_CREDIT_ADAPTERS: Record<string, ResetCreditAdapter> = {
  "grok-cli": {
    list: (connection) => listGrokResetCredits(accessToken(connection)),
    redeem: (connection, selectionToken) =>
      redeemGrokResetCredit(accessToken(connection), selectionToken),
  },
  codex: {
    list: (connection) =>
      listCodexResetCredits({
        accessToken: accessToken(connection),
        workspaceId:
          typeof connection.providerSpecificData?.workspaceId === "string"
            ? connection.providerSpecificData.workspaceId
            : null,
      }),
    redeem: (connection, selectionToken, idempotencyKey) =>
      redeemCodexResetCredit(
        {
          accessToken: accessToken(connection),
          workspaceId:
            typeof connection.providerSpecificData?.workspaceId === "string"
              ? connection.providerSpecificData.workspaceId
              : null,
        },
        selectionToken,
        idempotencyKey
      ),
    invalidate: invalidateCodexQuotaCache,
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

async function withConnectionProxy<T>(connectionId: string, operation: () => Promise<T>) {
  const proxyInfo = await resolveProxyForConnection(connectionId);
  return runWithProxyContext(proxyInfo?.proxy ?? null, operation);
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
  try {
    return await withConnectionProxy(connectionId, () => adapter.list(connection));
  } catch (error) {
    if (error instanceof ResetCreditError) throw error;
    if (error instanceof CodexResetCreditError) {
      throw new ResetCreditError(error.status, error.code, error.message);
    }
    throw error;
  }
}

export async function redeemResetCredit(
  connectionId: string,
  selectionToken: string,
  idempotencyKey: string
) {
  const { connection, adapter } = await loadConnection(connectionId);
  try {
    let activeConnection = connection;
    let outcome: ResetOutcome;
    try {
      outcome = await withConnectionProxy(connectionId, () =>
        adapter.redeem(activeConnection, selectionToken, idempotencyKey)
      );
    } catch (error) {
      if (
        activeConnection.provider !== "codex" ||
        !(error instanceof CodexResetCreditError) ||
        (error.status !== 401 && error.status !== 403)
      ) {
        throw error;
      }
      const refreshed = await refreshAndUpdateCredentials(activeConnection, { force: true });
      activeConnection = refreshed.connection as ResetCreditConnection;
      outcome = await withConnectionProxy(connectionId, () =>
        adapter.redeem(activeConnection, selectionToken, idempotencyKey)
      );
    }
    adapter.invalidate?.(connectionId);
    const refreshed = await fetchAndPersistProviderLimits(connectionId, "manual");
    return { outcome, usage: refreshed.usage };
  } catch (error) {
    if (error instanceof ResetCreditError) throw error;
    if (error instanceof CodexResetCreditError) {
      throw new ResetCreditError(error.status, error.code, error.message);
    }
    throw error;
  }
}

export { ResetCreditError };
