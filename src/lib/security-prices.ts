import { parseCsv } from "@/lib/csv";
import { getEnvValue, hasAlphaVantageApiKey } from "@/lib/env";
import { withAlphaVantageThrottle } from "@/lib/sync-queue";
import { invalidatePortfolioCache } from "@/lib/cache";
import { ensureStoreFiles, readSecurityPriceHistory, writeSecurityPriceHistory } from "@/lib/store";
import { getLatestUsMarketSessionDayKey, toNewYorkDayKey } from "@/lib/utils";
import type {
  CurrencyCode,
  SecurityHoldingPeriod,
  SecurityPriceCoverage,
  SecurityPriceHistoryRow,
} from "@/lib/types";

const SECURITY_PRICE_SOURCE = "Alpha Vantage TIME_SERIES_DAILY";
const NASDAQ_PRICE_SOURCE = "Nasdaq historical API fallback";
const YAHOO_PRICE_SOURCE = "Yahoo Finance chart API fallback";
const ALPHA_VANTAGE_FETCH_TIMEOUT_MS = 20000;
const NASDAQ_FETCH_TIMEOUT_MS = 20000;
const YAHOO_FETCH_TIMEOUT_MS = 20000;
let alphaVantageDailyLimitReached = false;

function toDayKey(value: string | Date) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  return toNewYorkDayKey(value);
}

function addDays(dayKey: string, days: number) {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function normalizeSecuritySymbol(value?: string | null) {
  const normalized = value?.trim().toUpperCase();
  return normalized ? normalized : null;
}

function sortPriceRows(rows: SecurityPriceHistoryRow[]) {
  return [...rows].sort((left, right) => left.date.localeCompare(right.date));
}

function mergePriceRows(rows: SecurityPriceHistoryRow[]) {
  const bySymbolDate = new Map<string, SecurityPriceHistoryRow>();

  for (const row of rows) {
    const symbol = normalizeSecuritySymbol(row.symbol);
    if (!symbol || !row.date) continue;
    bySymbolDate.set(`${symbol}:${row.date}`, {
      ...row,
      symbol,
    });
  }

  return sortPriceRows(Array.from(bySymbolDate.values()));
}

function buildCoverage(
  symbol: string,
  rows: SecurityPriceHistoryRow[],
  state: SecurityPriceCoverage["state"],
): SecurityPriceCoverage {
  const sorted = sortPriceRows(rows);
  const first = sorted[0];
  const last = sorted.at(-1);

  return {
    symbol,
    state,
    coverageStart: first?.date,
    coverageEnd: last?.date,
    syncedThrough: last?.date,
    source: last?.source || first?.source || SECURITY_PRICE_SOURCE,
  };
}

function normalizeHoldingPeriods(holdingPeriods?: SecurityHoldingPeriod[]) {
  return [...(holdingPeriods ?? [])]
    .filter((period) => period.startDate)
    .map((period) => ({
      startDate: toDayKey(period.startDate),
      endDate: period.endDate ? toDayKey(period.endDate) : undefined,
    }))
    .sort((left, right) => left.startDate.localeCompare(right.startDate));
}

function getHoldingRange(holdingPeriods?: SecurityHoldingPeriod[]) {
  const normalized = normalizeHoldingPeriods(holdingPeriods);
  if (!normalized.length) {
    return null;
  }

  return {
    periods: normalized,
    firstStart: normalized[0].startDate,
    finalEnd: normalized.at(-1)?.endDate,
  };
}

function isDateWithinHoldingPeriods(date: string, holdingPeriods?: SecurityHoldingPeriod[]) {
  const normalized = normalizeHoldingPeriods(holdingPeriods);
  if (!normalized.length) {
    return true;
  }

  return normalized.some((period) => date >= period.startDate && (!period.endDate || date <= period.endDate));
}

function restrictRowsToHoldingPeriods(
  rows: SecurityPriceHistoryRow[],
  symbol: string,
  holdingPeriods?: SecurityHoldingPeriod[],
) {
  const normalizedSymbol = normalizeSecuritySymbol(symbol);
  if (!normalizedSymbol) {
    return rows;
  }

  const normalizedPeriods = normalizeHoldingPeriods(holdingPeriods);
  if (!normalizedPeriods.length) {
    return rows;
  }

  return rows.filter((row) => {
    if (row.symbol !== normalizedSymbol) {
      return true;
    }

    return isDateWithinHoldingPeriods(row.date, normalizedPeriods);
  });
}

function isFullHistoryPremiumError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return /premium feature/i.test(error.message) || /premium plans/i.test(error.message);
}

