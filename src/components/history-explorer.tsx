"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  PlainHistoryLineChart,
  StackedBoundaryHistoryChart,
  TrendAreaChart,
} from "@/components/charts";
import { HistoryTopCountControl } from "@/components/history-top-count-control";
import {
  HISTORY_CHART_MODE_LABELS,
  HISTORY_CHART_MODE_OPTIONS,
  HISTORY_GROUP_LABELS,
  HISTORY_GROUP_OPTIONS,
  HISTORY_RANGE_PRESET_LABELS,
  HISTORY_RANGE_PRESET_OPTIONS,
} from "@/lib/constants";
import type {
  CurrencyCode,
  HistoryChartMode,
  HistoryGroupBy,
  HistoryRangePreset,
  ThemePreference,
} from "@/lib/types";
import { formatCalendarDateLabel } from "@/lib/utils";

function buildHistoryHref(
  basePath: string,
  options: {
    groupBy: HistoryGroupBy;
    chartMode: HistoryChartMode;
    rangePreset?: HistoryRangePreset;
    startDate?: string;
    endDate?: string;
    topAssetCount?: number;
  },
) {
  const params = new URLSearchParams();
  params.set("groupBy", options.groupBy);
  if (options.rangePreset) {
    params.set("range", options.rangePreset);
  }

  if (options.groupBy !== "total") {
    params.set("chart", options.chartMode);
  }

  if (options.startDate && options.endDate && options.startDate <= options.endDate) {
    params.set("start", options.startDate);
    params.set("end", options.endDate);
  }

  if (options.groupBy === "asset" && options.topAssetCount) {
    params.set("top", String(options.topAssetCount));
  }

  return `${basePath}?${params.toString()}`;
}

function buildActiveRangeOptions(options: {
  hasCustomRange: boolean;
  rangePreset: HistoryRangePreset;
  startDate: string;
  endDate: string;
}) {
  return options.hasCustomRange
    ? {
        startDate: options.startDate,
        endDate: options.endDate,
      }
    : {
        rangePreset: options.rangePreset,
      };
}

function normalizeSelectionRange(startDate: string, endDate: string) {
  return startDate <= endDate
    ? { startDate, endDate }
    : { startDate: endDate, endDate: startDate };
}

function formatSelectionLabel(value: string) {
  return formatCalendarDateLabel(value);
}

