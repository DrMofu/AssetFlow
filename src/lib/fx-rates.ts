import { addDays, subDays } from "date-fns";

import { parseCsv } from "@/lib/csv";
import { invalidatePortfolioCache } from "@/lib/cache";
import { ensureStoreFiles, readFxDailyRates, writeFxDailyRates } from "@/lib/store";
import { getLocalDayKey } from "@/lib/utils";
import type { FxCoverage, FxDailyRateRow, FxRateSnapshot } from "@/lib/types";

const FRANKFURTER_SOURCE = "Frankfurter (ECB-backed)";
const FRED_SOURCE = "FRED DEXCHUS";
const FRANKFURTER_FETCH_TIMEOUT_MS = 12000;
const FRED_FETCH_TIMEOUT_MS = 15000;

function toDayKey(value: string | Date) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  return new Date(value).toISOString().slice(0, 10);
}

function toIsoDate(date: string) {
  return `${date}T00:00:00.000Z`;
}

function buildSnapshotId(prefix: string, date: string) {
  return `${prefix}_${date.replaceAll("-", "_")}`;
}

function sortFxRows(rows: FxDailyRateRow[]) {
  return [...rows].sort((left, right) => left.date.localeCompare(right.date));
}

function mergeFxRows(rows: FxDailyRateRow[]) {
  const byDate = new Map<string, FxDailyRateRow>();

  for (const row of rows) {
    if (!row.date) continue;
    byDate.set(row.date, row);
  }

  return sortFxRows(Array.from(byDate.values()));
}

function buildFxRow(date: string, usdToCny: number, source: string, fetchedAt: string) {
  return {
    date,
    usdToCny,
    cnyToUsd: 1 / usdToCny,
    source,
    fetchedAt,
  } satisfies FxDailyRateRow;
}

function buildFxCoverage(rows: FxDailyRateRow[]): FxCoverage {
  const sorted = sortFxRows(rows);
  const first = sorted[0];
  const last = sorted.at(-1);

  if (!first || !last) {
    return {
      state: "not_synced",
    };
  }

  return {
    state: "synced",
    coverageStart: first.date,
    coverageEnd: last.date,
    syncedThrough: last.date,
    source: last.source || first.source || FRED_SOURCE,
  };
}

