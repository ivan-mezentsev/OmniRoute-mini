"use client";

import { useTranslations } from "next-intl";

import Modal from "@/shared/components/Modal";
import { translateUsageOrFallback } from "./i18nFallback";

export interface ResetCreditView {
  selectionToken: string;
  expiresAt: string | null;
}

interface Props {
  isOpen: boolean;
  credits: ResetCreditView[];
  availableCount: number;
  loading: boolean;
  onClose: () => void;
  onRedeem: (selectionToken: string) => void;
}

export default function ResetCreditsModal({
  isOpen,
  credits,
  availableCount,
  loading,
  onClose,
  onRedeem,
}: Props) {
  const t = useTranslations("usage");
  const tr = (key: string, fallback: string) => translateUsageOrFallback(t, key, fallback);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={tr("resetCreditsLabel", "Reset credits")}
      size="sm"
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-muted">
          {availableCount === 1
            ? tr("oneResetCreditAvailable", "1 reset credit is available.")
            : tr("resetCreditsAvailable", `${availableCount} reset credits are available.`)}
        </p>
        {credits.length === 0 ? (
          <div className="rounded-lg border border-border bg-bg-subtle p-3 text-sm text-text-muted">
            {tr("noResetCreditsAvailable", "No reset credits are currently available.")}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {credits.map((credit, index) => (
              <div
                key={credit.selectionToken}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-subtle p-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text-main">
                    {tr("resetCreditItem", "Reset credit")} {index + 1}
                  </div>
                  <div className="mt-0.5 text-xs text-text-muted">
                    {credit.expiresAt
                      ? `${tr("expires", "Expires")} ${new Date(credit.expiresAt).toLocaleString()}`
                      : tr("noExpiryReported", "No expiry reported")}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => onRedeem(credit.selectionToken)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading && (
                    <span className="material-symbols-outlined animate-spin text-[13px]">
                      progress_activity
                    </span>
                  )}
                  {tr("applyResetCredit", "Apply")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
