import { z } from "zod";

import { createErrorResponse } from "@/lib/api/errorResponse";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { listResetCredits, redeemResetCredit, ResetCreditError } from "@/lib/usage/resetCredits";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error.ts";

const connectionIdSchema = z.string().trim().min(1).max(256);
const redeemSchema = z.object({
  connectionId: connectionIdSchema,
  selectionToken: z.string().trim().min(1).max(512),
  idempotencyKey: z.string().trim().min(1).max(256),
});

function errorResponse(error: unknown): Response {
  const known = error instanceof ResetCreditError;
  return createErrorResponse({
    status: known ? error.status : 500,
    message: known
      ? sanitizeErrorMessage(error.message) || "Reset-credit request failed."
      : "Reset-credit request failed.",
    type: known && error.status === 409 ? "conflict" : undefined,
    details: known ? { code: error.code } : undefined,
  });
}

export async function GET(request: Request): Promise<Response> {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  const parsed = connectionIdSchema.safeParse(
    new URL(request.url).searchParams.get("connectionId")
  );
  if (!parsed.success) {
    return createErrorResponse({ status: 400, message: "Invalid connectionId." });
  }

  try {
    return Response.json({ ok: true, ...(await listResetCredits(parsed.data)) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  const parsed = redeemSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return createErrorResponse({ status: 400, message: "Invalid reset-credit request." });
  }

  try {
    return Response.json({
      ok: true,
      ...(await redeemResetCredit(
        parsed.data.connectionId,
        parsed.data.selectionToken,
        parsed.data.idempotencyKey
      )),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
