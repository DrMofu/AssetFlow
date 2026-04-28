"use client";

import { useRef, useState } from "react";

import { SensitiveValue } from "@/components/app-preferences";
import type { CalendarDayContributor } from "@/lib/portfolio";
import type { CurrencyCode } from "@/lib/types";
import { formatCompactCurrency } from "@/lib/utils";

const MONTH_LABELS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

type TooltipState = {
  key: string;
  contributors: CalendarDayContributor[];
  x: number;
  y: number;
  side: "left" | "right";
};

function getCellTone(change: number | null | undefined, maxAbsChange: number) {
  if (change == null) {
    return {
      background: "transparent",
      border: "1px dashed color-mix(in srgb, var(--border-color) 60%, transparent)",
    };
  }
  if (Math.abs(change) < 0.005 || maxAbsChange <= 0) {
    return {
      background: "var(--surface-bg-muted)",
      border: "1px solid color-mix(in srgb, var(--border-color) 80%, transparent)",
    };
  }
  const intensity = Math.min(Math.abs(change) / maxAbsChange, 1);
  const alpha = 0.15 + intensity * 0.45;
  const borderAlpha = 0.2 + intensity * 0.3;
  if (change > 0) {
    return {
      background: `rgba(var(--up-cell-rgb), ${alpha})`,
      border: `1px solid rgba(var(--up-cell-border-rgb), ${borderAlpha})`,
    };
  }
  return {
    background: `rgba(var(--down-cell-rgb), ${alpha})`,
    border: `1px solid rgba(var(--down-cell-border-rgb), ${borderAlpha})`,
  };
}

export function MonthlyReturnsGrid({
  years,
  cellMap,
  breakdown,
  currency,
}: {
  years: number[];
  cellMap: Map<string, number | null>;
  breakdown: Map<string, CalendarDayContributor[]>;
  currency: CurrencyCode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const maxAbsChange = [...cellMap.values()].reduce<number>((max, change) => {
    if (change == null) return max;
    return Math.max(max, Math.abs(change));
  }, 0);

  const dividerStyle = { borderColor: "color-mix(in srgb, var(--border-color) 55%, transparent)" } as const;

  function handleMouseEnter(key: string, event: React.MouseEvent<HTMLDivElement>) {
    const contributors = breakdown.get(key);
    if (!contributors?.length) {
      setTooltip(null);
      return;
    }
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const cellRect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const relX = cellRect.left - containerRect.left + cellRect.width / 2;
    const relY = cellRect.bottom - containerRect.top;
    const side = relX < containerRect.width / 2 ? "right" : "left";
    setTooltip({ key, contributors, x: relX, y: relY, side });
  }

  return (
    <section className="af-card rounded-[34px] p-6">
      <header className="mb-5 border-b pb-5" style={dividerStyle}>
        <p className="af-text-muted text-[11px] font-semibold uppercase tracking-[0.28em]">月度收益</p>
        <h3 className="mt-2 text-2xl font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
          历史月度收益
        </h3>
      </header>

      {/* Outer relative div for tooltip positioning — no overflow clipping here */}
      <div
        ref={containerRef}
        className="relative"
        onMouseLeave={() => setTooltip(null)}
      >
        {/* Scrollable content container */}
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            <div className="mb-1.5 grid grid-cols-[3rem_repeat(12,minmax(0,1fr))] gap-1">
              <div />
              {MONTH_LABELS.map((label) => (
                <div
                  key={label}
                  className="text-center text-[10px] font-semibold tracking-[0.06em]"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {label}
                </div>
              ))}
            </div>

            {years.map((year) => (
              <div key={year} className="mb-1 grid grid-cols-[3rem_repeat(12,minmax(0,1fr))] gap-1">
                <div
                  className="flex items-center justify-end pr-2 text-xs font-semibold tabular-nums"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {year}
                </div>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
                  const key = `${year}-${String(month).padStart(2, "0")}`;
                  const change = cellMap.get(key) ?? null;
                  const tone = getCellTone(change, maxAbsChange);
                  const hasBreakdown = breakdown.has(key);
                  const isActive = tooltip?.key === key;

                  return (
                    <div
                      key={month}
                      className="flex flex-col items-center justify-center rounded-[8px] px-0.5 py-2 transition-colors"
                      style={{
                        ...tone,
                        minHeight: "3rem",
                        boxShadow: isActive
                          ? "0 0 0 2px color-mix(in srgb, var(--text-primary) 50%, transparent)"
                          : "none",
                        cursor: hasBreakdown ? "default" : undefined,
                      }}
                      onMouseEnter={(e) => {
                        if (change != null) handleMouseEnter(key, e);
                      }}
                    >
                      {change != null && Math.abs(change) >= 0.005 ? (
                        <SensitiveValue
                          value={`${change >= 0 ? "+" : ""}${formatCompactCurrency(change, currency)}`}
                          className={`block text-center text-[11px] font-semibold tabular-nums leading-tight ${
                            change >= 0 ? "af-text-up" : "af-text-down"
                          }`}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Tooltip rendered outside overflow container, within the relative positioning context */}
        {tooltip ? <MonthlyTooltip tooltip={tooltip} currency={currency} /> : null}
      </div>
    </section>
  );
}

function MonthlyTooltip({
  tooltip,
  currency,
}: {
  tooltip: TooltipState;
  currency: CurrencyCode;
}) {
  const TOOLTIP_WIDTH = 224;
  const OFFSET_Y = 8;
  const left = tooltip.side === "right" ? tooltip.x + 8 : tooltip.x - TOOLTIP_WIDTH - 8;

  return (
    <div
      className="pointer-events-none absolute z-20 rounded-2xl border p-3 shadow-xl backdrop-blur-sm"
      style={{
        top: tooltip.y + OFFSET_Y,
        left,
        width: TOOLTIP_WIDTH,
        background: "color-mix(in srgb, var(--surface-bg) 88%, transparent)",
        borderColor: "color-mix(in srgb, var(--border-color) 120%, transparent)",
      }}
    >
      <p
        className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em]"
        style={{ color: "var(--text-secondary)" }}
      >
        本月主要变化来源
      </p>
      <ul className="space-y-1.5">
        {tooltip.contributors.map((c) => (
          <li key={c.assetId} className="flex items-center justify-between gap-2">
            <span
              className="min-w-0 truncate text-[13px] font-medium"
              style={{ color: "var(--text-primary)" }}
            >
              {c.symbol ?? c.name}
            </span>
            <SensitiveValue
              value={`${c.change >= 0 ? "+" : ""}${formatCompactCurrency(c.change, currency)}`}
              className={`shrink-0 text-[13px] font-semibold tabular-nums ${
                c.change >= 0 ? "af-text-up" : "af-text-down"
              }`}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