export function HistoryExplorer({
  basePath,
  groupBy,
  chartMode,
  rangePreset,
  startDate,
  endDate,
  topAssetCount,
  displayCurrency,
  themePreference,
  data,
}: {
  basePath: string;
  groupBy: HistoryGroupBy;
  chartMode: HistoryChartMode;
  rangePreset: HistoryRangePreset;
  startDate: string;
  endDate: string;
  topAssetCount: number;
  displayCurrency: CurrencyCode;
  themePreference: ThemePreference;
  data: Array<Record<string, string | number>>;
}) {
  const router = useRouter();
  const chartAreaRef = useRef<HTMLDivElement | null>(null);
  const selectionVersion = `${groupBy}|${chartMode}|${rangePreset}|${startDate}|${endDate}|${topAssetCount}`;
  const [draftSelection, setDraftSelection] = useState<{
    version: string;
    startDate: string | null;
    hoverDate: string | null;
  }>({
    version: selectionVersion,
    startDate: null,
    hoverDate: null,
  });

  const hasCustomRange = Boolean(startDate && endDate && startDate <= endDate);
  const activeTopAssetCount = groupBy === "asset" ? topAssetCount : undefined;
  const activeRangeOptions = buildActiveRangeOptions({
    hasCustomRange,
    rangePreset,
    startDate,
    endDate,
  });

  const activeDraftSelection =
    draftSelection.version === selectionVersion
      ? draftSelection
      : {
          version: selectionVersion,
          startDate: null,
          hoverDate: null,
        };

  const selection = useMemo(() => {
    if (activeDraftSelection.startDate) {
      return {
        startDate: activeDraftSelection.startDate,
        endDate: activeDraftSelection.hoverDate ?? activeDraftSelection.startDate,
      };
    }

    return undefined;
  }, [activeDraftSelection.hoverDate, activeDraftSelection.startDate]);

  function handleDateClick(date: string) {
    if (!date) {
      return;
    }

    if (!activeDraftSelection.startDate) {
      setDraftSelection({
        version: selectionVersion,
        startDate: date,
        hoverDate: date,
      });
      return;
    }

    const nextRange = normalizeSelectionRange(activeDraftSelection.startDate, date);
    setDraftSelection({
      version: selectionVersion,
      startDate: null,
      hoverDate: null,
    });
    router.replace(
      buildHistoryHref(basePath, {
        groupBy,
        chartMode,
        rangePreset,
        startDate: nextRange.startDate,
        endDate: nextRange.endDate,
        topAssetCount: activeTopAssetCount,
      }),
      { scroll: false },
    );
  }

  function handleHoverDate(date?: string) {
    if (!activeDraftSelection.startDate) {
      return;
    }

    setDraftSelection({
      version: selectionVersion,
      startDate: activeDraftSelection.startDate,
      hoverDate: date ?? null,
    });
  }

  useEffect(() => {
    if (!activeDraftSelection.startDate) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (chartAreaRef.current?.contains(target)) {
        return;
      }

      setDraftSelection({
        version: selectionVersion,
        startDate: null,
        hoverDate: null,
      });
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [activeDraftSelection.startDate, selectionVersion]);

  return (
    <div className="grid h-full grid-rows-[auto_auto_minmax(0,1fr)] gap-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {HISTORY_GROUP_OPTIONS.map((item) => (
              <Link
                key={item}
                href={buildHistoryHref(basePath, {
                  groupBy: item,
                  chartMode,
                  ...activeRangeOptions,
                  topAssetCount: item === "asset" || groupBy === "asset" ? topAssetCount : undefined,
                })}
                scroll={false}
                className={`rounded-full px-4 py-2 text-sm font-medium ${
                  groupBy === item ? "af-button-active" : "af-button-secondary af-text-muted"
                }`}
              >
                {HISTORY_GROUP_LABELS[item]}
              </Link>
            ))}

            {groupBy === "asset" ? (
              <HistoryTopCountControl
                initialValue={topAssetCount}
                groupBy={groupBy}
                chartMode={chartMode}
                rangePreset={rangePreset}
                startDate={hasCustomRange ? startDate : undefined}
                endDate={hasCustomRange ? endDate : undefined}
                displayCurrency={displayCurrency}
                themePreference={themePreference}
                compact
              />
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-4 pl-2">
            {HISTORY_RANGE_PRESET_OPTIONS.map((item) => (
              <Link
                key={item}
                href={buildHistoryHref(basePath, {
                  groupBy,
                  chartMode,
                  rangePreset: item,
                  topAssetCount: activeTopAssetCount,
                })}
                scroll={false}
                className="px-0.5 py-0.5 text-sm font-semibold tracking-[0.12em] transition-colors"
                style={{
                  color:
                    !hasCustomRange && rangePreset === item
                      ? "var(--text-primary)"
                      : "var(--text-secondary)",
                }}
              >
                {HISTORY_RANGE_PRESET_LABELS[item]}
              </Link>
            ))}

            {hasCustomRange ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="af-text-muted text-sm font-medium">
                  {formatSelectionLabel(startDate)} - {formatSelectionLabel(endDate)}
                </span>
                <Link
                  href={buildHistoryHref(basePath, {
                    groupBy,
                    chartMode,
                    rangePreset,
                    topAssetCount: activeTopAssetCount,
                  })}
                  scroll={false}
                  className="rounded-full px-2.5 py-1 text-xs font-semibold af-button-secondary"
                >
                  取消
                </Link>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col items-start gap-3 xl:items-end">
          <div
            className="af-card-soft inline-flex rounded-full p-1"
            style={{ background: "var(--surface-bg-soft)" }}
          >
            {groupBy !== "total" ? (
              HISTORY_CHART_MODE_OPTIONS.map((item) => (
                <Link
                  key={item}
                  href={buildHistoryHref(basePath, {
                    groupBy,
                    chartMode: item,
                    ...activeRangeOptions,
                    topAssetCount: activeTopAssetCount,
                  })}
                  scroll={false}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    chartMode === item ? "af-button-active" : "af-text-muted"
                  }`}
                >
                  {HISTORY_CHART_MODE_LABELS[item]}
                </Link>
              ))
            ) : (
              <span className="rounded-full px-4 py-2 text-sm font-medium af-button-active">
                总资产趋势线
              </span>
            )}
          </div>
        </div>
      </div>

      <div
        ref={chartAreaRef}
        className="min-h-0 flex items-center justify-center py-4"
        style={{ borderTop: "1px solid var(--border-color)" }}
      >
        {groupBy === "total" ? (
          <TrendAreaChart
            data={data as Array<{ date: string; total: number }>}
            currency={displayCurrency}
            selection={{
              ...selection,
              onDateClick: handleDateClick,
              onHoverDate: handleHoverDate,
            }}
          />
        ) : chartMode === "stacked" ? (
          <StackedBoundaryHistoryChart
            data={data}
            currency={displayCurrency}
            colorMode={groupBy === "type" ? "type" : "generic"}
            selection={{
              ...selection,
              onDateClick: handleDateClick,
              onHoverDate: handleHoverDate,
            }}
          />
        ) : (
          <PlainHistoryLineChart
            data={data}
            currency={displayCurrency}
            colorMode={groupBy === "type" ? "type" : "generic"}
            selection={{
              ...selection,
              onDateClick: handleDateClick,
              onHoverDate: handleHoverDate,
            }}
          />
        )}
      </div>
    </div>
  );
}
