import { getGrokBuildOAuthHeaders, GROK_BUILD_TOKEN_URL } from "../config/grokBuild.ts";
import { resolvePublicCred } from "../utils/publicCreds.ts";
import type { ExecutorLog, ProviderCredentials } from "../executors/base.ts";

const MAX_ATTEMPTS = 3;
const TERMINAL_ERRORS = new Set(["invalid_grant", "invalid_client"]);

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function refreshGrokCliCredentials(
  credentials: ProviderCredentials,
  log?: ExecutorLog | null
): Promise<Partial<ProviderCredentials> | null> {
  if (!credentials.refreshToken) {
    log?.warn?.("TOKEN_REFRESH", "Grok Build: no refresh token available");
    return null;
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: resolvePublicCred("grok_id", "GROK_OAUTH_CLIENT_ID"),
    refresh_token: credentials.refreshToken,
  });
  const providerData = credentials.providerSpecificData || {};
  const principalType = nonEmptyString(providerData.principalType);
  const principalId = nonEmptyString(providerData.principalId);
  if (principalType) body.set("principal_type", principalType);
  if (principalId) body.set("principal_id", principalId);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** (attempt - 2)));
    }
    try {
      const response = await fetch(GROK_BUILD_TOKEN_URL, {
        method: "POST",
        headers: getGrokBuildOAuthHeaders(),
        body,
        signal: AbortSignal.timeout(15_000),
      });
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const errorCode = nonEmptyString(data.error);
      if (!response.ok) {
        log?.warn?.("TOKEN_REFRESH", `Grok Build: refresh failed with status ${response.status}`);
        if (errorCode && TERMINAL_ERRORS.has(errorCode)) return null;
        continue;
      }

      const accessToken = nonEmptyString(data.access_token);
      if (!accessToken) continue;
      const expiresIn =
        typeof data.expires_in === "number" && data.expires_in > 0 ? data.expires_in : 21600;
      return {
        accessToken,
        refreshToken: nonEmptyString(data.refresh_token) || credentials.refreshToken,
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      };
    } catch (error) {
      log?.warn?.(
        "TOKEN_REFRESH",
        `Grok Build: refresh error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return null;
}
