import type {
  AssetType,
  CurrencyCode,
  DateFormatPreference,
  HistoryChartMode,
  HistoryGroupBy,
  HistoryRangePreset,
} from "@/lib/types";

export const SUPPORTED_BASE_CURRENCIES: CurrencyCode[] = ["USD", "CNY"];
export const PERIOD_OPTIONS = ["1y", "ytd", "3y", "all"] as const;
export const PERIOD_LABELS: Record<(typeof PERIOD_OPTIONS)[number], string> = {
  "1y": "1年",
  ytd: "YTD",
  "3y": "3年",
  all: "全部",
};
export const HISTORY_GROUP_OPTIONS: HistoryGroupBy[] = ["total", "type", "folder", "asset"];
export const HISTORY_GROUP_LABELS: Record<HistoryGroupBy, string> = {
  total: "总资产",
  type: "按类型",
  folder: "按分类",
  asset: "按资产",
};
export const HISTORY_CHART_MODE_OPTIONS: HistoryChartMode[] = ["stacked", "line"];
export const HISTORY_CHART_MODE_LABELS: Record<HistoryChartMode, string> = {
  stacked: "堆叠图",
  line: "折线图",
};
export const HISTORY_RANGE_PRESET_OPTIONS: HistoryRangePreset[] = ["1w", "1m", "3m", "ytd", "1y", "3y", "all"];
export const HISTORY_RANGE_PRESET_LABELS: Record<HistoryRangePreset, string> = {
  "1w": "1W",
  "1m": "1M",
  "3m": "3M",
  ytd: "YTD",
  "1y": "1Y",
  "3y": "3Y",
  all: "ALL",
};

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  CASH: "现金",
  SECURITIES: "股票",
  OTHER: "其他",
};

export const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  USD: "$",
  CNY: "¥",
};

export const ASSET_MILESTONE_DEFAULT_TARGETS: Record<CurrencyCode, number[]> = {
  USD: [10_000, 100_000, 200_000, 500_000, 1_000_000],
  CNY: [10_000, 100_000, 200_000, 500_000, 1_000_000],
};

export const ASSET_MILESTONE_TARGET_LIMIT = 12;

export const DATE_FORMAT_LABELS: Record<DateFormatPreference, string> = {
  "en-month-day-year": "May 8, 2026",
  "zh-year-month-day": "2026年5月8日",
  "slash-year-month-day": "2026/05/08",
  "dash-year-month-day": "2026-05-08",
};

export const DATE_FORMAT_OPTIONS = Object.keys(DATE_FORMAT_LABELS) as DateFormatPreference[];