async function fetchFredFxRange(startDate: string, endDate: string) {
  const url = new URL("https://fred.stlouisfed.org/graph/fredgraph.csv");
  url.searchParams.set("id", "DEXCHUS");
  url.searchParams.set("cosd", startDate);
  url.searchParams.set("coed", endDate);
  let response: Response;

  try {
    response = await fetch(url.toString(), {
      cache: "no-store",
      signal: AbortSignal.timeout(FRED_FETCH_TIMEOUT_MS),
      headers: {
        "user-agent": "Mozilla/5.0",
        accept: "text/csv,application/json;q=0.9,*/*;q=0.8",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error("汇率同步超时：FRED 响应过慢，请稍后重试");
    }

    throw new Error(error instanceof Error ? `汇率同步失败：${error.message}` : "汇率同步失败");
  }

  if (!response.ok) {
    throw new Error(`汇率同步失败：FRED 返回 ${response.status}`);
  }

  const raw = await response.text();
  if (!raw.includes("observation_date") || !raw.includes("DEXCHUS")) {
    throw new Error("汇率同步失败：FRED 返回了异常内容");
  }
  const [headerRow = [], ...dataRows] = parseCsv(raw);
  const headerIndex = new Map(headerRow.map((column, index) => [column, index]));
  const dateIndex = headerIndex.get("observation_date") ?? -1;
  const valueIndex = headerIndex.get("DEXCHUS") ?? -1;
  const fetchedAt = new Date().toISOString();

  if (dateIndex < 0 || valueIndex < 0) {
    throw new Error("汇率同步失败：FRED 返回格式异常");
  }

  return dataRows
    .map((row) => {
      const date = row[dateIndex] ?? "";
      const value = Number(row[valueIndex] ?? "");

      if (!date || !Number.isFinite(value) || value <= 0) {
        return null;
      }

      return buildFxRow(date, value, FRED_SOURCE, fetchedAt);
    })
    .filter((row): row is FxDailyRateRow => Boolean(row));
}

async function fetchFrankfurterFxRange(startDate: string, endDate: string) {
  const url = new URL(`https://api.frankfurter.dev/v1/${startDate}..${endDate}`);
  url.searchParams.set("base", "USD");
  url.searchParams.set("symbols", "CNY");

  let response: Response;

  try {
    response = await fetch(url.toString(), {
      cache: "no-store",
      signal: AbortSignal.timeout(FRANKFURTER_FETCH_TIMEOUT_MS),
      headers: {
        "user-agent": "Mozilla/5.0",
        accept: "application/json",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error("汇率同步超时：Frankfurter 响应过慢，请稍后重试");
    }

    throw new Error(error instanceof Error ? `汇率同步失败：${error.message}` : "汇率同步失败");
  }

  if (!response.ok) {
    throw new Error(`汇率同步失败：Frankfurter 返回 ${response.status}`);
  }

  const payload = (await response.json()) as {
    rates?: Record<string, { CNY?: number }>;
  };
  const fetchedAt = new Date().toISOString();
  const rates = payload.rates ?? {};

  return Object.entries(rates)
    .map(([date, row]) => {
      const value = Number(row?.CNY);
      if (!date || !Number.isFinite(value) || value <= 0) {
        return null;
      }

      return buildFxRow(date, value, FRANKFURTER_SOURCE, fetchedAt);
    })
    .filter((row): row is FxDailyRateRow => Boolean(row));
}

async function fetchFxRange(startDate: string, endDate: string) {
  const results = await Promise.allSettled([
    fetchFrankfurterFxRange(startDate, endDate),
    fetchFredFxRange(startDate, endDate),
  ]);

  const frankfurterRows = results[0].status === "fulfilled" ? results[0].value : [];
  const fredRows = results[1].status === "fulfilled" ? results[1].value : [];
  const mergedRows = mergeFxRows([...fredRows, ...frankfurterRows]);

  if (mergedRows.length) {
    return mergedRows;
  }

  const errors = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => (result.reason instanceof Error ? result.reason.message : String(result.reason)));

  throw new Error(errors[0] ?? "汇率同步失败：没有可用的数据源");
}

export async function readFxDailyRateRows() {
  await ensureStoreFiles();
  return sortFxRows(await readFxDailyRates());
}

export async function getFxCoverage() {
  const rows = await readFxDailyRateRows();
  return buildFxCoverage(rows);
}

export async function syncFxDailyHistory(startDate: string) {
  await ensureStoreFiles();

  const requiredStart = toDayKey(startDate);
  const today = getLocalDayKey();
  if (requiredStart > today) {
    return getFxCoverage();
  }

  const existingRows = await readFxDailyRateRows();
  const first = existingRows[0]?.date;
  const last = existingRows.at(-1)?.date;
  const fetchedRows: FxDailyRateRow[] = [];

  if (!existingRows.length) {
    fetchedRows.push(...(await fetchFxRange(requiredStart, today)));
  } else {
    if (first && requiredStart < first) {
      fetchedRows.push(
        ...(await fetchFxRange(requiredStart, toDayKey(subDays(new Date(`${first}T00:00:00.000Z`), 1)))),
      );
    }

    if (last && last < today) {
      fetchedRows.push(
        ...(await fetchFxRange(
          toDayKey(addDays(new Date(`${last}T00:00:00.000Z`), 1)),
          today,
        )),
      );
    }
  }

  // Only keep rows for dates not already present in the CSV to avoid redundant writes
  // (e.g. Frankfurter returning the most-recent business-day rate for a weekend query).
  const existingDateSet = new Set(existingRows.map((r) => r.date));
  const genuinelyNewRows = fetchedRows.filter((r) => !existingDateSet.has(r.date));

  if (!genuinelyNewRows.length) {
    return buildFxCoverage(existingRows);
  }

  const mergedRows = mergeFxRows([...existingRows, ...genuinelyNewRows]);
  await writeFxDailyRates(mergedRows);
  void invalidatePortfolioCache();
  return buildFxCoverage(mergedRows);
}

export async function readFxRateSnapshotsFromCsv() {
  const rows = await readFxDailyRateRows();

  return rows
    .flatMap((row) => [
      {
        id: buildSnapshotId("fx_usd_cny", row.date),
        baseCurrency: "USD",
        quoteCurrency: "CNY",
        rate: row.usdToCny,
        asOf: toIsoDate(row.date),
        source: row.source || FRED_SOURCE,
      },
      {
        id: buildSnapshotId("fx_cny_usd", row.date),
        baseCurrency: "CNY",
        quoteCurrency: "USD",
        rate: row.cnyToUsd,
        asOf: toIsoDate(row.date),
        source: row.source || FRED_SOURCE,
      },
    ] satisfies FxRateSnapshot[])
    .sort((left, right) => right.asOf.localeCompare(left.asOf));
}