function isAlphaVantageRateLimitMessage(message: string) {
  return /rate limit|call frequency|5 calls per minute|higher API call frequency/i.test(message);
}

function isAlphaVantageDailyLimitMessage(message: string) {
  return /25 requests per day|daily rate limit/i.test(message);
}

function needsFallbackCoverage(
  rows: SecurityPriceHistoryRow[],
  targetEnd: string,
  holdingPeriods?: SecurityHoldingPeriod[],
) {
  const normalizedPeriods = normalizeHoldingPeriods(holdingPeriods);
  if (!normalizedPeriods.length) {
    return false;
  }

  return normalizedPeriods.some((period) => {
    const rowsInPeriod = rows
      .filter((row) => row.date >= period.startDate && (!period.endDate || row.date <= period.endDate))
      .sort((left, right) => left.date.localeCompare(right.date));

    if (!rowsInPeriod.length) {
      return true;
    }

    const expectedEnd = period.endDate ?? targetEnd;
    return rowsInPeriod[0].date > period.startDate || rowsInPeriod.at(-1)!.date < expectedEnd;
  });
}

function getCalendarDayDiff(fromDate: string, toDate: string) {
  const from = new Date(`${fromDate}T00:00:00.000Z`).getTime();
  const to = new Date(`${toDate}T00:00:00.000Z`).getTime();
  return Math.floor((to - from) / (24 * 60 * 60 * 1000));
}

function isRecentOpenEndedCoverage(
  rows: SecurityPriceHistoryRow[],
  targetEnd: string,
  holdingPeriods?: SecurityHoldingPeriod[],
) {
  const normalizedPeriods = normalizeHoldingPeriods(holdingPeriods);
  const hasOpenEndedPeriod = normalizedPeriods.some((period) => !period.endDate);
  if (!hasOpenEndedPeriod) {
    return false;
  }

  const lastRow = sortPriceRows(rows).at(-1);
  if (!lastRow) {
    return false;
  }

  const trailingGap = getCalendarDayDiff(lastRow.date, targetEnd);
  return trailingGap >= 0 && trailingGap <= 4;
}

