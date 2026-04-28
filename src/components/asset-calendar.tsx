"use client";

import { format, parseISO } from "date-fns";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { SensitiveValue } from "@/components/app-preferences";
import type { CalendarDayContributor } from "@/lib/portfolio";
import type { CurrencyCode } from "@/lib/types";
import { formatCompactCurrency } from "@/lib/utils";

type AssetCalendarDay = {
  date: string;
  inCurrentMonth: boolean;
  isToday: boolean;
  change?: number;
  changeLabel?: string;
};

type TooltipState = {
  date: string;
  contributors: CalendarDayContributor[];
  x: number;
  y: number;
  side: "left" | "right";
};

const WEEKDAY_LABELS: Array<{ label: string; weekend: boolean }> = [
  { label: "一", weekend: false },
  { label: "二", weekend: false },
  { label: "三", weekend: false },
  { label: "四", weekend: false },
  { label: "五", weekend: false },
  { label: "六", weekend: true },
  { label: "日", weekend: true },
];


function getCalendarCellTone(change: number | undefined, maxAbsChange: number) {
  if (change == null) {
    return {
      background: "transparent",
      border: "1px dashed color-mix(in srgb, var(--border-color) 75%, transparent)",
    };
  }

  if (Math.abs(change) < 0.005 || maxAbsChange <= 0) {
    return {
      background: "var(--surface-bg-muted)",
      border: "1px solid color-mix(in srgb, var(--border-color) 80%, transparent)",
    };
  }

  const intensity = Math.min(Math.abs(change) / maxAbsChange, 1);
  const alpha = 0.18 + intensity * 0.42;
  const borderAlpha = 0.22 + intensity * 0.32;

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

export function AssetCalendar({
  monthLabel,
  days,
  breakdown,
  currency,
  previousMonthHref,
  nextMonthHref,
  todayCalendarHref,
}: {
  monthLabel: string;
  days: AssetCalendarDay[];
  breakdown: Map<string, CalendarDayContributor[]>;
  currency: CurrencyCode;
  previousMonthHref: string;
  nextMonthHref: string;
  todayCalendarHref: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [showMonthlyTooltip, setShowMonthlyTooltip] = useState(false);

  const maxAbsChange = days.reduce((maxValue, day) => {
    if (day.change == null) return maxValue;
    return Math.max(maxValue, Math.abs(day.change));
  }, 0);

  const monthlyChange = days.reduce((sum, day) => {
    if (!day.inCurrentMonth || day.change == null) return sum;
    return sum + day.change;
  }, 0);
  const hasMonthlyChange = days.some((d) => d.inCurrentMonth && d.change != null);

  const monthlyContributors = useMemo(() => {
    const totals = new Map<string, CalendarDayContributor & { change: number }>();
    for (const day of days) {
      if (!day.inCurrentMonth) continue;
      for (const c of breakdown.get(day.date) ?? []) {
        const existing = totals.get(c.assetId);
        if (existing) {
          existing.change += c.change;
        } else {
          totals.set(c.assetId, { ...c });
        }
      }
    }
    return [...totals.values()]
      .filter((c) => Math.abs(c.change) >= 0.005)
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
      .slice(0, 8);
  }, [days, breakdown]);

  const dividerStyle = { borderColor: "color-mix(in srgb, var(--border-color) 55%, transparent)" } as const;

  function handleMouseEnter(day: AssetCalendarDay, event: React.MouseEvent<HTMLDivElement>) {
    if (!day.changeLabel || day.changeLabel === "持平") {
      setTooltip(null);
      return;
    }
    const contributors = breakdown.get(day.date);
    if (!contributors?.length) return;

    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const cellRect = (event.currentTarget as HTMLElement).getBoundingClientRect();

    const relX = cellRect.left - containerRect.left + cellRect.width / 2;
    const relY = cellRect.bottom - containerRect.top;
    const side = relX < containerRect.width / 2 ? "right" : "left";

    setTooltip({ date: day.date, contributors, x: relX, y: relY, side });
  }

  return (
    <section className="af-card flex h-[48rem] flex-col rounded-[34px] p-6">
      <header className="mb-5 flex items-end justify-between gap-4 border-b pb-5" style={dividerStyle}>
        <div>
          <p className="af-text-muted text-[11px] font-semibold uppercase tracking-[0.28em]">资产日历</p>
          <div className="mt-2 flex items-baseline gap-3">
            <h3 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
              {monthLabel}
            </h3>
            {hasMonthlyChange ? (
              <div
                className="relative"
                onMouseEnter={() => setShowMonthlyTooltip(true)}
                onMouseLeave={() => setShowMonthlyTooltip(false)}
              >
                <SensitiveValue
                  value={`${monthlyChange >= 0 ? "+" : ""}${formatCompactCurrency(monthlyChange, currency)}`}
                  className={`cursor-default text-xl font-semibold tabular-nums ${monthlyChange >= 0 ? "af-text-up" : "af-text-down"}`}
                />
                {showMonthlyTooltip && monthlyContributors.length > 0 ? (
                  <div
                    className="pointer-events-none absolute left-0 top-full z-20 mt-2 rounded-2xl border p-3 shadow-xl backdrop-blur-sm"
                    style={{
                      width: 224,
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
                      {monthlyContributors.map((c) => (
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
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {todayCalendarHref ? (
            <Link
              href={todayCalendarHref}
              scroll={false}
              className="af-button-secondary inline-flex h-9 items-center justify-center rounded-full px-3 text-xs font-semibold"
              aria-label="返回本月"
              title="返回本月"
            >
              今天
            </Link>
          ) : null}
          <Link
            href={previousMonthHref}
            scroll={false}
            className="af-button-secondary inline-flex h-9 w-9 items-center justify-center rounded-full p-0 text-base"
            aria-label="查看上一个月"
            title="查看上一个月"
          >
            ‹
          </Link>
          <Link
            href={nextMonthHref}
            scroll={false}
            className="af-button-secondary inline-flex h-9 w-9 items-center justify-center rounded-full p-0 text-base"
            aria-label="查看下一个月"
            title="查看下一个月"
          >
            ›
          </Link>
        </div>
      </header>

      <div className="mb-3 grid grid-cols-7 gap-1.5 border-b pb-3" style={dividerStyle}>
        {WEEKDAY_LABELS.map(({ label, weekend }) => (
          <div
            key={label}
            className="text-center text-[10px] font-semibold uppercase tracking-[0.22em]"
            style={{ color: weekend ? "var(--text-secondary)" : "var(--text-muted)" }}
          >
            周{label}
          </div>
        ))}
      </div>

      <div
        ref={containerRef}
        className="relative grid min-h-0 flex-1 grid-cols-7 gap-1.5"
        onMouseLeave={() => setTooltip(null)}
      >
        {days.map((day) => {
          const dayDate = parseISO(`${day.date}T00:00:00`);
          const dayOfWeek = dayDate.getDay();
          const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
          const tone = getCalendarCellTone(day.change, maxAbsChange);
          const hasTooltipData =
            day.changeLabel != null && day.changeLabel !== "持平" && breakdown.has(day.date);

          return (
            <div
              key={day.date}
              className="relative flex aspect-square min-h-0 flex-col justify-between rounded-[18px] p-2.5 transition-colors"
              style={{
                ...tone,
                opacity: day.inCurrentMonth ? 1 : 0.4,
                boxShadow:
                  tooltip?.date === day.date
                    ? "0 0 0 2.5px color-mix(in srgb, var(--text-primary) 55%, transparent), 0 6px 18px -10px color-mix(in srgb, var(--text-primary) 30%, transparent)"
                    : day.isToday
                      ? "0 0 0 2px color-mix(in srgb, var(--text-primary) 60%, transparent), 0 6px 16px -10px color-mix(in srgb, var(--text-primary) 35%, transparent)"
                      : "none",
                cursor: hasTooltipData ? "default" : undefined,
              }}
              onMouseEnter={(e) => handleMouseEnter(day, e)}
            >
              <div className="flex items-start justify-between gap-1">
                <p
                  className="text-[15px] font-semibold leading-none tabular-nums"
                  style={{
                    color: !day.inCurrentMonth
                      ? "var(--text-muted)"
                      : isWeekend
                        ? "var(--text-secondary)"
                        : "var(--text-primary)",
                  }}
                >
                  {format(dayDate, "d")}
                </p>
                {day.isToday ? (
                  <span
                    className="rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-[0.12em]"
                    style={{
                      borderColor: "color-mix(in srgb, var(--text-primary) 35%, transparent)",
                      color: "var(--text-primary)",
                      background: "color-mix(in srgb, var(--text-primary) 8%, transparent)",
                    }}
                  >
                    今天
                  </span>
                ) : null}
              </div>

              <div className="min-h-[1.25rem]">
                {day.changeLabel == null ? (
                  <span
                    aria-hidden
                    className="block h-1 w-1 rounded-full"
                    style={{ background: "color-mix(in srgb, var(--text-muted) 55%, transparent)" }}
                  />
                ) : day.changeLabel === "持平" ? (
                  <span className="af-text-muted text-[11px] font-medium tabular-nums">持平</span>
                ) : (
                  <SensitiveValue
                    value={day.changeLabel}
                    className={`block text-[13px] font-semibold tabular-nums leading-tight ${
                      (day.change ?? 0) > 0 ? "af-text-up" : "af-text-down"
                    }`}
                  />
                )}
              </div>
            </div>
          );
        })}

        {tooltip ? (
          <CalendarTooltip tooltip={tooltip} currency={currency} />
        ) : null}
      </div>
    </section>
  );
}

function CalendarTooltip({
  tooltip,
  currency,
}: {
  tooltip: TooltipState;
  currency: CurrencyCode;
}) {
  const TOOLTIP_WIDTH = 224;
  const OFFSET_Y = 8;

  const left =
    tooltip.side === "right"
      ? tooltip.x + 8
      : tooltip.x - TOOLTIP_WIDTH - 8;

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
        主要变化来源
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
