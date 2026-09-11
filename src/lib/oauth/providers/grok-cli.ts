import {
  getGrokBuildOAuthHeaders,
  GROK_BUILD_OAUTH_REFERRER,
} from "@omniroute/open-sse/config/grokBuild.ts";
import { GROK_CLI_CONFIG } from "../constants/oauth";

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function parseOAuthResponse(response: Response): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({
    error: "invalid_response",
    error_description: "xAI returned a non-JSON OAuth response",
  }));
}

function validateVerificationUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Grok returned an invalid verification URL");
  }
  const isLocalHttp =
    url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !isLocalHttp) {
    throw new Error("Grok returned an unsupported verification URL");
  }
}

async function requestDeviceCode(_config?: unknown, _codeChallenge?: string) {
  const response = await fetch(GROK_CLI_CONFIG.deviceCodeUrl, {
    method: "POST",
    headers: getGrokBuildOAuthHeaders(),
    body: new URLSearchParams({
      client_id: GROK_CLI_CONFIG.clientId,
      scope: GROK_CLI_CONFIG.scope,
      referrer: GROK_BUILD_OAUTH_REFERRER,
    }),
  });
  const data = await parseOAuthResponse(response);
  if (!response.ok) {
    throw new Error(
      typeof data.error_description === "string"
        ? data.error_description
        : "Grok device authorization failed"
    );
  }
  if (
    typeof data.device_code !== "string" ||
    typeof data.user_code !== "string" ||
    typeof data.verification_uri !== "string"
  ) {
    throw new Error("Grok device authorization response is incomplete");
  }
  validateVerificationUrl(data.verification_uri);
  if (typeof data.verification_uri_complete === "string") {
    validateVerificationUrl(data.verification_uri_complete);
  }
  return {
    device_code: data.device_code,
    user_code: data.user_code,
    verification_uri: data.verification_uri,
    verification_uri_complete: data.verification_uri_complete || data.verification_uri,
    expires_in: typeof data.expires_in === "number" ? data.expires_in : 1800,
    interval: typeof data.interval === "number" ? data.interval : 5,
  };
}

async function pollToken(
  _config: unknown,
  deviceCode: string,
  _codeVerifier?: string,
  _extraData?: unknown
) {
  const response = await fetch(GROK_CLI_CONFIG.tokenUrl, {
    method: "POST",
    headers: getGrokBuildOAuthHeaders(),
    body: new URLSearchParams({
      client_id: GROK_CLI_CONFIG.clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  return { ok: response.ok, data: await parseOAuthResponse(response) };
}

function extractTokens(input: unknown) {
  if (input && typeof input === "object") {
    const object = input as Record<string, unknown>;
    if (typeof object.access_token === "string") {
      return {
        accessToken: object.access_token,
        refreshToken: typeof object.refresh_token === "string" ? object.refresh_token : null,
        expiresIn: typeof object.expires_in === "number" ? object.expires_in : null,
        expiresAt: null,
      };
    }
    if (typeof object.accessToken === "string") {
      return {
        accessToken: object.accessToken,
        refreshToken: typeof object.refreshToken === "string" ? object.refreshToken : null,
        expiresIn: null,
        expiresAt: null,
      };
    }
  }
  return { accessToken: "", refreshToken: null, expiresIn: null, expiresAt: null };
}

export const grokCli = {
  config: GROK_CLI_CONFIG,
  flowType: "device_code" as const,
  requestDeviceCode,
  pollToken,
  mapTokens: (token: unknown, _extra?: unknown) => {
    const extracted = extractTokens(token);
    const payload = decodeJwtPayload(extracted.accessToken) || {};
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = Math.max(
      1,
      extracted.expiresIn ||
        (extracted.expiresAt ? Math.floor(Date.parse(extracted.expiresAt) / 1000) - now : 0) ||
        (typeof payload.exp === "number" ? payload.exp - now : 0) ||
        21600
    );
    const principalType = typeof payload.principal_type === "string" ? payload.principal_type : "";
    const principalId = typeof payload.principal_id === "string" ? payload.principal_id : "";
    const email = typeof payload.email === "string" ? payload.email : null;
    const isSharedPrincipal = ["team", "organization"].includes(principalType.toLowerCase());

    return {
      accessToken: extracted.accessToken,
      refreshToken: extracted.refreshToken,
      expiresIn,
      email,
      name: email,
      providerSpecificData: {
        userId:
          isSharedPrincipal && principalId
            ? principalId
            : typeof payload.sub === "string"
              ? payload.sub
              : null,
        email,
        teamId: typeof payload.team_id === "string" ? payload.team_id : null,
        tier: typeof payload.tier === "number" ? payload.tier : 1,
        principalType: principalType || null,
        principalId: principalId || null,
      },
    };
  },
};
