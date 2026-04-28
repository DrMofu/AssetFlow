import { endOfDay, format, parseISO, startOfDay, startOfYear, subDays } from "date-fns";

import { CURRENCY_SYMBOLS } from "@/lib/constants";
import type { CurrencyCode, HistoryRangePreset, PeriodOption } from "@/lib/types";

function normalizeCurrencyDisplay(value: string, currency: CurrencyCode) {
  if (currency !== "CNY") {
    return value;
  }

  return value.replaceAll("CN¥", "¥");
}

export function formatCurrency(value: number, currency: CurrencyCode) {
  return normalizeCurrencyDisplay(new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value), currency);
}

export function formatCompactCurrency(value: number, currency: CurrencyCode) {
  return normalizeCurrencyDisplay(new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value), currency);
}

export function formatPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export function formatDelta(value: number, currency: CurrencyCode) {
  return `${value >= 0 ? "+" : "-"}${formatCurrency(Math.abs(value), currency)}`;
}

function resolveTimeZone(timeZone?: string) {
  const trimmed = timeZone?.trim();
  if (trimmed) {
    return trimmed;
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

const MONTH_SHORT_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function getDateParts(value: Date, timeZone?: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: resolveTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(value);
  return {
    year: parts.find((part) => part.type === "year")?.value ?? "1970",
    month: parts.find((part) => part.type === "month")?.value ?? "01",
    day: parts.find((part) => part.type === "day")?.value ?? "01",
  };
}

function looksLikeDayKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// "日历日"字面拆解，不参与时区平移。用于 yyyy-mm-dd 的 day key 输入。
function partsFromDayKey(dayKey: string) {
  const [year, month, day] = dayKey.split("-");
  return { year, month, day };
}

function partsForDisplay(value: string, timeZone?: string) {
  if (looksLikeDayKey(value)) {
    return partsFromDayKey(value);
  }
  if (looksLikeDayKey(value.slice(0, 10)) && /T/.test(value)) {
    // 带 T 的完整时间戳：按时区格式化
    return getDateParts(parseISO(value), timeZone);
  }
  return getDateParts(parseISO(value), timeZone);
}

export function formatDateLabel(value: string, timeZone?: string) {
  const parts = partsForDisplay(value, timeZone);
  const monthIndex = Math.max(0, Math.min(11, Number(parts.month) - 1));
  return `${MONTH_SHORT_NAMES[monthIndex]} ${Number(parts.day)}`;
}

export function formatCalendarDateLabel(value: string, timeZone?: string) {
  const parts = partsForDisplay(value, timeZone);
  const monthIndex = Math.max(0, Math.min(11, Number(parts.month) - 1));
  return `${MONTH_SHORT_NAMES[monthIndex]} ${Number(parts.day)}, ${parts.year}`;
}

export function formatStoredCalendarDateLabel(value: string, timeZone?: string) {
  // 资产记录的 recordDate 多以 yyyy-mm-dd 起头；切片后字面拆，避免时区漂移
  if (looksLikeDayKey(value.slice(0, 10))) {
    return formatCalendarDateLabel(value.slice(0, 10), timeZone);
  }
  return formatCalendarDateLabel(value, timeZone);
}

export function formatDateTimeLabel(value: string, timeZone?: string) {
  return formatCalendarDateLabel(value, timeZone);
}

export function getLocalDayKey(value: Date = new Date(), timeZone?: string) {
  if (timeZone === undefined) {
    // 缺省维持旧行为，使用 date-fns 的本机时区格式化
    return format(value, "yyyy-MM-dd");
  }
  const parts = getDateParts(value, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getPeriodDays(period: PeriodOption) {
  if (period === "ytd") {
    const start = startOfYear(new Date());
    const today = startOfDay(new Date());
    return Math.max(1, Math.floor((today.getTime() - start.getTime()) / 86400000) + 1);
  }
  if (period === "3y") return 365 * 3;
  if (period === "all") return 365 * 10;
  return 365;
}

export function getPeriodStart(period: PeriodOption) {
  if (period === "ytd") return startOfYear(new Date());
  if (period === "3y") return subDays(new Date(), 365 * 3 - 1);
  return subDays(new Date(), getPeriodDays(period) - 1);
}

export function getHistoryRangeStart(preset: HistoryRangePreset) {
  if (preset === "1m") return startOfDay(subDays(new Date(), 29));
  if (preset === "3m") return startOfDay(subDays(new Date(), 89));
  if (preset === "ytd") return startOfYear(new Date());
  if (preset === "3y") return startOfDay(subDays(new Date(), 365 * 3 - 1));
  return startOfDay(subDays(new Date(), 364));
}

export function getHistoryRangeEnd() {
  return endOfDay(new Date());
}

export function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

export function createId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function symbolFor(currency: CurrencyCode) {
  return CURRENCY_SYMBOLS[currency];
}

export function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (value && typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  return Number(value ?? 0);
}

function getTimeZoneParts(
  value: Date,
  timeZone: string,
) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(value);

  return {
    year: parts.find((part) => part.type === "year")?.value ?? "1970",
    month: parts.find((part) => part.type === "month")?.value ?? "01",
    day: parts.find((part) => part.type === "day")?.value ?? "01",
    hour: Number(parts.find((part) => part.type === "hour")?.value ?? "0"),
    minute: Number(parts.find((part) => part.type === "minute")?.value ?? "0"),
  };
}

function isBusinessDay(dayKey: string) {
  const weekday = new Date(`${dayKey}T00:00:00.000Z`).getUTCDay();
  return weekday >= 1 && weekday <= 5;
}

function getPreviousBusinessDay(dayKey: string) {
  const cursor = new Date(`${dayKey}T00:00:00.000Z`);

  do {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  } while (!isBusinessDay(cursor.toISOString().slice(0, 10)));

  return cursor.toISOString().slice(0, 10);
}

export function toNewYorkDayKey(value: string | Date) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const date = typeof value === "string" ? new Date(value) : value;
  const parts = getTimeZoneParts(date, "America/New_York");
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getLatestUsMarketSessionDayKey(value: Date = new Date()) {
  const parts = getTimeZoneParts(value, "America/New_York");
  const currentDayKey = `${parts.year}-${parts.month}-${parts.day}`;

  if (!isBusinessDay(currentDayKey)) {
    return getPreviousBusinessDay(currentDayKey);
  }

  const minutesAfterMidnight = parts.hour * 60 + parts.minute;
  if (minutesAfterMidnight >= 16 * 60) {
    return currentDayKey;
  }

  return getPreviousBusinessDay(currentDayKey);
}

/**
 * Returns the most recent calendar day on which FX rates are published.
 * FX rates are only available on weekdays; on Saturday/Sunday this returns the preceding Friday.
 */
export function getLatestFxAvailableDayKey(value: Date = new Date()) {
  const dayKey = getLocalDayKey(value);
  if (isBusinessDay(dayKey)) return dayKey;
  return getPreviousBusinessDay(dayKey);
}
