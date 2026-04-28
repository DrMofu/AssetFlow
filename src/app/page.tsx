import Link from "next/link";
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subDays,
} from "date-fns";

import { SensitiveValue } from "@/components/app-preferences";
import { AssetCalendar } from "@/components/asset-calendar";
import { AllocationPieChart, FxTrendLineChart } from "@/components/charts";
import { MonthlyReturnsGrid } from "@/components/monthly-returns-grid";
import { HistoryExplorer } from "@/components/history-explorer";
import {
  HISTORY_CHART_MODE_OPTIONS,
  HISTORY_GROUP_LABELS,
  HISTORY_GROUP_OPTIONS,
  HISTORY_RANGE_PRESET_OPTIONS,
  ASSET_TYPE_LABELS,
} from "@/lib/constants";
import { getDashboardData, getHistoryData, getCalendarBreakdown } from "@/lib/portfolio";
import { getRepository } from "@/lib/repository";
import type { CalendarDayContributor } from "@/lib/portfolio";
import type {
  CurrencyCode,
  HistoryChartMode,
  HistoryGroupBy,
  HistoryRangePreset,
} from "@/lib/types";
import {
  formatCompactCurrency,
  formatCurrency,
  formatCalendarDateLabel,
  formatDelta,
  formatPercent,
} from "@/lib/utils";

export const dynamic = "force-dynamic";

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatShareQuantity(value?: number | null) {
  if (value == null) return "0";

  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function buildDashboardHref(
  params: Record<string, string | string[] | undefined>,
  updates: Record<string, string | undefined>,
) {
  const nextParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    const normalized = Array.isArray(value) ? value[0] : value;
    if (normalized) {
      nextParams.set(key, normalized);
    }
  }

  for (const [key, value] of Object.entries(updates)) {
    if (value) {
      nextParams.set(key, value);
    } else {
      nextParams.delete(key);
    }
  }

  const query = nextParams.toString();
  return query ? `/?${query}` : "/";
}

function parseCalendarMonth(value?: string) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) {
    return startOfMonth(new Date());
  }

  const [year, month] = value.split("-").map(Number);
  if (!year || !month || month < 1 || month > 12) {
    return startOfMonth(new Date());
  }

  return new Date(year, month - 1, 1);
}

