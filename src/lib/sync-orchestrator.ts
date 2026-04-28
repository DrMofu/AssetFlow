import { syncFxDailyHistory } from "@/lib/fx-rates";
import { enqueueSyncTask } from "@/lib/sync-queue";
import { syncSecurityPriceHistory } from "@/lib/security-prices";
import { getLatestFxAvailableDayKey, getLatestUsMarketSessionDayKey, getLocalDayKey, toNewYorkDayKey } from "@/lib/utils";
import type { Asset, AssetRecord, FxRateSnapshot, SecurityHoldingPeriod, SecurityPriceHistoryRow } from "@/lib/types";

const SECURITY_QUANTITY_EPSILON = 0.0001;

function sortRecordsAsc(records: AssetRecord[]) {
  return [...records].sort((left, right) => {
    const dateOrder = left.recordDate.localeCompare(right.recordDate);
    if (dateOrder !== 0) return dateOrder;
    const createdOrder = left.createdAt.localeCompare(right.createdAt);
    if (createdOrder !== 0) return createdOrder;
    return left.id.localeCompare(right.id);
  });
}

function normalizeSecurityQuantity(quantity: number) {
  return Math.abs(quantity) < SECURITY_QUANTITY_EPSILON ? 0 : quantity;
}

function buildSecurityHoldingPeriods(records: AssetRecord[]) {
  const periods: SecurityHoldingPeriod[] = [];
  let quantity = 0;
  let openStartDate: string | null = null;

  for (const record of sortRecordsAsc(records)) {
    if (record.recordType === "VALUE_SNAPSHOT") {
      continue;
    }

    if (record.recordType === "STOCK_SNAPSHOT") {
      const nextQuantity = normalizeSecurityQuantity(record.quantity);
      if (quantity <= 0 && nextQuantity > 0) {
        openStartDate = record.recordDate.slice(0, 10);
      }
      if (quantity > 0 && nextQuantity <= 0 && openStartDate) {
        periods.push({ startDate: openStartDate, endDate: record.recordDate.slice(0, 10) });
        openStartDate = null;
      }
      quantity = nextQuantity;
      continue;
    }

    const nextQuantity = normalizeSecurityQuantity(
      quantity + (record.side === "BUY" ? record.quantity : -record.quantity),
    );
    if (quantity <= 0 && nextQuantity > 0) {
      openStartDate = record.recordDate.slice(0, 10);
    }
    if (quantity > 0 && nextQuantity <= 0 && openStartDate) {
      periods.push({ startDate: openStartDate, endDate: record.recordDate.slice(0, 10) });
      openStartDate = null;
    }
    quantity = nextQuantity;
  }

  if (quantity > 0 && openStartDate) {
    periods.push({ startDate: openStartDate });
  }

  return periods;
}

function toDayKey(value: string) {
  return toNewYorkDayKey(value);
}

function getCalendarDayDiff(fromDate: string, toDate: string) {
  const from = new Date(`${fromDate}T00:00:00.000Z`).getTime();
  const to = new Date(`${toDate}T00:00:00.000Z`).getTime();
  return Math.floor((to - from) / (24 * 60 * 60 * 1000));
}

function hasMeaningfulHoldingPeriod(periods: SecurityHoldingPeriod[]) {
  return periods.some((period) => !period.endDate || period.endDate > period.startDate);
}

function shouldSyncSecurityPriceHistory(
  symbol: string,
  holdingPeriods: SecurityHoldingPeriod[],
  groupedSecurityPrices: Map<string, SecurityPriceHistoryRow[]>,
) {
  if (!hasMeaningfulHoldingPeriod(holdingPeriods)) {
    return false;
  }

  const rows = [...(groupedSecurityPrices.get(symbol) ?? [])].sort((left, right) => left.date.localeCompare(right.date));
  if (!rows.length) {
    return true;
  }

  const today = getLatestUsMarketSessionDayKey();
  return holdingPeriods.some((period) => {
    if (period.endDate && period.endDate <= period.startDate) {
      return false;
    }

    const expectedEnd = period.endDate ?? today;
    const rowsInPeriod = rows.filter((row) => row.date >= period.startDate && row.date <= expectedEnd);
    if (!rowsInPeriod.length) {
      return true;
    }

    const firstDate = rowsInPeriod[0]?.date;
    const lastDate = rowsInPeriod.at(-1)?.date;
    if (!firstDate || firstDate > period.startDate) {
      return true;
    }

    if (period.endDate) {
      return !lastDate || lastDate < period.endDate;
    }

    if (!lastDate) {
      return true;
    }
    return lastDate < today;
  });
}

