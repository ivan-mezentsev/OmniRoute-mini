import { getGrokBuildClientHeaders } from "../config/grokBuild.ts";
import { decodeGrokCreditsFrame } from "./grokCliQuotaFrame.ts";

export const GROK_BUILD_BILLING_URL =
  "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig";

const GRPC_WEB_EMPTY_REQUEST_FRAME = Buffer.from([0, 0, 0, 0, 0]);

export interface GrokCliQuota {
  used: number;
  total: number;
  remaining: number;
  remainingPercentage: number;
  resetAt: string | null;
  unlimited: false;
}

export async function fetchGrokCliQuota(accessToken: string): Promise<GrokCliQuota | null> {
  const token = typeof accessToken === "string" ? accessToken.trim() : "";
  if (!token) return null;

  try {
    const response = await fetch(GROK_BUILD_BILLING_URL, {
      method: "POST",
      headers: {
        ...getGrokBuildClientHeaders("headless"),
        Authorization: `Bearer ${token}`,
        Accept: "application/grpc-web+proto",
        "Content-Type": "application/grpc-web+proto",
        "X-Grpc-Web": "1",
      },
      body: GRPC_WEB_EMPTY_REQUEST_FRAME,
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) return null;
    const decoded = decodeGrokCreditsFrame(Buffer.from(await response.arrayBuffer()));
    if (!decoded) return null;

    const used = Math.max(0, Math.min(100, decoded.percentUsed));
    return {
      used,
      total: 100,
      remaining: Math.max(0, 100 - used),
      remainingPercentage: Math.max(0, 100 - used),
      resetAt: decoded.resetAt,
      unlimited: false,
    };
  } catch {
    return null;
  }
}
