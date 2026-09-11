"use client";

import { useCallback, useRef, useState } from "react";

import { useNotificationStore } from "@/store/notificationStore";
import { parseQuotaData } from "./utils";
import type { ResetCreditView } from "./ResetCreditsModal";

interface ResetCreditPicker {
  connectionId: string;
  provider: string;
  credits: ResetCreditView[];
  availableCount: number;
}

function responseError(data: any, fallback: string): string {
  return data?.error?.message || data?.error || fallback;
}

export function useResetCredits(
  setErrors: React.Dispatch<React.SetStateAction<Record<string, string | null>>>,
  setQuotaData: React.Dispatch<React.SetStateAction<Record<string, any>>>,
  setLastRefreshedAt: React.Dispatch<React.SetStateAction<Record<string, string>>>
) {
  const notify = useNotificationStore();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [redeemingId, setRedeemingId] = useState<string | null>(null);
  const [picker, setPicker] = useState<ResetCreditPicker | null>(null);
  const idempotencyKeys = useRef<Record<string, string>>({});

  const open = useCallback(
    async (connectionId: string, provider: string) => {
      if (loadingId || redeemingId) return;
      setLoadingId(connectionId);
      setErrors((previous) => ({ ...previous, [connectionId]: null }));
      try {
        const response = await fetch(
          `/api/usage/reset-credits?connectionId=${encodeURIComponent(connectionId)}`,
          { cache: "no-store" }
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(responseError(data, "Failed to load reset credits."));
        setPicker({
          connectionId,
          provider,
          credits: Array.isArray(data.credits) ? data.credits : [],
          availableCount: Number.isFinite(Number(data.availableCount))
            ? Number(data.availableCount)
            : 0,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load reset credits.";
        setErrors((previous) => ({ ...previous, [connectionId]: message }));
        notify.error(message);
      } finally {
        setLoadingId(null);
      }
    },
    [loadingId, notify, redeemingId, setErrors]
  );

  const redeem = useCallback(
    async (selectionToken: string) => {
      if (!picker || redeemingId || !selectionToken) return;
      const idempotencyScope = `${picker.connectionId}:${selectionToken}`;
      const idempotencyKey =
        idempotencyKeys.current[idempotencyScope] ||
        (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
      idempotencyKeys.current[idempotencyScope] = idempotencyKey;
      setRedeemingId(picker.connectionId);
      setErrors((previous) => ({ ...previous, [picker.connectionId]: null }));
      try {
        const response = await fetch("/api/usage/reset-credits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            connectionId: picker.connectionId,
            selectionToken,
            idempotencyKey,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(responseError(data, "Failed to apply reset credit."));
        const usage = data.usage || {};
        setQuotaData((previous) => ({
          ...previous,
          [picker.connectionId]: {
            quotas: parseQuotaData(picker.provider, usage),
            plan: usage.plan || null,
            message: usage.message || null,
            raw: usage,
          },
        }));
        setLastRefreshedAt((previous) => ({
          ...previous,
          [picker.connectionId]: new Date().toISOString(),
        }));
        delete idempotencyKeys.current[idempotencyScope];
        setPicker(null);
        notify.success(
          data.outcome === "alreadyRedeemed"
            ? "Reset credit was already applied."
            : "Reset credit applied."
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to apply reset credit.";
        setErrors((previous) => ({ ...previous, [picker.connectionId]: message }));
        notify.error(message);
      } finally {
        setRedeemingId(null);
      }
    },
    [notify, picker, redeemingId, setErrors, setLastRefreshedAt, setQuotaData]
  );

  return {
    close: () => setPicker(null),
    loadingId,
    open,
    picker,
    redeem,
    redeemingId,
  };
}
