"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { useRouter } from "next/navigation";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { maskDisplayValue, useAppPreferences } from "@/components/app-preferences";
import { HISTORY_RANGE_PRESET_LABELS, HISTORY_RANGE_PRESET_OPTIONS } from "@/lib/constants";
import type { AssetDetailData, AssetTimelineEvent, AssetTimelineEventKind, ColorScheme, HistoryRangePreset } from "@/lib/types";
import { formatCalendarDateLabel, formatCompactCurrency, formatCurrency } from "@/lib/utils";

const TREND_UP_COLOR = "#00c805";
const TREND_DOWN_COLOR = "#ef4444";

function resolveTrendColor(direction: "up" | "down", colorScheme: ColorScheme): string {
  const upIsGreen = colorScheme !== "red-up";
  if (direction === "up") return upIsGreen ? TREND_UP_COLOR : TREND_DOWN_COLOR;
  return upIsGreen ? TREND_DOWN_COLOR : TREND_UP_COLOR;
}

function detectTrendDirection<T>(
  data: readonly T[] | undefined,
  pick: (point: T) => number | null | undefined,
): "up" | "down" {
  if (!data?.length) return "up";
  let first: number | null = null;
  let last: number | null = null;
  for (const point of data) {
    const value = pick(point);
    if (typeof value === "number" && Number.isFinite(value)) {
      if (first === null) first = value;
      last = value;
    }
  }
  if (first === null || last === null) return "up";
  return last >= first ? "up" : "down";
}

const palette = [
  "#22c55e",
  "#3b82f6",
  "#14b8a6",
  "#f59e0b",
  "#8b5cf6",
  "#f97316",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
  "#6366f1",
  "#f43f5e",
  "#10b981",
  "#0ea5e9",
  "#a855f7",
  "#eab308",
  "#fb7185",
  "#2dd4bf",
  "#60a5fa",
  "#f472b6",
  "#facc15",
];

const assetTypePalette: Record<string, string> = {
  现金: "#22c55e",
  股票: "#3b82f6",
  其他: "#f59e0b",
};

const aggregateSeriesPalette: Record<string, string> = {
  其他: "#94a3b8",
};

type HistorySeriesColorMode = "type" | "generic";

const hoverCursor = {
  stroke: "var(--text-secondary)",
  strokeWidth: 1,
  strokeDasharray: "5 4",
  strokeOpacity: 0.45,
};

const tooltipStyle = {
  borderRadius: 20,
  border: "1px solid var(--chart-tooltip-border)",
  boxShadow: "var(--chart-tooltip-shadow)",
  background: "var(--surface-bg)",
  color: "var(--text-primary)",
};

type HistoryRangeSelection = {
  startDate?: string;
  endDate?: string;
  onDateClick?: (date: string) => void;
  onHoverDate?: (date?: string) => void;
};

function suppressChartFocus(event?: { preventDefault?: () => void }) {
  event?.preventDefault?.();

  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement || activeElement instanceof SVGElement) {
    activeElement.blur();
  }
}

function formatMaybeMasked(value: string, privacyMode: boolean, mask = true) {
  return privacyMode && mask ? maskDisplayValue(value) : value;
}

function formatTooltipCurrency(value: unknown, currency: "USD" | "CNY", privacyMode: boolean) {
  const numericValue = typeof value === "number" ? value : Number(value ?? 0);
  return formatMaybeMasked(formatCurrency(numericValue, currency), privacyMode);
}