async function fetchAlphaVantageDailyCsv(symbol: string, outputSize: "compact" | "full") {
  if (alphaVantageDailyLimitReached) {
    return [] as SecurityPriceHistoryRow[];
  }

  const apiKey = (await getEnvValue("ALPHA_VANTAGE_API_KEY")).trim();
  if (!apiKey) {
    throw new Error("missing_api_key");
  }

  const url = new URL("https://www.alphavantage.co/query");
  url.searchParams.set("function", "TIME_SERIES_DAILY");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("datatype", "csv");
  url.searchParams.set("outputsize", outputSize);
  url.searchParams.set("apikey", apiKey);

  let response: Response;

  try {
    response = await withAlphaVantageThrottle(() =>
      fetch(url.toString(), {
        cache: "no-store",
        signal: AbortSignal.timeout(ALPHA_VANTAGE_FETCH_TIMEOUT_MS),
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error("Alpha Vantage 同步超时，请稍后重试");
    }

    throw new Error(error instanceof Error ? `Alpha Vantage 同步失败：${error.message}` : "Alpha Vantage 同步失败");
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch security prices (${response.status})`);
  }

  const raw = await response.text();
  const trimmed = raw.trim();
  if (!trimmed) {
    return [] as SecurityPriceHistoryRow[];
  }

  if (trimmed.startsWith("{")) {
    const json = JSON.parse(trimmed) as {
      Note?: string;
      Information?: string;
      "Error Message"?: string;
    };
    const message = json["Error Message"] || json.Note || json.Information || "Failed to fetch security prices";
    if (isAlphaVantageDailyLimitMessage(message)) {
      alphaVantageDailyLimitReached = true;
      throw new Error(`Alpha Vantage daily limit: ${message}`);
    }
    if (isAlphaVantageRateLimitMessage(message)) {
      throw new Error(`Alpha Vantage rate limit: ${message}`);
    }
    throw new Error(message);
  }

  const [headerRow = [], ...dataRows] = parseCsv(raw);
  const headerIndex = new Map(headerRow.map((column, index) => [column, index]));
  const dateIndex = headerIndex.get("timestamp") ?? -1;
  const closeIndex = headerIndex.get("close") ?? -1;
  const fetchedAt = new Date().toISOString();

  return dataRows
    .map((row) => {
      const date = row[dateIndex] ?? "";
      const close = Number(row[closeIndex] ?? "");
      if (!date || !Number.isFinite(close)) {
        return null;
      }

      return {
        symbol,
        date,
        close,
        currency: "USD" as CurrencyCode,
        source: SECURITY_PRICE_SOURCE,
        fetchedAt,
      } satisfies SecurityPriceHistoryRow;
    })
    .filter((row): row is SecurityPriceHistoryRow => Boolean(row));
}

async function fetchNasdaqHistoricalRowsForAssetClass(
  symbol: string,
  startDate: string,
  endDate: string,
  assetClass: "stocks" | "etf",
) {
  const requestEndDate = endDate <= startDate ? addDays(endDate, 1) : endDate;
  const url = new URL(`https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/historical`);
  url.searchParams.set("assetclass", assetClass);
  url.searchParams.set("fromdate", startDate);
  url.searchParams.set("todate", requestEndDate);
  url.searchParams.set("limit", "9999");

  let response: Response;

  try {
    response = await fetch(url.toString(), {
      cache: "no-store",
      signal: AbortSignal.timeout(NASDAQ_FETCH_TIMEOUT_MS),
      headers: {
        "user-agent": "Mozilla/5.0",
        accept: "application/json",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error("Nasdaq 同步超时，请稍后重试");
    }

    throw new Error(error instanceof Error ? `Nasdaq 同步失败：${error.message}` : "Nasdaq 同步失败");
  }

  if (!response.ok) {
    throw new Error(`Nasdaq 同步失败：返回 ${response.status}`);
  }

  const payload = (await response.json()) as {
    data?: {
      tradesTable?: {
        rows?: Array<{
          date?: string;
          close?: string;
        }>;
      };
    } | null;
  };
  const fetchedAt = new Date().toISOString();
  const rows = payload.data?.tradesTable?.rows ?? [];

  if (!Array.isArray(rows)) {
    throw new Error("Nasdaq 同步失败：返回格式异常");
  }

  return rows
    .map((row) => {
      const date = row.date
        ? (() => {
            const [month, day, year] = row.date.split("/");
            return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
          })()
        : "";
      const close = Number(String(row.close ?? "").replace(/[$,]/g, ""));
      if (!date || !Number.isFinite(close) || close <= 0) {
        return null;
      }

      return {
        symbol,
        date,
        close,
        currency: "USD" as CurrencyCode,
        source: NASDAQ_PRICE_SOURCE,
        fetchedAt,
      } satisfies SecurityPriceHistoryRow;
    })
    .filter((row): row is SecurityPriceHistoryRow => Boolean(row));
}

async function fetchNasdaqHistoricalRows(symbol: string, startDate: string, endDate: string) {
  const rowsByAssetClass = await Promise.allSettled([
    fetchNasdaqHistoricalRowsForAssetClass(symbol, startDate, endDate, "stocks"),
    fetchNasdaqHistoricalRowsForAssetClass(symbol, startDate, endDate, "etf"),
  ]);

  const successfulRows = rowsByAssetClass
    .filter(
      (result): result is PromiseFulfilledResult<SecurityPriceHistoryRow[]> => result.status === "fulfilled",
    )
    .flatMap((result) => result.value);

  if (successfulRows.length) {
    return mergePriceRows(successfulRows);
  }

  const firstRejected = rowsByAssetClass.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (firstRejected) {
    throw firstRejected.reason instanceof Error ? firstRejected.reason : new Error("Nasdaq 同步失败");
  }

  return [] as SecurityPriceHistoryRow[];
}

async function fetchYahooHistoricalRows(symbol: string, startDate: string, endDate: string) {
  const startTimestamp = Math.floor(new Date(`${startDate}T00:00:00.000Z`).getTime() / 1000);
  const requestEndDate = addDays(endDate, 1);
  const endTimestamp = Math.floor(new Date(`${requestEndDate}T00:00:00.000Z`).getTime() / 1000);
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("period1", String(startTimestamp));
  url.searchParams.set("period2", String(endTimestamp));
  url.searchParams.set("interval", "1d");
  url.searchParams.set("includePrePost", "false");
  url.searchParams.set("events", "div,splits");

  let response: Response;

  try {
    response = await fetch(url.toString(), {
      cache: "no-store",
      signal: AbortSignal.timeout(YAHOO_FETCH_TIMEOUT_MS),
      headers: {
        "user-agent": "Mozilla/5.0",
        accept: "application/json",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error("Yahoo Finance 同步超时，请稍后重试");
    }

    throw new Error(error instanceof Error ? `Yahoo Finance 同步失败：${error.message}` : "Yahoo Finance 同步失败");
  }

  if (!response.ok) {
    throw new Error(`Yahoo Finance 同步失败：返回 ${response.status}`);
  }

  const payload = (await response.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: {
          adjclose?: Array<{ adjclose?: Array<number | null> }>;
          quote?: Array<{ close?: Array<number | null> }>;
        };
      }>;
      error?: { description?: string } | null;
    };
  };

  if (payload.chart?.error?.description) {
    throw new Error(`Yahoo Finance 同步失败：${payload.chart.error.description}`);
  }

  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const adjustedCloses = result?.indicators?.adjclose?.[0]?.adjclose ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const fetchedAt = new Date().toISOString();

  return timestamps
    .map((timestamp, index) => {
      const close = adjustedCloses[index] ?? closes[index];
      if (!Number.isFinite(close) || !close || close <= 0) {
        return null;
      }

      return {
        symbol,
        date: new Date(timestamp * 1000).toISOString().slice(0, 10),
        close,
        currency: "USD" as CurrencyCode,
        source: YAHOO_PRICE_SOURCE,
        fetchedAt,
      } satisfies SecurityPriceHistoryRow;
    })
    .filter((row): row is SecurityPriceHistoryRow => Boolean(row));
}

export async function readSecurityPriceRows() {
  await ensureStoreFiles();
  return mergePriceRows(await readSecurityPriceHistory());
}

export async function readSecurityPriceRowsForSymbol(symbol: string) {
  const normalizedSymbol = normalizeSecuritySymbol(symbol);
  if (!normalizedSymbol) return [];

  const rows = await readSecurityPriceRows();
  return rows.filter((row) => row.symbol === normalizedSymbol);
}

export async function getSecurityPriceCoverage(symbol: string) {
  const normalizedSymbol = normalizeSecuritySymbol(symbol);
  if (!normalizedSymbol) {
    return null;
  }

  const rows = await readSecurityPriceRowsForSymbol(normalizedSymbol);
  if (!rows.length) {
    return {
      symbol: normalizedSymbol,
      state: "not_synced",
    } satisfies SecurityPriceCoverage;
  }

  return buildCoverage(normalizedSymbol, rows, "synced");
}

export async function syncSecurityPriceHistory({
  symbol,
  startDate,
  holdingPeriods,
}: {
  symbol?: string | null;
  startDate: string;
  holdingPeriods?: SecurityHoldingPeriod[];
}) {
  const normalizedSymbol = normalizeSecuritySymbol(symbol);
  if (!normalizedSymbol) {
    return null;
  }

  const normalizedHoldingPeriods = normalizeHoldingPeriods(holdingPeriods);
  const effectiveHoldingPeriods = normalizedHoldingPeriods.filter(
    (period) => !period.endDate || period.endDate > period.startDate,
  );
  if (normalizedHoldingPeriods.length && !effectiveHoldingPeriods.length) {
    return {
      symbol: normalizedSymbol,
      state: "synced",
    } satisfies SecurityPriceCoverage;
  }

  await ensureStoreFiles();
  const alphaVantageEnabled = await hasAlphaVantageApiKey();

  const holdingRange = getHoldingRange(effectiveHoldingPeriods);
  const requiredStart = holdingRange?.firstStart ?? toDayKey(startDate);
  const latestExpectedMarketDate = getLatestUsMarketSessionDayKey();
  const targetEnd = holdingRange?.finalEnd ?? latestExpectedMarketDate;
  if (requiredStart > targetEnd) {
    return {
      symbol: normalizedSymbol,
      state: "not_synced",
    } satisfies SecurityPriceCoverage;
  }

  const allRows = await readSecurityPriceRows();
  const existingRows = allRows.filter((row) => row.symbol === normalizedSymbol);
  const first = existingRows[0]?.date;
  const last = existingRows.at(-1)?.date;
  const fetchedRows: SecurityPriceHistoryRow[] = [];
  const needsOlderHistory = !first || requiredStart < first;

  if (alphaVantageEnabled) {
    if (!existingRows.length) {
      try {
        const compactRows = await fetchAlphaVantageDailyCsv(normalizedSymbol, "compact");
        fetchedRows.push(...compactRows);

        const oldestCompactDate = sortPriceRows(compactRows)[0]?.date;
        if (oldestCompactDate && requiredStart < oldestCompactDate) {
          try {
            fetchedRows.push(...(await fetchAlphaVantageDailyCsv(normalizedSymbol, "full")));
          } catch (error) {
            if (!isFullHistoryPremiumError(error)) {
              throw error;
            }
          }
        }
      } catch {
        // Fall back to Nasdaq when Alpha Vantage is unavailable or quota-limited.
      }
    } else {
      if (first && requiredStart < first) {
        try {
          fetchedRows.push(...(await fetchAlphaVantageDailyCsv(normalizedSymbol, "full")));
        } catch (error) {
          if (!isFullHistoryPremiumError(error)) {
            // Fall back to Nasdaq when Alpha Vantage is unavailable or quota-limited.
          }
        }
      }

      if (last && last < targetEnd) {
        try {
          fetchedRows.push(...(await fetchAlphaVantageDailyCsv(normalizedSymbol, "compact")));
        } catch {
          // Fall back to Nasdaq when Alpha Vantage is unavailable or quota-limited.
        }
      }
    }
  }

  const normalizedFetchedRows = fetchedRows
    .filter((row) => row.date >= requiredStart && row.date <= targetEnd)
    .map((row) => ({
      ...row,
      currency: "USD" as CurrencyCode,
    }));

  const filteredExistingRows = existingRows.filter((row) => isDateWithinHoldingPeriods(row.date, effectiveHoldingPeriods));
  let mergedRows = mergePriceRows(
    restrictRowsToHoldingPeriods([...allRows, ...normalizedFetchedRows], normalizedSymbol, effectiveHoldingPeriods),
  );
  let finalRows = mergedRows.filter((row) => row.symbol === normalizedSymbol);

  let fallbackError: Error | null = null;

  if (needsFallbackCoverage(finalRows, targetEnd, effectiveHoldingPeriods)) {
    try {
      const nasdaqRows = await fetchNasdaqHistoricalRows(normalizedSymbol, requiredStart, targetEnd);
      const normalizedNasdaqRows = nasdaqRows
        .filter((row) => row.date >= requiredStart && row.date <= targetEnd)
        .map((row) => ({
          ...row,
          currency: "USD" as CurrencyCode,
        }));

      mergedRows = mergePriceRows(
        restrictRowsToHoldingPeriods([...mergedRows, ...normalizedNasdaqRows], normalizedSymbol, effectiveHoldingPeriods),
      );
      finalRows = mergedRows.filter((row) => row.symbol === normalizedSymbol);
    } catch (error) {
      fallbackError = error instanceof Error ? error : new Error("Nasdaq 同步失败");
    }
  }

  if (needsFallbackCoverage(finalRows, targetEnd, effectiveHoldingPeriods)) {
    try {
      const yahooRows = await fetchYahooHistoricalRows(normalizedSymbol, requiredStart, targetEnd);
      const normalizedYahooRows = yahooRows
        .filter((row) => row.date >= requiredStart && row.date <= targetEnd)
        .map((row) => ({
          ...row,
          currency: "USD" as CurrencyCode,
        }));

      mergedRows = mergePriceRows(
        restrictRowsToHoldingPeriods([...mergedRows, ...normalizedYahooRows], normalizedSymbol, effectiveHoldingPeriods),
      );
      finalRows = mergedRows.filter((row) => row.symbol === normalizedSymbol);
    } catch (error) {
      fallbackError = error instanceof Error ? error : new Error("Yahoo Finance 同步失败");
    }
  }

  if (!finalRows.length && fallbackError) {
    throw fallbackError;
  }

  if (!fetchedRows.length && finalRows.length === filteredExistingRows.length) {
    return buildCoverage(normalizedSymbol, finalRows, "synced");
  }

  await writeSecurityPriceHistory(mergedRows);
  void invalidatePortfolioCache();
  const actualCoverageStart = finalRows[0]?.date;
  const stillMissingCoverage = needsFallbackCoverage(finalRows, targetEnd, effectiveHoldingPeriods);
  const coverageState =
    actualCoverageStart &&
    (actualCoverageStart > requiredStart ||
      (stillMissingCoverage && !isRecentOpenEndedCoverage(finalRows, targetEnd, effectiveHoldingPeriods)))
      ? "partial"
      : "synced";

  return buildCoverage(
    normalizedSymbol,
    finalRows,
    needsOlderHistory && coverageState === "partial" ? "partial" : coverageState,
  );
}