function shouldSyncFxHistory(earliestRecordDate: string, fxRateSnapshots: FxRateSnapshot[]) {
  const usdToCnyRows = [...fxRateSnapshots]
    .filter((row) => row.baseCurrency === "USD" && row.quoteCurrency === "CNY")
    .sort((left, right) => left.asOf.localeCompare(right.asOf));

  if (!usdToCnyRows.length) {
    return true;
  }

  // FX asOf values are stored as UTC midnight (e.g. "2026-04-25T00:00:00.000Z").
  // Using toDayKey() would convert to New York time, shifting the date one day earlier
  // (midnight UTC = 8pm EDT the day before), causing the system to think we're always
  // missing the latest rate. Extract the date portion directly from the ISO string instead.
  const firstDate = usdToCnyRows[0].asOf.slice(0, 10);
  const lastDate = (usdToCnyRows.at(-1)?.asOf ?? usdToCnyRows[0].asOf).slice(0, 10);
  // FX rates are only published on weekdays; compare against the most recent available date
  // rather than today's calendar date to avoid spurious weekend syncs.
  const latestAvailable = getLatestFxAvailableDayKey();

  if (earliestRecordDate < firstDate) {
    return true;
  }

  return getCalendarDayDiff(lastDate, latestAvailable) > 0;
}

export async function schedulePortfolioSync(
  assets: Asset[],
  groupedRecords: Map<string, AssetRecord[]>,
  groupedSecurityPrices: Map<string, SecurityPriceHistoryRow[]>,
  fxRateSnapshots: FxRateSnapshot[],
) {
  const allRecords = Array.from(groupedRecords.values()).flat();
  const earliestRecordDate = sortRecordsAsc(allRecords)[0]?.recordDate;

  if (earliestRecordDate && shouldSyncFxHistory(earliestRecordDate.slice(0, 10), fxRateSnapshots)) {
    await enqueueSyncTask({
      key: "fx:usd-cny-daily",
      kind: "fx_rate",
      label: "美元 / 人民币日汇率",
      run: async () => {
        await syncFxDailyHistory(earliestRecordDate);
      },
    });
  }

  for (const asset of assets) {
    if (asset.type !== "SECURITIES") {
      continue;
    }

    const records = sortRecordsAsc(groupedRecords.get(asset.id) ?? []);
    const earliestSecurityRecord = records.find((record) => record.recordType !== "VALUE_SNAPSHOT");
    const symbolRecord =
      records.findLast?.(
        (record): record is Extract<AssetRecord, { recordType: "STOCK_TRADE" | "STOCK_SNAPSHOT" }> =>
          record.recordType !== "VALUE_SNAPSHOT" && Boolean(record.symbol),
      ) ??
      [...records].reverse().find(
        (record): record is Extract<AssetRecord, { recordType: "STOCK_TRADE" | "STOCK_SNAPSHOT" }> =>
          record.recordType !== "VALUE_SNAPSHOT" && Boolean(record.symbol),
      );
    const symbol = symbolRecord?.symbol;

    if (!earliestSecurityRecord?.recordDate || !symbol) {
      continue;
    }

    const holdingPeriods = buildSecurityHoldingPeriods(records);
    if (!shouldSyncSecurityPriceHistory(symbol, holdingPeriods, groupedSecurityPrices)) {
      continue;
    }

    await enqueueSyncTask({
      key: `security:${symbol}`,
      kind: "security_price",
      label: `${symbol} 日价格`,
      run: async () => {
        await syncSecurityPriceHistory({
          symbol,
          startDate: earliestSecurityRecord.recordDate,
          holdingPeriods,
        });
      },
    });
  }
}