function formatShareQuantity(value?: number | null) {
  if (value == null) return "0";

  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function getVisibleSeriesKeys(data: Array<Record<string, string | number>>) {
  const keys = Object.keys(data[0] ?? {}).filter(
    (key) =>
      key !== "date" &&
      data.some((row) => {
        const value = row[key];
        return typeof value === "number" && Math.abs(value) >= 0.005;
      }),
  );

  return keys.sort((left, right) => {
    if (left === "其他" && right !== "其他") return 1;
    if (right === "其他" && left !== "其他") return -1;
    return 0;
  });
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function hslToHex(hue: number, saturation: number, lightness: number) {
  const normalizedHue = ((hue % 360) + 360) % 360;
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((normalizedHue / 60) % 2) - 1));
  const m = l - chroma / 2;

  let red = 0;
  let green = 0;
  let blue = 0;

  if (normalizedHue < 60) {
    red = chroma;
    green = x;
  } else if (normalizedHue < 120) {
    red = x;
    green = chroma;
  } else if (normalizedHue < 180) {
    green = chroma;
    blue = x;
  } else if (normalizedHue < 240) {
    green = x;
    blue = chroma;
  } else if (normalizedHue < 300) {
    red = x;
    blue = chroma;
  } else {
    red = chroma;
    blue = x;
  }

  const toHex = (channel: number) =>
    Math.round((channel + m) * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

function getGeneratedSeriesColor(key: string) {
  const hash = hashString(key);
  const hue = hash % 360;
  const saturation = 68 + (hash % 10);
  const lightness = 50 + ((hash >> 3) % 8);
  return hslToHex(hue, saturation, lightness);
}

function getSeriesColor(key: string, index: number, mode: HistorySeriesColorMode = "generic") {
  if (aggregateSeriesPalette[key]) {
    return aggregateSeriesPalette[key];
  }
  if (mode === "type" && assetTypePalette[key]) {
    return assetTypePalette[key];
  }
  if (index < palette.length) {
    return palette[index];
  }
  return getGeneratedSeriesColor(key);
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  const value =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : normalized;
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function parseIsoDate(value: string | number) {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const parsed = parseISO(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function getChartInteractionDate(state: unknown) {
  if (!state || typeof state !== "object" || !("activeLabel" in state)) {
    return undefined;
  }

  const activeLabel = (state as { activeLabel?: string | number | null }).activeLabel;
  return typeof activeLabel === "string" ? activeLabel : undefined;
}

function normalizeSelectionRange(startDate?: string, endDate?: string) {
  if (!startDate || !endDate) {
    return null;
  }

  return startDate <= endDate
    ? { startDate, endDate }
    : { startDate: endDate, endDate: startDate };
}

function HistoryRangeHighlight({
  selection,
  yAxisId,
}: {
  selection?: HistoryRangeSelection;
  yAxisId?: string;
}) {
  const normalizedRange = normalizeSelectionRange(selection?.startDate, selection?.endDate);
  if (!normalizedRange) {
    if (!selection?.startDate) {
      return null;
    }

    return (
      <>
        <ReferenceLine
          x={selection.startDate}
          yAxisId={yAxisId}
          stroke="rgba(37, 99, 235, 0.9)"
          strokeWidth={2.5}
          strokeDasharray="5 4"
        />
      </>
    );
  }

  return (
    <>
      <ReferenceArea
        x1={normalizedRange.startDate}
        x2={normalizedRange.endDate}
        yAxisId={yAxisId}
        fill="rgba(37, 99, 235, 0.16)"
        fillOpacity={1}
        strokeOpacity={0}
      />
      <ReferenceLine
        x={normalizedRange.startDate}
        yAxisId={yAxisId}
        stroke="rgba(37, 99, 235, 0.92)"
        strokeWidth={2.5}
      />
      <ReferenceLine
        x={normalizedRange.endDate}
        yAxisId={yAxisId}
        stroke="rgba(37, 99, 235, 0.92)"
        strokeWidth={2.5}
      />
    </>
  );
}

function formatChartAxisLabel(value: string | number) {
  const parsed = parseIsoDate(value);
  if (!parsed) {
    return String(value);
  }

  return format(parsed, "MMM d");
}

function formatChartTooltipLabel(value: string | number) {
  const parsed = parseIsoDate(value);
  if (!parsed) {
    return String(value);
  }

  return format(parsed, "MMM d, yyyy");
}

function formatSelectionLabel(value: string) {
  return formatCalendarDateLabel(value);
}

function getHistoryTickCount(length: number) {
  if (length > 1200) return 10;
  if (length > 720) return 9;
  if (length > 360) return 8;
  if (length > 180) return 7;
  return 6;
}

function buildHistoryAxisMeta(data: Array<Record<string, string | number>>) {
  const dates = data
    .map((row) => String(row.date ?? ""))
    .filter((value) => Boolean(parseIsoDate(value)));

  if (!dates.length) {
    return {
      ticks: undefined as string[] | undefined,
      labelByDate: new Map<string, string>(),
    };
  }

  const years = new Set(
    dates
      .map((value) => parseIsoDate(value)?.getFullYear())
      .filter((value): value is number => value !== undefined),
  );
  const multiYear = years.size > 1;
  const targetTickCount = Math.min(getHistoryTickCount(dates.length), dates.length);
  const lastIndex = dates.length - 1;
  const ticks = Array.from(
    new Set(
      Array.from({ length: targetTickCount }, (_, index) => {
        if (index === 0) return dates[0];
        if (index === targetTickCount - 1) return dates[lastIndex];
        const position = Math.round((index / (targetTickCount - 1)) * lastIndex);
        return dates[position];
      }),
    ),
  );

  const labelByDate = new Map<string, string>();
  for (const value of dates) {
    const parsed = parseIsoDate(value);
    if (!parsed) {
      labelByDate.set(value, value);
      continue;
    }

    labelByDate.set(
      value,
      multiYear
        ? format(parsed, "yy/M/d")
        : format(parsed, "M/d"),
    );
  }

  return {
    ticks,
    labelByDate,
  };
}

function HistorySeriesTooltip({
  active,
  payload,
  label,
  currency,
  seriesKeys,
  colorMode,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ color?: string; payload?: Record<string, string | number | null> }>;
  label?: string | number;
  currency: "USD" | "CNY";
  seriesKeys: string[];
  colorMode: HistorySeriesColorMode;
}) {
  const { privacyMode } = useAppPreferences();

  if (!active || !payload?.length) {
    return null;
  }

  const sourceRow =
    (payload[0]?.payload?.__source as Record<string, string | number> | undefined) ??
    (payload[0]?.payload as Record<string, string | number> | undefined);

  if (!sourceRow) {
    return null;
  }

  const rows = seriesKeys
    .map((key, index) => {
      const value = sourceRow[key];
      return {
        name: key,
        color: getSeriesColor(key, index, colorMode),
        value: typeof value === "number" ? value : Number(value ?? 0),
      };
    })
    .filter((item) => item.value !== 0);

  if (!rows.length) {
    return null;
  }

  const total = rows.reduce((sum, item) => sum + item.value, 0);

  return (
    <div style={tooltipStyle} className="min-w-[220px] p-4">
      <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        {formatMaybeMasked(formatChartTooltipLabel(label ?? ""), privacyMode)}
      </p>
      <p className="mt-1 text-base font-semibold" style={{ color: "var(--text-primary)" }}>
        总值 {formatMaybeMasked(formatCurrency(total, currency), privacyMode)}
      </p>
      <div className="mt-3 space-y-2">
        {rows.map((item) => (
          <div key={item.name} className="flex items-center justify-between gap-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} />
              <span style={{ color: "var(--text-secondary)" }}>{item.name}</span>
            </div>
            <span className="font-medium" style={{ color: "var(--text-primary)" }}>
              {formatMaybeMasked(formatCurrency(item.value, currency), privacyMode)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HistoryChartFrame({
  seriesKeys,
  colorMode,
  children,
}: {
  seriesKeys: string[];
  colorMode: HistorySeriesColorMode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid h-[28rem] w-full grid-rows-[auto_minmax(0,1fr)] gap-3">
      <HistoryLegend seriesKeys={seriesKeys} colorMode={colorMode} />
      <div className="min-h-0">{children}</div>
    </div>
  );
}

function HistoryXAxis({
  axisMeta,
  privacyMode,
}: {
  axisMeta: ReturnType<typeof buildHistoryAxisMeta>;
  privacyMode: boolean;
}) {
  return (
    <XAxis
      dataKey="date"
      ticks={axisMeta.ticks}
      tickLine={false}
      axisLine={false}
      tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
      tickFormatter={(value: string | number) =>
        formatMaybeMasked(axisMeta.labelByDate.get(String(value)) ?? formatChartAxisLabel(value), privacyMode)
      }
    />
  );
}

function HistoryYAxis({
  currency,
  privacyMode,
}: {
  currency: "USD" | "CNY";
  privacyMode: boolean;
}) {
  return (
    <YAxis
      tickLine={false}
      axisLine={false}
      width={92}
      tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
      tickFormatter={(value: number) =>
        formatMaybeMasked(formatCompactCurrency(value, currency), privacyMode)
      }
    />
  );
}

function HistoryTooltip({
  currency,
  seriesKeys,
  colorMode,
}: {
  currency: "USD" | "CNY";
  seriesKeys: string[];
  colorMode: HistorySeriesColorMode;
}) {
  return (
    <Tooltip
      cursor={hoverCursor}
      content={(props) => (
        <HistorySeriesTooltip
          active={props.active}
          payload={props.payload as ReadonlyArray<{
            color?: string;
            payload?: Record<string, string | number | null>;
          }> | undefined}
          label={props.label as string | number | undefined}
          currency={currency}
          seriesKeys={seriesKeys}
          colorMode={colorMode}
        />
      )}
    />
  );
}

function HistoryLegend({
  seriesKeys,
  colorMode,
}: {
  seriesKeys: string[];
  colorMode: HistorySeriesColorMode;
}) {
  if (!seriesKeys.length) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2.5">
      {seriesKeys.map((key, index) => (
        <div
          key={key}
          className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium"
          style={{
            borderColor: hexToRgba(getSeriesColor(key, index, colorMode), 0.3),
            background: hexToRgba(getSeriesColor(key, index, colorMode), 0.1),
            color: "var(--text-primary)",
          }}
        >
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: getSeriesColor(key, index, colorMode) }}
          />
          {key}
        </div>
      ))}
    </div>
  );
}

export function TrendAreaChart({
  data,
  currency = "USD",
  selection,
}: {
  data: Array<{ date: string; total: number }>;
  currency?: "USD" | "CNY";
  selection?: HistoryRangeSelection;
}) {
  const { privacyMode, settings } = useAppPreferences();
  const axisMeta = useMemo(
    () => buildHistoryAxisMeta(data as Array<Record<string, string | number>>),
    [data],
  );
  const trendColor = useMemo(
    () => resolveTrendColor(detectTrendDirection(data, (point) => point.total), settings.colorScheme),
    [data, settings.colorScheme],
  );

  return (
    <div className="h-[28rem] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          tabIndex={-1}
          onMouseDown={(_state, event) => suppressChartFocus(event)}
          onClick={(state) => selection?.onDateClick?.(getChartInteractionDate(state) ?? "")}
          onMouseMove={(state) => selection?.onHoverDate?.(getChartInteractionDate(state))}
          onMouseLeave={() => selection?.onHoverDate?.(undefined)}
        >
          <defs>
            <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={trendColor} stopOpacity={0.26} />
              <stop offset="100%" stopColor={trendColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <HistoryRangeHighlight selection={selection} />
          <XAxis
            dataKey="date"
            ticks={axisMeta.ticks}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
            tickFormatter={(value: string | number) =>
              formatMaybeMasked(axisMeta.labelByDate.get(String(value)) ?? formatChartAxisLabel(value), privacyMode)
            }
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={80}
            tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
            tickFormatter={(value: number) => formatMaybeMasked(formatCompactCurrency(value, currency), privacyMode)}
          />
          <Tooltip
            cursor={hoverCursor}
            contentStyle={tooltipStyle}
            labelFormatter={(label) => formatMaybeMasked(formatChartTooltipLabel(label), privacyMode)}
            formatter={(value) => formatTooltipCurrency(value, currency, privacyMode)}
          />
          <Area
            type="monotone"
            dataKey="total"
            stroke={trendColor}
            strokeWidth={2.8}
            fill="url(#trendFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function FxTrendLineChart({
  data,
}: {
  data: Array<{ date: string; rate: number }>;
}) {
  const axisMeta = useMemo(
    () => buildHistoryAxisMeta(data as Array<Record<string, string | number>>),
    [data],
  );

  return (
    <div className="mx-auto h-72 w-full max-w-[820px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: 12, bottom: 8 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="date"
            ticks={axisMeta.ticks}
            padding={{ left: 18, right: 18 }}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
            tickFormatter={(value: string | number) => axisMeta.labelByDate.get(String(value)) ?? formatChartAxisLabel(value)}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={74}
            domain={["dataMin - 0.02", "dataMax + 0.02"]}
            tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
            tickFormatter={(value: number) => value.toFixed(2)}
          />
          <Tooltip
            cursor={hoverCursor}
            contentStyle={tooltipStyle}
            labelFormatter={(label) => formatChartTooltipLabel(label)}
            formatter={(value) => [`${Number(value).toFixed(4)}`, "USD/CNY"]}
          />
          <Line
            type="monotone"
            dataKey="rate"
            stroke="#2563eb"
            strokeWidth={2.4}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AllocationPieChart({
  data,
  currency = "USD",
}: {
  data: Array<{ label: string; value: number }>;
  currency?: "USD" | "CNY";
}) {
  const { privacyMode } = useAppPreferences();

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius={70}
            outerRadius={104}
            paddingAngle={3}
          >
            {data.map((entry, index) => (
              <Cell key={entry.label} fill={palette[index % palette.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value) => formatTooltipCurrency(value, currency, privacyMode)}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function assetEventColor(kind: AssetTimelineEventKind, colorScheme: ColorScheme) {
  if (kind === "BUY") return resolveTrendColor("up", colorScheme);
  if (kind === "SELL") return resolveTrendColor("down", colorScheme);
  if (kind === "VALUE_SNAPSHOT") return resolveTrendColor("up", colorScheme);
  return "#f59e0b";
}

function eventNotional(event: AssetTimelineEvent): number {
  const qty = event.quantity ?? 0;
  const price = event.unitPrice ?? 0;
  const amount = event.amount;
  if (qty && price) return Math.abs(qty * price);
  if (typeof amount === "number" && Number.isFinite(amount)) return Math.abs(amount);
  return Math.abs(qty);
}

function pickEventDominantColor(events: AssetTimelineEvent[], colorScheme: ColorScheme): string {
  const totalBuyAmount = events
    .filter((event) => event.kind === "BUY")
    .reduce((sum, event) => sum + eventNotional(event), 0);
  const totalSellAmount = events
    .filter((event) => event.kind === "SELL")
    .reduce((sum, event) => sum + eventNotional(event), 0);
  if (totalBuyAmount > totalSellAmount) return assetEventColor("BUY", colorScheme);
  if (totalSellAmount > totalBuyAmount) return assetEventColor("SELL", colorScheme);
  if (events.some((event) => event.kind === "STOCK_SNAPSHOT")) return assetEventColor("STOCK_SNAPSHOT", colorScheme);
  return assetEventColor("VALUE_SNAPSHOT", colorScheme);
}

function assetEventLabel(kind: AssetTimelineEventKind) {
  if (kind === "BUY") return "买入";
  if (kind === "SELL") return "卖出";
  if (kind === "STOCK_SNAPSHOT") return "持仓快照";
  return "金额记录";
}

function buildAssetRangeHref(assetId?: string, rangePreset: HistoryRangePreset = "all") {
  return buildAssetRangeHrefWithDates(assetId, rangePreset);
}

function buildAssetRangeHrefWithDates(
  assetId?: string,
  rangePreset: HistoryRangePreset = "all",
  startDate?: string,
  endDate?: string,
) {
  const params = new URLSearchParams();
  if (assetId) {
    params.set("asset", assetId);
  }
  params.set("range", rangePreset);
  if (startDate && endDate && startDate <= endDate) {
    params.set("start", startDate);
    params.set("end", endDate);
  }
  const query = params.toString();
  return query ? `/assets?${query}` : "/assets";
}

function AssetTimelineEventDots({
  cx,
  cy,
  events,
  selected,
  colorScheme,
  onSelect,
}: {
  cx?: number;
  cy?: number;
  events: AssetTimelineEvent[];
  selected?: boolean;
  colorScheme: ColorScheme;
  onSelect?: () => void;
}) {
  if (typeof cx !== "number" || typeof cy !== "number" || !events.length) {
    return null;
  }

  const fill = pickEventDominantColor(events, colorScheme);

  const visibleRadius = selected ? 7 : 4.5;
  const hitRadius = selected ? 14 : 12;
  const handleClick = (event: React.MouseEvent<SVGCircleElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect?.();
  };

  return (
    <g style={{ cursor: "pointer" }} onMouseDown={(event) => suppressChartFocus(event)}>
      <circle
        cx={cx}
        cy={cy}
        r={visibleRadius}
        fill={fill}
        stroke="var(--surface-bg)"
        strokeWidth={selected ? 3 : 2}
        onClick={handleClick}
      />
      <circle
        cx={cx}
        cy={cy}
        r={hitRadius}
        fill="transparent"
        stroke="none"
        onClick={handleClick}
      />
    </g>
  );
}

function AssetTimelineTooltipCard({
  rowDate,
  totalValue,
  nativeValue,
  securityPrice,
  quantity,
  events,
  detail,
}: {
  rowDate: string;
  totalValue: number;
  nativeValue: number;
  securityPrice: number | null;
  quantity: number | null;
  events: AssetTimelineEvent[];
  detail: AssetDetailData;
}) {
  const { privacyMode, settings } = useAppPreferences();
  const colorScheme = settings.colorScheme;

  return (
    <div
      style={{
        ...tooltipStyle,
        width: "min(22rem, calc(100vw - 3rem))",
      }}
      className="p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {formatMaybeMasked(formatChartTooltipLabel(rowDate), privacyMode)}
          </p>
          <p className="mt-1 text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            总价值 {formatMaybeMasked(formatCurrency(totalValue, detail.baseCurrency), privacyMode)}
          </p>
          <p className="af-text-muted mt-1 text-xs">
            原币 {formatMaybeMasked(formatCurrency(nativeValue, detail.asset.currency), privacyMode)}
          </p>
        </div>

        {detail.asset.type === "SECURITIES" ? (
          <div className="grid gap-1 text-right">
            <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              股价{" "}
              {securityPrice != null
                ? formatMaybeMasked(formatCurrency(securityPrice, detail.asset.currency), privacyMode, false)
                : "暂无"}
            </p>
            <p className="af-text-muted text-xs">
              持股{" "}
              {formatMaybeMasked(`${formatShareQuantity(quantity)} 股`, privacyMode)}
            </p>
          </div>
        ) : null}
      </div>

      {events.length ? (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {events.map((event) => (
            <div
              key={event.id}
              className="min-w-0 rounded-2xl border px-3 py-3"
              style={{
                borderColor: `${assetEventColor(event.kind, colorScheme)}33`,
                background: `${assetEventColor(event.kind, colorScheme)}12`,
              }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: assetEventColor(event.kind, colorScheme) }}
                />
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  {assetEventLabel(event.kind)}
                </p>
              </div>
              <div className="mt-2 space-y-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                {event.kind === "VALUE_SNAPSHOT" ? (
                  <p>{formatMaybeMasked(formatCurrency(event.amount ?? 0, detail.asset.currency), privacyMode)}</p>
                ) : (
                  <>
                    <p>
                      {formatMaybeMasked(`${formatShareQuantity(event.quantity)} 股`, privacyMode)}
                    </p>
                    <p>
                      {formatMaybeMasked(
                        formatCurrency(event.unitPrice ?? 0, detail.asset.currency),
                        privacyMode,
                        false,
                      )}
                    </p>
                  </>
                )}
                {event.notes ? <p>{event.notes}</p> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AssetTimelineTooltip({
  active,
  payload,
  label,
  detail,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: Record<string, unknown> }>;
  label?: string | number;
  detail: AssetDetailData;
}) {
  const sourceRow = payload?.find((item) => item.payload)?.payload as
    | (AssetDetailData["timeline"]["points"][number] & Record<string, unknown>)
    | undefined;

  if (!active || !sourceRow) {
    return null;
  }

  const rowDate = typeof label === "string" ? label : String(sourceRow.date ?? "");
  const totalValue = Number(sourceRow.totalValueConverted ?? 0);
  const nativeValue = Number(sourceRow.totalValueNative ?? 0);
  const securityPrice =
    typeof sourceRow.securityPrice === "number" ? sourceRow.securityPrice : null;
  const quantity = typeof sourceRow.quantity === "number" ? sourceRow.quantity : null;
  const events = Array.isArray(sourceRow.events)
    ? (sourceRow.events as AssetDetailData["timeline"]["points"][number]["events"])
    : [];

  return (
    <AssetTimelineTooltipCard
      rowDate={rowDate}
      totalValue={totalValue}
      nativeValue={nativeValue}
      securityPrice={securityPrice}
      quantity={quantity}
      events={events}
      detail={detail}
    />
  );
}

export function AssetTimelineChart({
  detail,
  rangePreset,
  selectedAssetId,
  startDate,
  endDate,
  selectedRecordDate,
  onSelectedRecordDateChange,
}: {
  detail: AssetDetailData | null;
  rangePreset: HistoryRangePreset;
  selectedAssetId?: string;
  startDate?: string;
  endDate?: string;
  selectedRecordDate?: string | null;
  onSelectedRecordDateChange?: (date: string | null) => void;
}) {
  const router = useRouter();
  const { privacyMode, settings } = useAppPreferences();
  const chartAreaRef = useRef<HTMLDivElement | null>(null);
  const timelinePoints = detail?.timeline.points;
  const trendColor = useMemo(
    () =>
      resolveTrendColor(
        detectTrendDirection(timelinePoints, (point) => point.totalValueConverted),
        settings.colorScheme,
      ),
    [timelinePoints, settings.colorScheme],
  );
  const selectionVersion = `${selectedAssetId ?? "none"}|${rangePreset}|${startDate ?? ""}|${endDate ?? ""}`;
  const [draftSelection, setDraftSelection] = useState<{
    version: string;
    startDate: string | null;
    hoverDate: string | null;
  }>({
    version: selectionVersion,
    startDate: null,
    hoverDate: null,
  });
  const axisMeta = useMemo(
    () =>
      buildHistoryAxisMeta(
        (timelinePoints ?? []).map((point) => ({
          date: point.date,
          totalValueConverted: point.totalValueConverted,
          securityPrice: point.securityPrice ?? 0,
        })),
      ),
    [timelinePoints],
  );
  const hasCustomRange = Boolean(startDate && endDate && startDate <= endDate);
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

  if (!detail || !timelinePoints?.length) {
    return (
      <div className="flex h-[25rem] items-center justify-center rounded-[28px] border border-dashed" style={{ borderColor: "var(--border-color)" }}>
        <div className="text-center">
          <p className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            还没有可展示的走势图
          </p>
          <p className="af-text-muted mt-2 text-sm">先创建一个资产并写入第一条记录。</p>
        </div>
      </div>
    );
  }
  const hasSecurityPriceSeries =
    detail.asset.type === "SECURITIES" && detail.timeline.hasSecurityPriceSeries;
  const rangeLabel =
    detail.timeline.rangeStart && detail.timeline.rangeEnd
      ? `${formatSelectionLabel(detail.timeline.rangeStart)} - ${formatSelectionLabel(detail.timeline.rangeEnd)}`
      : null;
  const showCurrentSecurityPrice =
    detail.asset.type === "SECURITIES" &&
    (detail.asset.quantity ?? 0) > 0;
  const selectedPoint =
    selectedRecordDate
      ? detail.timeline.points.find((point) => point.date === selectedRecordDate && point.events.length)
      : undefined;
  const selectedPointIndex =
    selectedPoint
      ? detail.timeline.points.findIndex((point) => point.date === selectedPoint.date)
      : -1;
  const selectedPointHorizontalRatio =
    selectedPointIndex >= 0 && detail.timeline.points.length > 1
      ? selectedPointIndex / (detail.timeline.points.length - 1)
      : 0.5;
  const selectedPointIsRightSide = selectedPointHorizontalRatio >= 0.58;
  const valueSeries = detail.timeline.points.map((point) => point.totalValueConverted);
  const minValue = Math.min(...valueSeries);
  const maxValue = Math.max(...valueSeries);
  const selectedPointVerticalRatio =
    selectedPoint && maxValue > minValue
      ? (maxValue - selectedPoint.totalValueConverted) / (maxValue - minValue)
      : 0.5;
  const selectedPointIsNearTop = selectedPointVerticalRatio <= 0.22;
  const selectedPointStyle = selectedPoint
    ? {
        left: `${Math.min(92, Math.max(8, selectedPointHorizontalRatio * 100))}%`,
        top: `${Math.min(88, Math.max(10, selectedPointVerticalRatio * 100))}%`,
        transform: [
          selectedPointIsRightSide ? "translateX(calc(-100% - 18px))" : "translateX(18px)",
          selectedPointIsNearTop ? "translateY(18px)" : "translateY(calc(-100% - 18px))",
        ].join(" "),
      }
    : undefined;

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
    if (!nextRange) {
      return;
    }

    setDraftSelection({
      version: selectionVersion,
      startDate: null,
      hoverDate: null,
    });
    router.replace(
      buildAssetRangeHrefWithDates(
        selectedAssetId,
        rangePreset,
        nextRange.startDate,
        nextRange.endDate,
      ),
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

  return (
    <div className="af-card rounded-[32px] p-6">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              <h2 className="text-5xl font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
                {detail.asset.name}
              </h2>
              <div>
                <p className="af-text-muted text-xs uppercase tracking-[0.18em]">今日价值</p>
                <p className="mt-1 text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
                  {formatMaybeMasked(
                    formatCurrency(detail.asset.convertedValue, detail.baseCurrency),
                    privacyMode,
                  )}
                </p>
              </div>
              {showCurrentSecurityPrice ? (
                <div>
                  <p className="af-text-muted text-xs uppercase tracking-[0.18em]">当前股价</p>
                  <p className="mt-1 text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
                    {formatMaybeMasked(
                      formatCurrency(detail.asset.unitPrice ?? 0, detail.asset.currency),
                      privacyMode,
                      false,
                    )}
                  </p>
                </div>
              ) : null}
              {showCurrentSecurityPrice ? (
                <div>
                  <p className="af-text-muted text-xs uppercase tracking-[0.18em]">持有股数</p>
                  <p className="mt-1 text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
                    {formatMaybeMasked(`${formatShareQuantity(detail.asset.quantity)}`, privacyMode)}
                  </p>
                </div>
              ) : null}
            </div>
            {rangeLabel ? <p className="af-text-muted mt-2 text-sm">{rangeLabel}</p> : null}
            <div className="mt-4 flex flex-wrap items-center gap-4 pl-2">
              {HISTORY_RANGE_PRESET_OPTIONS.map((item) => (
                <Link
                  key={item}
                  href={buildAssetRangeHref(selectedAssetId, item)}
                  scroll={false}
                  className="px-0.5 py-0.5 text-sm font-semibold tracking-[0.12em] transition-colors"
                  style={{
                    color:
                      rangePreset === item
                        ? "var(--text-primary)"
                        : "var(--text-secondary)",
                  }}
                >
                  {HISTORY_RANGE_PRESET_LABELS[item]}
                </Link>
              ))}
              {hasCustomRange && startDate && endDate ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="af-text-muted text-sm font-medium">
                    {formatSelectionLabel(startDate)} - {formatSelectionLabel(endDate)}
                  </span>
                  <Link
                    href={buildAssetRangeHref(selectedAssetId, rangePreset)}
                    scroll={false}
                    className="rounded-full px-2.5 py-1 text-xs font-semibold af-button-secondary"
                  >
                    取消
                  </Link>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium" style={{ borderColor: "var(--border-color)", color: "var(--text-primary)" }}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: trendColor }} />
              总价值
            </span>
            {hasSecurityPriceSeries ? (
              <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium" style={{ borderColor: "var(--border-color)", color: "var(--text-primary)" }}>
                <span className="h-2.5 w-2.5 rounded-full bg-[#334155]" />
                股价
              </span>
            ) : null}
          </div>
        </div>

        <div ref={chartAreaRef} className="relative h-[25rem] w-full">
          {selectedPoint ? (
            <div
              className="pointer-events-none absolute z-10"
              style={selectedPointStyle}
            >
              <AssetTimelineTooltipCard
                rowDate={selectedPoint.date}
                totalValue={selectedPoint.totalValueConverted}
                nativeValue={selectedPoint.totalValueNative}
                securityPrice={selectedPoint.securityPrice ?? null}
                quantity={selectedPoint.quantity ?? null}
                events={selectedPoint.events}
                detail={detail}
              />
            </div>
          ) : null}
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={detail.timeline.points}
              tabIndex={-1}
              onMouseDown={(_state, event) => suppressChartFocus(event)}
              onClick={(state) => handleDateClick(getChartInteractionDate(state) ?? "")}
              onMouseMove={(state) => handleHoverDate(getChartInteractionDate(state))}
              onMouseLeave={() => handleHoverDate(undefined)}
            >
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <HistoryRangeHighlight selection={selection} yAxisId="value" />
              <XAxis
                dataKey="date"
                ticks={axisMeta.ticks}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
                tickFormatter={(value: string | number) =>
                  formatMaybeMasked(
                    axisMeta.labelByDate.get(String(value)) ?? formatChartAxisLabel(value),
                    privacyMode,
                  )
                }
              />
              <YAxis
                yAxisId="value"
                tickLine={false}
                axisLine={false}
                width={92}
                tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
                tickFormatter={(value: number) =>
                  formatMaybeMasked(formatCompactCurrency(value, detail.baseCurrency), privacyMode)
                }
              />
              {hasSecurityPriceSeries ? (
                <YAxis
                  yAxisId="price"
                  orientation="right"
                  tickLine={false}
                  axisLine={false}
                  width={92}
                  tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
                  tickFormatter={(value: number) =>
                    formatMaybeMasked(formatCompactCurrency(value, detail.asset.currency), privacyMode, false)
                  }
                />
              ) : null}
              <Tooltip cursor={hoverCursor} content={(props) => <AssetTimelineTooltip {...props} detail={detail} />} />
              <Line
                yAxisId="value"
                type="monotone"
                dataKey="totalValueConverted"
                stroke={trendColor}
                strokeWidth={2.8}
                dot={({ cx, cy, payload }) => (
                  <AssetTimelineEventDots
                    cx={cx}
                    cy={cy}
                    events={(payload?.events ?? []) as AssetTimelineEvent[]}
                    selected={payload?.date === selectedRecordDate}
                    colorScheme={settings.colorScheme}
                    onSelect={() => {
                      const date = typeof payload?.date === "string" ? payload.date : null;
                      onSelectedRecordDateChange?.(date);
                    }}
                  />
                )}
                activeDot={{ r: 4, fill: trendColor, stroke: "var(--surface-bg)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
              {hasSecurityPriceSeries ? (
                <Line
                  yAxisId="price"
                  type="monotone"
                  dataKey="securityPrice"
                  stroke="#334155"
                  strokeWidth={2.1}
                  strokeDasharray="4 4"
                  connectNulls={false}
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                />
              ) : null}
              {selectedPoint ? (
                <ReferenceDot
                  x={selectedPoint.date}
                  y={selectedPoint.totalValueConverted}
                  yAxisId="value"
                  r={8}
                  fill={selectedPoint.events.length
                    ? pickEventDominantColor(selectedPoint.events, settings.colorScheme)
                    : trendColor}
                  stroke="var(--surface-bg)"
                  strokeWidth={3}
                />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

export function StackedBoundaryHistoryChart({
  data,
  currency,
  selection,
  colorMode = "generic",
}: {
  data: Array<Record<string, string | number>>;
  currency: "USD" | "CNY";
  selection?: HistoryRangeSelection;
  colorMode?: HistorySeriesColorMode;
}) {
  const { privacyMode } = useAppPreferences();
  const keys = useMemo(() => getVisibleSeriesKeys(data), [data]);
  const axisMeta = useMemo(() => buildHistoryAxisMeta(data), [data]);
  const chartData = useMemo(
    () =>
      data.map((row, index) => {
        const nextRow: Record<string, string | number | null | Record<string, string | number>> = {
          date: String(row.date ?? ""),
          __source: row,
        };

        for (const key of keys) {
          const value = row[key];
          const numericValue = typeof value === "number" ? value : 0;
          const previousValue = index > 0 && typeof data[index - 1]?.[key] === "number"
            ? Number(data[index - 1][key])
            : 0;
          const nextValue = index < data.length - 1 && typeof data[index + 1]?.[key] === "number"
            ? Number(data[index + 1][key])
            : 0;

          const isAnchorStart = numericValue === 0 && previousValue === 0 && nextValue !== 0;
          const isAnchorEnd = numericValue === 0 && previousValue !== 0;
          nextRow[key] = numericValue !== 0 || isAnchorStart || isAnchorEnd ? numericValue : null;
        }

        return nextRow;
      }),
    [data, keys],
  );

  return (
    <HistoryChartFrame seriesKeys={keys} colorMode={colorMode}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            tabIndex={-1}
            onMouseDown={(_state, event) => suppressChartFocus(event)}
            onClick={(state) => selection?.onDateClick?.(getChartInteractionDate(state) ?? "")}
            onMouseMove={(state) => selection?.onHoverDate?.(getChartInteractionDate(state))}
            onMouseLeave={() => selection?.onHoverDate?.(undefined)}
          >
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <HistoryRangeHighlight selection={selection} />
            <HistoryXAxis axisMeta={axisMeta} privacyMode={privacyMode} />
            <HistoryYAxis currency={currency} privacyMode={privacyMode} />
            <HistoryTooltip currency={currency} seriesKeys={keys} colorMode={colorMode} />
            {keys.map((key, index) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stackId="history"
                stroke={getSeriesColor(key, index, colorMode)}
                strokeWidth={2.4}
                fill={hexToRgba(getSeriesColor(key, index, colorMode), 0.16)}
                fillOpacity={1}
                connectNulls={false}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
    </HistoryChartFrame>
  );
}

export function PlainHistoryLineChart({
  data,
  currency,
  selection,
  colorMode = "generic",
}: {
  data: Array<Record<string, string | number>>;
  currency: "USD" | "CNY";
  selection?: HistoryRangeSelection;
  colorMode?: HistorySeriesColorMode;
}) {
  const { privacyMode } = useAppPreferences();
  const keys = useMemo(() => getVisibleSeriesKeys(data), [data]);
  const axisMeta = useMemo(() => buildHistoryAxisMeta(data), [data]);

  return (
    <HistoryChartFrame seriesKeys={keys} colorMode={colorMode}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            tabIndex={-1}
            onMouseDown={(_state, event) => suppressChartFocus(event)}
            onClick={(state) => selection?.onDateClick?.(getChartInteractionDate(state) ?? "")}
            onMouseMove={(state) => selection?.onHoverDate?.(getChartInteractionDate(state))}
            onMouseLeave={() => selection?.onHoverDate?.(undefined)}
          >
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <HistoryRangeHighlight selection={selection} />
            <HistoryXAxis axisMeta={axisMeta} privacyMode={privacyMode} />
            <HistoryYAxis currency={currency} privacyMode={privacyMode} />
            <HistoryTooltip currency={currency} seriesKeys={keys} colorMode={colorMode} />
            {keys.map((key, index) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={getSeriesColor(key, index, colorMode)}
                strokeWidth={2.2}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
    </HistoryChartFrame>
  );
}