function PerformancePill({
  label,
  value,
  currency,
}: {
  label: string;
  value: number;
  currency: CurrencyCode;
}) {
  const positive = value >= 0;

  return (
    <div
      className="flex flex-col justify-between rounded-[20px] px-4 py-3.5"
      style={{ background: "var(--surface-bg-muted)" }}
    >
      <p
        className="text-[11px] font-semibold uppercase tracking-[0.2em]"
        style={{ color: "var(--text-secondary)" }}
      >
        {label}
      </p>
      <SensitiveValue
        value={formatDelta(value, currency)}
        className={`mt-2 block text-base font-semibold tabular-nums ${positive ? "af-text-up" : "af-text-down"}`}
      />
    </div>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const repository = getRepository();
  const settings = await repository.getSettings();
  const historyGroup = (readParam(params.groupBy) as HistoryGroupBy) || "total";
  const allocationGroup = (readParam(params.allocGroup) as Exclude<HistoryGroupBy, "total">) || "type";
  const calendarMonthParam = readParam(params.calendarMonth) || "";
  const historyChart = (readParam(params.chart) as HistoryChartMode) || "stacked";
  const historyRange = (readParam(params.range) as HistoryRangePreset) || "1y";
  const historyStartDate = readParam(params.start) || "";
  const historyEndDate = readParam(params.end) || "";
  const safeHistoryGroup = HISTORY_GROUP_OPTIONS.includes(historyGroup) ? historyGroup : "total";
  const safeAllocationGroup =
    allocationGroup === "folder" || allocationGroup === "asset" || allocationGroup === "type"
      ? allocationGroup
      : "type";
  const safeHistoryChart = HISTORY_CHART_MODE_OPTIONS.includes(historyChart) ? historyChart : "stacked";
  const safeHistoryRange = HISTORY_RANGE_PRESET_OPTIONS.includes(historyRange) ? historyRange : "1y";
  const historyTopAssetCount = Math.max(
    1,
    Math.min(
      50,
      Number.parseInt(readParam(params.top) || String(settings.historyTopAssetCount || 8), 10)
        || settings.historyTopAssetCount
        || 8,
    ),
  );
  const hasCustomHistoryRange =
    Boolean(historyStartDate && historyEndDate && historyStartDate <= historyEndDate);
  const dashboard = await getDashboardData(settings.displayCurrency, "all");
  const historyData = await getHistoryData(settings.displayCurrency, safeHistoryGroup, {
    preset: safeHistoryRange,
    startDate: hasCustomHistoryRange ? historyStartDate : undefined,
    endDate: hasCustomHistoryRange ? historyEndDate : undefined,
    topAssetCount: safeHistoryGroup === "asset" ? historyTopAssetCount : undefined,
  });
  const visibleTopSecurities = dashboard.topSecurities.filter((security) => Math.abs(security.convertedValue) >= 0.005);
  const fxTrend = dashboard.latestFxRates
    .filter((row) => row.baseCurrency === "USD" && row.quoteCurrency === "CNY")
    .sort((left, right) => left.asOf.localeCompare(right.asOf))
    .map((row) => ({
      date: row.asOf.slice(0, 10),
      rate: row.rate,
      source: row.source,
    }));
  const latestFxPoint = fxTrend.at(-1);
  const realToday = new Date();
  const realTodayKey = format(realToday, "yyyy-MM-dd");

  // Fetch the full daily history once; reused for both the monthly grid and the calendar.
  const monthlyHistoryData = await getHistoryData(settings.displayCurrency, "total", {
    startDate: "2022-12-01",
    endDate: realTodayKey,
  });
  const allDailyTotals = new Map(
    (monthlyHistoryData as Array<{ date: string; total: number }>).map((row) => [row.date, row.total]),
  );

  const calendarMonth = parseCalendarMonth(calendarMonthParam);
  const calendarMonthStart = startOfMonth(calendarMonth);
  const calendarMonthEnd = endOfMonth(calendarMonth);
  const calendarGridStart = startOfWeek(calendarMonthStart, { weekStartsOn: 1 });
  const calendarGridEnd = endOfWeek(calendarMonthEnd, { weekStartsOn: 1 });
  // calendarAnchorStartKey is the day before the first grid cell, used as a diff baseline.
  const calendarAnchorStartKey = format(subDays(calendarGridStart, 1), "yyyy-MM-dd");
  // Derive calendar day totals from the already-fetched allDailyTotals (avoids a duplicate fetch).
  const calendarDays = [];
  for (let cursor = calendarGridStart; cursor <= calendarGridEnd; cursor = addDays(cursor, 1)) {
    const dayKey = format(cursor, "yyyy-MM-dd");
    const previousDayKey = format(subDays(cursor, 1), "yyyy-MM-dd");
    const currentTotal = allDailyTotals.get(dayKey);
    const previousTotal = allDailyTotals.get(previousDayKey);

    const change =
      dayKey <= realTodayKey && currentTotal != null && previousTotal != null
        ? currentTotal - previousTotal
        : undefined;
    const changeLabel =
      change == null
        ? undefined
        : Math.abs(change) < 0.005
          ? "持平"
          : `${change >= 0 ? "+" : "-"}${formatCompactCurrency(Math.abs(change), settings.displayCurrency)}`;
    calendarDays.push({
      date: dayKey,
      inCurrentMonth: isSameMonth(cursor, calendarMonth),
      isToday: isSameDay(cursor, realToday),
      change,
      changeLabel,
    });
  }
  // Only fetch breakdown for dates that actually have a change (avoids unnecessary computation)
  const calendarDatesWithChange = calendarDays
    .filter((d) => d.change != null && Math.abs(d.change) >= 0.005)
    .map((d) => d.date);
  const calendarBreakdown: Map<string, CalendarDayContributor[]> =
    calendarDatesWithChange.length > 0
      ? await getCalendarBreakdown(settings.displayCurrency, calendarDatesWithChange, calendarAnchorStartKey)
      : new Map();

  const calendarMonthLabel = format(calendarMonth, "yyyy年M月");
  function getValueOnOrBefore(date: Date): number | null {
    for (let i = 0; i < 31; i++) {
      const key = format(subDays(date, i), "yyyy-MM-dd");
      if (allDailyTotals.has(key)) return allDailyTotals.get(key)!;
    }
    return null;
  }
  const allDates = [...allDailyTotals.keys()].filter((d) => d > "2022-12-31").sort();
  const monthlyStartYear = allDates.length > 0 ? parseInt(allDates[0].slice(0, 4)) : realToday.getFullYear();
  const monthlyEndYear = realToday.getFullYear();
  const monthlyYears = Array.from({ length: monthlyEndYear - monthlyStartYear + 1 }, (_, i) => monthlyStartYear + i);
  const monthlyCellMap = new Map<string, number | null>();
  const allMonthEndDates: string[] = [];
  for (let year = monthlyStartYear; year <= monthlyEndYear; year++) {
    for (let month = 1; month <= 12; month++) {
      const firstDay = new Date(year, month - 1, 1);
      if (firstDay > realToday) break;
      const monthEnd = endOfMonth(firstDay);
      const effectiveEnd = monthEnd <= realToday ? monthEnd : realToday;
      const prevMonthEnd = subDays(firstDay, 1);
      const curr = getValueOnOrBefore(effectiveEnd);
      const prev = getValueOnOrBefore(prevMonthEnd);
      const key = `${year}-${String(month).padStart(2, "0")}`;
      monthlyCellMap.set(key, curr != null && prev != null ? Math.round((curr - prev) * 100) / 100 : null);
      allMonthEndDates.push(format(effectiveEnd, "yyyy-MM-dd"));
    }
  }
  const monthlyAnchorDate = format(subDays(new Date(monthlyStartYear, 0, 1), 1), "yyyy-MM-dd");
  const monthlyBreakdownRaw = allMonthEndDates.length > 0
    ? await getCalendarBreakdown(settings.displayCurrency, allMonthEndDates, monthlyAnchorDate)
    : new Map<string, CalendarDayContributor[]>();
  const monthlyBreakdown = new Map<string, CalendarDayContributor[]>();
  for (const [dateStr, contributors] of monthlyBreakdownRaw) {
    const sorted = [...contributors].sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 8);
    monthlyBreakdown.set(dateStr.slice(0, 7), sorted);
  }
  const previousCalendarMonthHref = buildDashboardHref(params, {
    calendarMonth: format(addMonths(calendarMonth, -1), "yyyy-MM"),
  });
  const nextCalendarMonthHref = buildDashboardHref(params, {
    calendarMonth: format(addMonths(calendarMonth, 1), "yyyy-MM"),
  });
  const isCurrentMonth = isSameMonth(calendarMonth, realToday);
  const todayCalendarHref = isCurrentMonth ? null : buildDashboardHref(params, { calendarMonth: undefined });
  const allocationBreakdown = (() => {
    if (safeAllocationGroup === "type") {
      return (["CASH", "SECURITIES", "OTHER"] as const)
        .map((type) => ({
          label: ASSET_TYPE_LABELS[type],
          value: dashboard.assets
            .filter((asset) => asset.type === type)
            .reduce((sum, asset) => sum + asset.convertedValue, 0),
        }))
        .filter((slice) => Math.abs(slice.value) >= 0.005);
    }

    if (safeAllocationGroup === "folder") {
      const grouped = new Map<string, number>();
      for (const asset of dashboard.assets) {
        const key = asset.folderName || "未分类";
        grouped.set(key, (grouped.get(key) ?? 0) + asset.convertedValue);
      }

      return [...grouped.entries()]
        .map(([label, value]) => ({ label, value }))
        .filter((slice) => Math.abs(slice.value) >= 0.005)
        .sort((left, right) => right.value - left.value);
    }

    return dashboard.assets
      .map((asset) => ({
        label: asset.name,
        value: asset.convertedValue,
      }))
      .filter((slice) => Math.abs(slice.value) >= 0.005)
      .sort((left, right) => right.value - left.value);
  })();

  return (
    <div className="grid gap-6">
      <section className="af-card overflow-hidden rounded-[34px]">
        <div className="px-6 pb-4 pt-6 sm:px-8" style={{ borderBottom: "1px solid var(--border-color)" }}>
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <p className="af-kicker text-xs uppercase tracking-[0.24em]">资产总览</p>
              <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0">
                  <SensitiveValue
                    value={formatCurrency(dashboard.summary.totalValue, dashboard.summary.baseCurrency)}
                    className="block text-4xl font-semibold tracking-tight sm:text-5xl"
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                    <span
                      className={`rounded-full px-3 py-1 font-semibold ${
                        dashboard.summary.dayChange >= 0 ? "af-badge-up" : "af-badge-down"
                      }`}
                    >
                      <SensitiveValue
                        value={`${formatDelta(dashboard.summary.dayChange, dashboard.summary.baseCurrency)} 今日`}
                      />
                    </span>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-4 xl:min-w-[680px]">
                  <PerformancePill
                    label="近7日"
                    value={dashboard.summary.weekChange}
                    currency={dashboard.summary.baseCurrency}
                  />
                  <PerformancePill
                    label="近30日"
                    value={dashboard.summary.monthChange}
                    currency={dashboard.summary.baseCurrency}
                  />
                  <PerformancePill
                    label="近1年"
                    value={dashboard.summary.yearChange}
                    currency={dashboard.summary.baseCurrency}
                  />
                  <PerformancePill
                    label="今年以来"
                    value={dashboard.summary.ytdChange}
                    currency={dashboard.summary.baseCurrency}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 pb-4 pt-4 sm:px-6 sm:pb-6">
          <HistoryExplorer
            basePath="/"
            groupBy={safeHistoryGroup}
            chartMode={safeHistoryChart}
            rangePreset={safeHistoryRange}
            startDate={historyStartDate}
            endDate={historyEndDate}
            topAssetCount={historyTopAssetCount}
            displayCurrency={settings.displayCurrency}
            themePreference={settings.themePreference}
            data={historyData}
          />
        </div>
      </section>

      <section className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
        {/* Left column: calendar + monthly returns grid */}
        <div className="grid gap-4">
          <AssetCalendar
            monthLabel={calendarMonthLabel}
            days={calendarDays}
            breakdown={calendarBreakdown}
            currency={dashboard.summary.baseCurrency}
            previousMonthHref={previousCalendarMonthHref}
            nextMonthHref={nextCalendarMonthHref}
            todayCalendarHref={todayCalendarHref}
          />
          <MonthlyReturnsGrid
            years={monthlyYears}
            cellMap={monthlyCellMap}
            breakdown={monthlyBreakdown}
            currency={dashboard.summary.baseCurrency}
          />
        </div>

        {/* Right column: asset distribution + stock analysis + fx rate */}
        <div className="flex flex-col gap-6">
          <div className="af-card flex h-[27rem] flex-col overflow-hidden rounded-[34px] p-6">
            <div className="mb-6 flex items-end justify-between gap-4">
              <div>
                <p className="af-text-muted text-xs uppercase tracking-[0.24em]">资产分布</p>
                <h3 className="mt-2 text-2xl font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
                  你的资产构成
                </h3>
              </div>
              <div className="flex items-center gap-4">
                {(["type", "folder", "asset"] as const).map((group) => {
                  const active = safeAllocationGroup === group;
                  return (
                    <Link
                      key={group}
                      href={buildDashboardHref(params, { allocGroup: group })}
                      scroll={false}
                      className="text-sm font-semibold transition-colors"
                      style={{ color: active ? "var(--text-primary)" : "var(--text-secondary)" }}
                    >
                      {HISTORY_GROUP_LABELS[group]}
                    </Link>
                  );
                })}
              </div>
            </div>

            <div className="grid min-h-0 flex-1 overflow-hidden gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start">
              <div className="min-h-0 self-start">
                <AllocationPieChart data={allocationBreakdown} currency={dashboard.summary.baseCurrency} />
              </div>
              <div className="h-full min-h-0 overflow-y-auto overscroll-contain pr-1">
                <div className="space-y-1.5 pb-1">
                  {allocationBreakdown.length ? allocationBreakdown.map((slice) => {
                    const share =
                      dashboard.summary.totalValue === 0 ? 0 : (slice.value / dashboard.summary.totalValue) * 100;

                    return (
                      <div key={slice.label} className="af-card-soft rounded-[16px] px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="min-w-0 truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }} title={slice.label}>
                            {slice.label}
                          </p>
                          <div className="flex shrink-0 items-center gap-2">
                            <SensitiveValue
                              value={`${share.toFixed(1)}%`}
                              className="af-text-muted text-xs tabular-nums"
                            />
                            <SensitiveValue
                              value={formatCurrency(slice.value, dashboard.summary.baseCurrency)}
                              className="text-sm font-semibold tabular-nums"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="af-card-soft rounded-[16px] px-3 py-2">
                      <p className="af-text-muted text-sm">当前还没有可显示的资产构成数据。</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="af-card rounded-[34px] p-6">
            <div className="mb-6">
              <div>
                <p className="af-text-muted text-xs uppercase tracking-[0.24em]">股票分析</p>
                <h3 className="mt-2 text-2xl font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
                  当前持仓分析
                </h3>
              </div>
            </div>

            <div className="space-y-3">
              {visibleTopSecurities.length ? (
                visibleTopSecurities.map((security, index) => (
                  <div key={security.id} className="af-card-soft rounded-[20px] px-4 py-4">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                      <div className="flex min-w-0 shrink-0 items-center gap-3">
                        <span className="af-button-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                            {security.symbol || security.name}
                          </p>
                          <p className="af-text-muted truncate text-xs">{security.name}</p>
                        </div>
                      </div>

                      <div className="flex flex-1 flex-wrap justify-end gap-x-5 gap-y-2">
                        <div className="text-right">
                          <p className="af-text-muted text-[10px] uppercase tracking-[0.16em]">持有股数</p>
                          <SensitiveValue
                            value={`${formatShareQuantity(security.quantity)} 股`}
                            className="mt-0.5 block text-sm font-semibold"
                          />
                        </div>
                        <div className="text-right">
                          <p className="af-text-muted text-[10px] uppercase tracking-[0.16em]">平均股价</p>
                          <SensitiveValue
                            value={formatCurrency(security.averageCost, security.currency)}
                            className="mt-0.5 block text-sm font-semibold"
                          />
                        </div>
                        <div className="text-right">
                          <p className="af-text-muted text-[10px] uppercase tracking-[0.16em]">当前价值</p>
                          <SensitiveValue
                            value={formatCurrency(security.convertedValue, dashboard.summary.baseCurrency)}
                            className="mt-0.5 block text-sm font-semibold"
                          />
                        </div>
                        <div className="text-right">
                          <p className="af-text-muted text-[10px] uppercase tracking-[0.16em]">总回报率</p>
                          <SensitiveValue
                            value={formatPercent(security.profitLossPct)}
                            className={`mt-0.5 block text-sm font-semibold ${security.profitLoss >= 0 ? "af-text-up" : "af-text-down"}`}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="af-card-soft rounded-[20px] px-4 py-4">
                  <p className="af-text-muted text-sm">当前没有持有中的股票或基金。</p>
                </div>
              )}
            </div>
          </div>

          <div className="af-card rounded-[34px] p-6">
            <div className="mb-6 flex items-end justify-between gap-4">
              <div>
                <p className="af-text-muted text-xs uppercase tracking-[0.24em]">人民币 / 美元汇率</p>
                <h3 className="mt-2 text-2xl font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
                  USD/CNY 走势
                </h3>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  {latestFxPoint ? `¥${latestFxPoint.rate.toFixed(4)} / $1` : "暂无汇率"}
                </p>
                <p className="af-text-muted mt-1 text-xs">
                  {latestFxPoint ? formatCalendarDateLabel(latestFxPoint.date) : "等待同步"}
                </p>
              </div>
            </div>

            {fxTrend.length ? (
              <FxTrendLineChart data={fxTrend} />
            ) : (
              <div className="af-card-soft rounded-[22px] px-4 py-4">
                <p className="af-text-muted text-sm">当前还没有可用的汇率历史数据。</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
