"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { CurrencyCode, HistoryChartMode, HistoryGroupBy, HistoryRangePreset, ThemePreference } from "@/lib/types";

export function HistoryTopCountControl({
  initialValue,
  groupBy,
  chartMode,
  rangePreset,
  startDate,
  endDate,
  displayCurrency,
  themePreference,
  compact = false,
}: {
  initialValue: number;
  groupBy: HistoryGroupBy;
  chartMode: HistoryChartMode;
  rangePreset: HistoryRangePreset;
  startDate?: string;
  endDate?: string;
  displayCurrency: CurrencyCode;
  themePreference: ThemePreference;
  compact?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(String(initialValue));

  useEffect(() => {
    setValue(String(initialValue));
  }, [initialValue]);

  useEffect(() => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 50) {
      return;
    }

    const nextValue = Math.max(1, Math.min(50, parsed));
    if (nextValue === initialValue) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void persistTopCountPreference({
        displayCurrency,
        themePreference,
        historyTopAssetCount: nextValue,
      });
      router.replace(
        buildHistoryTopCountHref({
          pathname,
          groupBy,
          chartMode,
          rangePreset,
          startDate,
          endDate,
          topAssetCount: nextValue,
        }),
        { scroll: false },
      );
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [
    chartMode,
    displayCurrency,
    endDate,
    groupBy,
    initialValue,
    pathname,
    rangePreset,
    router,
    startDate,
    themePreference,
    value,
  ]);

  return (
    <label className={`af-text-muted text-sm ${compact ? "inline-flex items-center gap-2" : "grid gap-2"}`}>
      {compact ? <span>显示资产数</span> : null}
      <input
        type="number"
        min={1}
        max={50}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className={`af-input rounded-2xl ${compact ? "w-20 px-3 py-2 text-center" : "px-4 py-3"}`}
      />
    </label>
  );
}

function persistTopCountPreference({
  displayCurrency,
  themePreference,
  historyTopAssetCount,
}: {
  displayCurrency: CurrencyCode;
  themePreference: ThemePreference;
  historyTopAssetCount: number;
}) {
  return fetch("/api/settings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      displayCurrency,
      themePreference,
      historyTopAssetCount,
    }),
  }).catch(() => undefined);
}

function buildHistoryTopCountHref({
  pathname,
  groupBy,
  chartMode,
  rangePreset,
  startDate,
  endDate,
  topAssetCount,
}: {
  pathname: string;
  groupBy: HistoryGroupBy;
  chartMode: HistoryChartMode;
  rangePreset: HistoryRangePreset;
  startDate?: string;
  endDate?: string;
  topAssetCount: number;
}) {
  const params = new URLSearchParams();
  params.set("groupBy", groupBy);
  params.set("chart", chartMode);
  params.set("top", String(topAssetCount));

  if (startDate && endDate && startDate <= endDate) {
    params.set("start", startDate);
    params.set("end", endDate);
  } else {
    params.set("range", rangePreset);
  }

  return `${pathname}?${params.toString()}`;
}
