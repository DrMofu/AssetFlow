import { cache } from "react";
import { format, subDays } from "date-fns";

import { ASSET_TYPE_LABELS } from "@/lib/constants";
import { hasAlphaVantageApiKey } from "@/lib/env";
import { getRepository } from "@/lib/repository";
import { schedulePortfolioSync } from "@/lib/sync-orchestrator";
import { readPortfolioCache, writePortfolioCache } from "@/lib/cache";
import type { PortfolioDailyCache } from "@/lib/cache";
import { readActiveArchiveId } from "@/lib/store";
import type {
  Asset,
  AssetDetailData,
  AssetRecord,
  AssetRecordViewRow,
  AssetSummary,
  AssetTimelineData,
  AssetTimelineEvent,
  AssetType,
  CurrencyCode,
  DataSyncOverview,
  DashboardData,
  DashboardSecurity,
  FxRateSnapshot,
  HistoryRangePreset,
  HistoryGroupBy,
  HistoryDataOptions,
  HistorySeriesRow,
  PeriodOption,
  SecurityPriceCoverage,
  SecurityPriceHistoryRow,
} from "@/lib/types";
import { getHistoryRangeEnd, getHistoryRangeStart, getPeriodDays, roundCurrency } from "@/lib/utils";

type EvaluatedAssetState = {
  nativeValue: number;
  convertedValue: number;
  latestRecordDate?: string;
  quantity?: number;
  averageCost?: number;
  unitPrice?: number;
  symbol?: string | null;
  profitLoss?: number;
  profitLossPct?: number;
};

type SecurityReplayState = {
  quantity: number;
  unitPrice: number;
  symbol?: string | null;
  averageCost: number;
  latestRecordDate?: string;
};

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

function latestFxByPair(items: FxRateSnapshot[]) {
  const map = new Map<string, FxRateSnapshot[]>();

  for (const item of items) {
    const key = `${item.baseCurrency}-${item.quoteCurrency}`;
    const current = map.get(key) ?? [];
    current.push(item);
    map.set(key, current);
  }

  for (const value of map.values()) {
    value.sort((left, right) => right.asOf.localeCompare(left.asOf));
  }

  return map;
}

function toDayKey(value: string) {
  return value.slice(0, 10);
}

function parseDayKey(value: string) {
  const dayKey = toDayKey(value);
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function formatDayKey(value: Date | string) {
  return format(typeof value === "string" ? parseDayKey(value) : value, "yyyy-MM-dd");
}

function normalizeSecurityQuantity(quantity: number) {
  return Math.abs(quantity) < SECURITY_QUANTITY_EPSILON ? 0 : quantity;
}

function groupSecurityPricesBySymbol(items: SecurityPriceHistoryRow[]) {
  const map = new Map<string, SecurityPriceHistoryRow[]>();

  for (const item of items) {
    const key = item.symbol;
    const current = map.get(key) ?? [];
    current.push(item);
    map.set(key, current);
  }

  for (const value of map.values()) {
    value.sort((left, right) => left.date.localeCompare(right.date));
  }

  return map;
}

function resolveSecurityClose(
  groupedSecurityPrices: Map<string, SecurityPriceHistoryRow[]>,
  symbol: string | null | undefined,
  targetDate: string,
) {
  if (!symbol) {
    return null;
  }

  const targetDay = toDayKey(targetDate);
  const rows = groupedSecurityPrices.get(symbol) ?? [];
  const match = [...rows].reverse().find((row) => row.date <= targetDay);
  return match?.close ?? null;
}

function getSecurityCoverageForSymbol(
  groupedSecurityPrices: Map<string, SecurityPriceHistoryRow[]>,
  symbol: string | null | undefined,
): SecurityPriceCoverage | null {
  if (!symbol) {
    return null;
  }

  const rows = groupedSecurityPrices.get(symbol) ?? [];
  const first = rows[0];
  const last = rows.at(-1);
  if (!first || !last) {
    return null;
  }

  return {
    symbol,
    state: "synced",
    coverageStart: first.date,
    coverageEnd: last.date,
    syncedThrough: last.date,
    source: last.source || first.source,
  };
}

function resolveRate(
  groupedRates: Map<string, FxRateSnapshot[]>,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  targetDate: string,
) {
  if (fromCurrency === toCurrency) return 1;

  const direct = groupedRates.get(`${fromCurrency}-${toCurrency}`) ?? [];
  const targetDay = toDayKey(targetDate);
  const directMatch = direct.find((rate) => toDayKey(rate.asOf) <= targetDay) ?? direct[0];
  if (directMatch) return directMatch.rate;

  const inverse = groupedRates.get(`${toCurrency}-${fromCurrency}`) ?? [];
  const inverseMatch = inverse.find((rate) => toDayKey(rate.asOf) <= targetDay) ?? inverse[0];
  if (inverseMatch) return 1 / inverseMatch.rate;

  return 1;
}

function convertAmountAtDate(
  amount: number,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  groupedRates: Map<string, FxRateSnapshot[]>,
  targetDate: string,
) {
  return roundCurrency(amount * resolveRate(groupedRates, fromCurrency, toCurrency, targetDate));
}

function replaySecurityRecords(records: AssetRecord[], targetDate: string) {
  const targetDay = toDayKey(targetDate);
  const state: SecurityReplayState = {
    quantity: 0,
    unitPrice: 0,
    symbol: null,
    averageCost: 0,
    latestRecordDate: undefined,
  };

  for (const record of sortRecordsAsc(records)) {
    if (toDayKey(record.recordDate) > targetDay || record.recordType === "VALUE_SNAPSHOT") {
      continue;
    }

    if (record.recordType === "STOCK_SNAPSHOT") {
      state.quantity = normalizeSecurityQuantity(record.quantity);
      state.unitPrice = record.unitPrice;
      state.averageCost = state.quantity > 0 ? record.unitPrice : 0;
      state.symbol = record.symbol ?? state.symbol ?? null;
      state.latestRecordDate = record.recordDate;
      continue;
    }

    if (record.side === "BUY") {
      const nextQuantity = state.quantity + record.quantity;
      state.averageCost =
        nextQuantity === 0
          ? 0
          : (state.quantity * state.averageCost + record.quantity * record.unitPrice) / nextQuantity;
      state.quantity = normalizeSecurityQuantity(nextQuantity);
    } else {
      state.quantity = normalizeSecurityQuantity(Math.max(0, state.quantity - record.quantity));
      if (state.quantity === 0) {
        state.averageCost = 0;
      }
    }

    state.unitPrice = record.unitPrice;
    state.symbol = record.symbol ?? state.symbol ?? null;
    state.latestRecordDate = record.recordDate;
  }

  return state;
}

function evaluateAssetAtDate(
  asset: Asset,
  records: AssetRecord[],
  groupedRates: Map<string, FxRateSnapshot[]>,
  groupedSecurityPrices: Map<string, SecurityPriceHistoryRow[]>,
  baseCurrency: CurrencyCode,
  targetDate: string,
): EvaluatedAssetState {
  if (asset.type === "SECURITIES") {
    const state = replaySecurityRecords(records, targetDate);
    const autoPrice = resolveSecurityClose(groupedSecurityPrices, state.symbol, targetDate);
    const effectiveUnitPrice = autoPrice ?? state.unitPrice;
    const nativeValue = roundCurrency(state.quantity * effectiveUnitPrice);
    const convertedValue = convertAmountAtDate(
      nativeValue,
      asset.currency,
      baseCurrency,
      groupedRates,
      targetDate,
    );
    const profitLoss = roundCurrency(state.quantity * (effectiveUnitPrice - state.averageCost));
    const investedCost = state.quantity * state.averageCost;
    const profitLossPct = investedCost === 0 ? 0 : (profitLoss / investedCost) * 100;

    return {
      nativeValue,
      convertedValue,
      latestRecordDate: state.latestRecordDate,
      quantity: state.quantity,
      averageCost: state.averageCost,
      unitPrice: effectiveUnitPrice,
      symbol: state.symbol ?? null,
      profitLoss,
      profitLossPct,
    };
  }

  const latestRecord = sortRecordsAsc(records)
    .filter(
      (
        record,
      ): record is Extract<AssetRecord, { recordType: "VALUE_SNAPSHOT" }> =>
        record.recordType === "VALUE_SNAPSHOT" && toDayKey(record.recordDate) <= toDayKey(targetDate),
    )
    .at(-1);
  const nativeValue = latestRecord?.amount ?? 0;

  return {
    nativeValue,
    convertedValue: convertAmountAtDate(
      nativeValue,
      asset.currency,
      baseCurrency,
      groupedRates,
      targetDate,
    ),
    latestRecordDate: latestRecord?.recordDate,
  };
}

function buildAssetTimelineEvents(records: AssetRecord[]) {
  const eventsByDate = new Map<string, AssetTimelineEvent[]>();

  for (const record of sortRecordsAsc(records)) {
    const key = toDayKey(record.recordDate);
    const current = eventsByDate.get(key) ?? [];

    if (record.recordType === "VALUE_SNAPSHOT") {
      current.push({
        id: record.id,
        date: record.recordDate,
        kind: "VALUE_SNAPSHOT",
        amount: record.amount,
        notes: record.notes ?? null,
      });
    } else if (record.recordType === "STOCK_SNAPSHOT") {
      current.push({
        id: record.id,
        date: record.recordDate,
        kind: "STOCK_SNAPSHOT",
        quantity: record.quantity,
        unitPrice: record.unitPrice,
        symbol: record.symbol ?? null,
        notes: record.notes ?? null,
      });
    } else {
      current.push({
        id: record.id,
        date: record.recordDate,
        kind: record.side,
        quantity: record.quantity,
        unitPrice: record.unitPrice,
        symbol: record.symbol ?? null,
        notes: record.notes ?? null,
      });
    }

    eventsByDate.set(key, current);
  }

  return eventsByDate;
}

function getSecurityTimelineEndDate(records: AssetRecord[]) {
  const securityRecords = sortRecordsAsc(
    records.filter((record) => record.recordType !== "VALUE_SNAPSHOT"),
  );
  const earliestRecordDate = securityRecords[0]?.recordDate;
  if (!earliestRecordDate) {
    return null;
  }

  const finalState = replaySecurityRecords(securityRecords, securityRecords.at(-1)?.recordDate ?? earliestRecordDate);
  if (finalState.quantity > 0) {
    return formatDayKey(getHistoryRangeEnd());
  }

  return toDayKey(finalState.latestRecordDate ?? earliestRecordDate);
}

function buildAssetTimeline(
  asset: Asset,
  records: AssetRecord[],
  groupedRates: Map<string, FxRateSnapshot[]>,
  groupedSecurityPrices: Map<string, SecurityPriceHistoryRow[]>,
  baseCurrency: CurrencyCode,
  options: {
    preset?: HistoryRangePreset;
    startDate?: string;
    endDate?: string;
  } = {},
): AssetTimelineData {
  const sortedRecords = sortRecordsAsc(records);
  const fullRangeStart = sortedRecords[0]?.recordDate;

  if (!fullRangeStart) {
    return {
      rangeStart: undefined,
      rangeEnd: undefined,
      hasSecurityPriceSeries: false,
      points: [],
    };
  }

  const fullRangeEnd =
    asset.type === "SECURITIES"
      ? getSecurityTimelineEndDate(sortedRecords)
      : formatDayKey(getHistoryRangeEnd());

  if (!fullRangeEnd) {
    return {
      rangeStart: fullRangeStart,
      rangeEnd: undefined,
      hasSecurityPriceSeries: false,
      points: [],
    };
  }

  const hasCustomRange =
    Boolean(options.startDate) &&
    Boolean(options.endDate) &&
    String(options.startDate) <= String(options.endDate);
  const preset = options.preset ?? "all";
  const rangeStart =
    hasCustomRange
      ? toDayKey(options.startDate ?? fullRangeStart)
      : preset === "all"
      ? toDayKey(fullRangeStart)
      : formatDayKey(getHistoryRangeStart(preset));
  const rangeEnd = hasCustomRange
    ? toDayKey(options.endDate ?? fullRangeEnd)
    : preset === "all"
      ? toDayKey(fullRangeEnd)
      : formatDayKey(getHistoryRangeEnd());

  const eventsByDate = buildAssetTimelineEvents(sortedRecords);
  const points = listDatesInRange(rangeStart, rangeEnd).map((date) => {
    const state = evaluateAssetAtDate(
      asset,
      sortedRecords,
      groupedRates,
      groupedSecurityPrices,
      baseCurrency,
      date,
    );
    const securityPrice =
      asset.type === "SECURITIES"
        ? resolveSecurityClose(groupedSecurityPrices, state.symbol, date)
        : null;

    return {
      date,
      totalValueNative: state.nativeValue,
      totalValueConverted: state.convertedValue,
      securityPrice,
      quantity: state.quantity ?? null,
      events: eventsByDate.get(toDayKey(date)) ?? [],
    };
  });

  return {
    rangeStart,
    rangeEnd,
    hasSecurityPriceSeries: points.some((point) => typeof point.securityPrice === "number"),
    points,
  };
}

function buildRecordViewRows(
  asset: Asset,
  records: AssetRecord[],
  groupedRates: Map<string, FxRateSnapshot[]>,
  baseCurrency: CurrencyCode,
) {
  const asc = sortRecordsAsc(records);
  const viewRows: AssetRecordViewRow[] = [];
  let quantity = 0;
  let unitPrice = 0;
  let averageCost = 0;

  for (const record of asc) {
    if (asset.type === "SECURITIES" && record.recordType !== "VALUE_SNAPSHOT") {
      if (record.recordType === "STOCK_SNAPSHOT") {
        quantity = normalizeSecurityQuantity(record.quantity);
        unitPrice = record.unitPrice;
        averageCost = quantity > 0 ? record.unitPrice : 0;
      } else if (record.side === "BUY") {
        const nextQuantity = quantity + record.quantity;
        averageCost =
          nextQuantity === 0
            ? 0
            : (quantity * averageCost + record.quantity * record.unitPrice) / nextQuantity;
        quantity = normalizeSecurityQuantity(nextQuantity);
        unitPrice = record.unitPrice;
      } else {
        quantity = normalizeSecurityQuantity(Math.max(0, quantity - record.quantity));
        unitPrice = record.unitPrice;
        if (quantity === 0) {
          averageCost = 0;
        }
      }

      viewRows.push({
        id: record.id,
        assetId: record.assetId,
        recordType: record.recordType,
        recordDate: record.recordDate,
        notes: record.notes ?? null,
        side: record.recordType === "STOCK_TRADE" ? record.side : undefined,
        quantity: record.quantity,
        unitPrice: record.unitPrice,
        symbol: record.symbol ?? null,
        resultingQuantity: quantity,
        resultingUnitPrice: unitPrice,
        resultingNativeValue: roundCurrency(quantity * unitPrice),
        resultingConvertedValue: convertAmountAtDate(
          roundCurrency(quantity * unitPrice),
          asset.currency,
          baseCurrency,
          groupedRates,
          record.recordDate.slice(0, 10),
        ),
      });
      continue;
    }

    if (record.recordType === "VALUE_SNAPSHOT") {
      viewRows.push({
        id: record.id,
        assetId: record.assetId,
        recordType: record.recordType,
        recordDate: record.recordDate,
        notes: record.notes ?? null,
        amount: record.amount,
        resultingNativeValue: record.amount,
        resultingConvertedValue: convertAmountAtDate(
          record.amount,
          asset.currency,
          baseCurrency,
          groupedRates,
          record.recordDate.slice(0, 10),
        ),
      });
    }
  }

  return viewRows.reverse();
}

// cache() deduplicates calls within a single React server-component render pass.
// Each new HTTP request gets a fresh call; API routes are unaffected.
const loadPortfolioContext = cache(async function loadPortfolioContextImpl() {
  const repository = getRepository();
  const [settings, assetFolders, assets, records, fxRateSnapshots, securityPriceHistory] = await Promise.all([
    repository.getSettings(),
    repository.listAssetFolders(),
    repository.listAssets(),
    repository.listAssetRecords(),
    repository.listFxRateSnapshots(),
    repository.listSecurityPriceHistory(),
  ]);

  const groupedRecords = new Map<string, AssetRecord[]>();
  for (const record of records) {
    const current = groupedRecords.get(record.assetId) ?? [];
    current.push(record);
    groupedRecords.set(record.assetId, current);
  }
  const groupedSecurityPrices = groupSecurityPricesBySymbol(securityPriceHistory);
  await schedulePortfolioSync(assets, groupedRecords, groupedSecurityPrices, fxRateSnapshots);
  const alphaVantageEnabled = await hasAlphaVantageApiKey();

  return {
    settings,
    assetFolders,
    assets,
    groupedRecords,
    groupedRates: latestFxByPair(fxRateSnapshots),
    groupedSecurityPrices,
    latestFxRates: fxRateSnapshots,
    alphaVantageEnabled,
  };
});

function buildAssetSummary(
  asset: Asset,
  assetFolders: { id: string; name: string }[],
  records: AssetRecord[],
  groupedRates: Map<string, FxRateSnapshot[]>,
  groupedSecurityPrices: Map<string, SecurityPriceHistoryRow[]>,
  alphaVantageEnabled: boolean,
  baseCurrency: CurrencyCode,
  targetDate: string,
): AssetSummary {
  const evaluated = evaluateAssetAtDate(
    asset,
    records,
    groupedRates,
    groupedSecurityPrices,
    baseCurrency,
    targetDate,
  );
  const priceCoverage = getSecurityCoverageForSymbol(groupedSecurityPrices, evaluated.symbol);
  const autoPriceEnabled = asset.type === "SECURITIES" && Boolean(evaluated.symbol);
  const earliestSecurityRecordDate =
    asset.type === "SECURITIES"
      ? sortRecordsAsc(records).find((record) => record.recordType !== "VALUE_SNAPSHOT")?.recordDate.slice(0, 10)
      : undefined;
  const coverageIsPartial =
    Boolean(earliestSecurityRecordDate) &&
    Boolean(priceCoverage?.coverageStart) &&
    String(priceCoverage?.coverageStart) > String(earliestSecurityRecordDate);
  const priceSyncState =
    asset.type !== "SECURITIES"
      ? undefined
      : autoPriceEnabled
        ? (coverageIsPartial ? "partial" : priceCoverage ? priceCoverage.state : alphaVantageEnabled ? "not_synced" : "missing_api_key")
        : "manual";

  return {
    id: asset.id,
    type: asset.type,
    name: asset.name,
    currency: asset.currency,
    folderId: asset.folderId ?? null,
    folderName: asset.folderId ? assetFolders.find((folder) => folder.id === asset.folderId)?.name ?? null : null,
    notes: asset.notes ?? null,
    latestRecordDate: evaluated.latestRecordDate,
    recordCount: records.length,
    nativeValue: evaluated.nativeValue,
    convertedValue: evaluated.convertedValue,
    convertedCurrency: baseCurrency,
    quantity: evaluated.quantity,
    unitPrice: evaluated.unitPrice,
    averageCost: evaluated.averageCost,
    profitLoss: evaluated.profitLoss,
    profitLossPct: evaluated.profitLossPct,
    symbol: evaluated.symbol ?? null,
    autoPriceEnabled,
    priceSyncState,
    priceCoverageStart: priceCoverage?.coverageStart,
    priceCoverageEnd: priceCoverage?.coverageEnd,
    priceSource: priceCoverage?.source ?? null,
  };
}

function listPastDates(period: PeriodOption) {
  const end = new Date();
  const start = subDays(end, getPeriodDays(period) - 1);
  const dates: string[] = [];

  for (let cursor = start; cursor <= end; cursor = subDays(cursor, -1)) {
    dates.push(formatDayKey(cursor));
  }

  return dates;
}

function buildDashboardDates(period: PeriodOption, earliestRecordDate?: string) {
  if (period !== "all") {
    return listPastDates(period);
  }

  return listDatesInRange(
    earliestRecordDate ?? formatDayKey(getHistoryRangeStart("1y")),
    formatDayKey(getHistoryRangeEnd()),
  );
}

function evaluatePortfolioTotalAtDate(
  assets: Asset[],
  groupedRecords: Map<string, AssetRecord[]>,
  groupedRates: Map<string, FxRateSnapshot[]>,
  groupedSecurityPrices: Map<string, SecurityPriceHistoryRow[]>,
  baseCurrency: CurrencyCode,
  targetDate: string,
) {
  return roundCurrency(
    assets.reduce((sum, asset) => {
      const state = evaluateAssetAtDate(
        asset,
        groupedRecords.get(asset.id) ?? [],
        groupedRates,
        groupedSecurityPrices,
        baseCurrency,
        targetDate,
      );
      return sum + state.convertedValue;
    }, 0),
  );
}

/**
 * Build and persist a full portfolio daily-values cache for the active archive.
 * Covers every date from the earliest record up to today.
 * Called manually (settings page rebuild) or automatically on a cache miss.
 */
export async function buildPortfolioCache(baseCurrency: CurrencyCode): Promise<void> {
  const [archiveId, { assets, groupedRecords, groupedRates, groupedSecurityPrices }] =
    await Promise.all([readActiveArchiveId(), loadPortfolioContext()]);

  const earliestRecordDate = Array.from(groupedRecords.values())
    .flat()
    .map((r) => r.recordDate)
    .sort()[0];

  if (!earliestRecordDate) return; // no data to cache

  const today = formatDayKey(new Date());
  const allDates = listDatesInRange(toDayKey(earliestRecordDate), today);

  const dates: PortfolioDailyCache["dates"] = {};
  for (const date of allDates) {
    const row: Record<string, number> = {};
    let total = 0;
    for (const asset of assets) {
      const state = evaluateAssetAtDate(
        asset,
        groupedRecords.get(asset.id) ?? [],
        groupedRates,
        groupedSecurityPrices,
        baseCurrency,
        date,
      );
      row[asset.id] = state.convertedValue;
      total += state.convertedValue;
    }
    row["_total"] = roundCurrency(total);
    dates[date] = row;
  }

  await writePortfolioCache(archiveId, {
    archiveId,
    currency: baseCurrency,
    computedAt: today,
    dates,
  });
}

/**
 * Return a valid cache (reading from disk and building if needed).
 * Wrapped with React.cache() so repeated calls within the same render pass
 * read the file only once.
 */
const getOrBuildCache = cache(async function getOrBuildCacheImpl(
  archiveId: string,
  baseCurrency: CurrencyCode,
  buildIfMissing = true,
): Promise<PortfolioDailyCache | null> {
  const cached = await readPortfolioCache(archiveId, baseCurrency);
  if (cached) return cached;
  if (!buildIfMissing) return null;
  await buildPortfolioCache(baseCurrency);
  return readPortfolioCache(archiveId, baseCurrency);
});

function listDatesInRange(startDate: string, endDate: string) {
  const start = parseDayKey(startDate);
  const end = parseDayKey(endDate);
  const dates: string[] = [];

  for (let cursor = start; cursor <= end; cursor = subDays(cursor, -1)) {
    dates.push(formatDayKey(cursor));
  }

  return dates;
}

function buildHistoryDates(options?: {
  preset?: HistoryRangePreset;
  startDate?: string;
  endDate?: string;
}, earliestRecordDate?: string) {
  const hasCustomRange =
    Boolean(options?.startDate) &&
    Boolean(options?.endDate) &&
    String(options?.startDate) <= String(options?.endDate);

  if (hasCustomRange) {
    return listDatesInRange(options?.startDate ?? "", options?.endDate ?? "");
  }

  const preset = options?.preset ?? "1y";
  if (preset === "all") {
    return listDatesInRange(
      earliestRecordDate ?? formatDayKey(getHistoryRangeStart("1y")),
      formatDayKey(getHistoryRangeEnd()),
    );
  }

  return listDatesInRange(
    formatDayKey(getHistoryRangeStart(preset)),
    formatDayKey(getHistoryRangeEnd()),
  );
}

function rankAssetsByPeakHistoryValue(
  assets: Asset[],
  groupedRecords: Map<string, AssetRecord[]>,
  groupedRates: Map<string, FxRateSnapshot[]>,
  groupedSecurityPrices: Map<string, SecurityPriceHistoryRow[]>,
  baseCurrency: CurrencyCode,
  dates: string[],
  cache?: PortfolioDailyCache | null,
) {
  return assets
    .map((asset) => {
      let peak = 0;

      for (const date of dates) {
        const cachedVal = cache?.dates[date]?.[asset.id];
        const val =
          cachedVal !== undefined
            ? cachedVal
            : evaluateAssetAtDate(
                asset,
                groupedRecords.get(asset.id) ?? [],
                groupedRates,
                groupedSecurityPrices,
                baseCurrency,
                date,
              ).convertedValue;
        peak = Math.max(peak, Math.abs(val));
      }

      return { name: asset.name, peak };
    })
    .filter((item) => item.peak >= 0.005)
    .sort((left, right) => right.peak - left.peak);
}

export async function getAssetSummaries(baseCurrency: CurrencyCode) {
  const { assetFolders, assets, groupedRecords, groupedRates, groupedSecurityPrices, alphaVantageEnabled } = await loadPortfolioContext();
  const targetDate = formatDayKey(new Date());

  return assets
    .map((asset) =>
      buildAssetSummary(
        asset,
        assetFolders,
        groupedRecords.get(asset.id) ?? [],
        groupedRates,
        groupedSecurityPrices,
        alphaVantageEnabled,
        baseCurrency,
        targetDate,
      ),
    )
    .sort((left, right) => right.convertedValue - left.convertedValue);
}

export async function getAssetDetailData(assetId: string, baseCurrency: CurrencyCode): Promise<AssetDetailData | null> {
  return getAssetDetailDataForRange(assetId, baseCurrency, "all");
}

export async function getAssetDetailDataForRange(
  assetId: string,
  baseCurrency: CurrencyCode,
  rangePreset: HistoryRangePreset,
  startDate?: string,
  endDate?: string,
): Promise<AssetDetailData | null> {
  const { assetFolders, assets, groupedRecords, groupedRates, groupedSecurityPrices, alphaVantageEnabled } = await loadPortfolioContext();
  const asset = assets.find((item) => item.id === assetId);
  if (!asset) {
    return null;
  }

  const records = groupedRecords.get(asset.id) ?? [];
  const assetSummary = buildAssetSummary(
    asset,
    assetFolders,
    records,
    groupedRates,
    groupedSecurityPrices,
    alphaVantageEnabled,
    baseCurrency,
    formatDayKey(new Date()),
  );

  return {
    asset: assetSummary,
    baseCurrency,
    records: buildRecordViewRows(asset, records, groupedRates, baseCurrency),
    timeline: buildAssetTimeline(
      asset,
      records,
      groupedRates,
      groupedSecurityPrices,
      baseCurrency,
      {
        preset: rangePreset,
        startDate,
        endDate,
      },
    ),
    priceCoverage: assetSummary.symbol
      ? {
          symbol: assetSummary.symbol,
          state: assetSummary.priceSyncState ?? "not_synced",
          coverageStart: assetSummary.priceCoverageStart,
          coverageEnd: assetSummary.priceCoverageEnd,
          syncedThrough: assetSummary.priceCoverageEnd,
          source: assetSummary.priceSource ?? undefined,
        }
      : null,
  };
}

export async function getAssetsPageData(
  selectedAssetId?: string,
  rangePreset: HistoryRangePreset = "all",
  startDate?: string,
  endDate?: string,
) {
  const { settings, assetFolders, assets, groupedRecords, groupedRates, groupedSecurityPrices, alphaVantageEnabled } =
    await loadPortfolioContext();
  const today = formatDayKey(new Date());
  const assetSummaries = assets
    .map((asset) =>
      buildAssetSummary(
        asset,
        assetFolders,
        groupedRecords.get(asset.id) ?? [],
        groupedRates,
        groupedSecurityPrices,
        alphaVantageEnabled,
        settings.displayCurrency,
        today,
      ),
    );

  const orderedAssetIds = [
    {
      key: "__root__",
      assets: assets
        .filter((asset) => !asset.folderId)
        .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-CN")),
      sortOrder: settings.rootFolderSortOrder,
      title: "默认",
    },
    ...assetFolders
      .map((folder) => ({
        key: folder.id,
        assets: assets
          .filter((asset) => asset.folderId === folder.id)
          .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-CN")),
        sortOrder: folder.sortOrder,
        title: folder.name,
      })),
  ]
    .sort((left, right) => left.sortOrder - right.sortOrder || left.title.localeCompare(right.title, "zh-CN"))
    .flatMap((section) => section.assets.map((asset) => asset.id));

  const resolvedSelectedAssetId =
    selectedAssetId && assetSummaries.some((asset) => asset.id === selectedAssetId)
      ? selectedAssetId
      : orderedAssetIds[0] ?? assetSummaries[0]?.id;

  const selectedAsset = assets.find((asset) => asset.id === resolvedSelectedAssetId);
  const selectedSummary = assetSummaries.find((asset) => asset.id === resolvedSelectedAssetId);
  const selectedRecords = selectedAsset ? groupedRecords.get(selectedAsset.id) ?? [] : [];
  const detail =
    selectedAsset && resolvedSelectedAssetId
      ? {
          asset:
            selectedSummary ??
            buildAssetSummary(
              selectedAsset,
              assetFolders,
              selectedRecords,
              groupedRates,
              groupedSecurityPrices,
              alphaVantageEnabled,
              settings.displayCurrency,
              today,
            ),
          baseCurrency: settings.displayCurrency,
          records: buildRecordViewRows(selectedAsset, selectedRecords, groupedRates, settings.displayCurrency),
          timeline: buildAssetTimeline(
            selectedAsset,
            selectedRecords,
            groupedRates,
            groupedSecurityPrices,
            settings.displayCurrency,
            {
              preset: rangePreset,
              startDate,
              endDate,
            },
          ),
          priceCoverage:
            selectedSummary?.symbol
              ? {
                  symbol: selectedSummary.symbol ?? "",
                  state: selectedSummary.priceSyncState ?? "not_synced",
                  coverageStart: selectedSummary.priceCoverageStart,
                  coverageEnd: selectedSummary.priceCoverageEnd,
                  syncedThrough: selectedSummary.priceCoverageEnd,
                  source: selectedSummary.priceSource ?? undefined,
                }
              : null,
        }
      : null;

  return {
    settings,
    folders: assetFolders,
    assets: assetSummaries,
    selectedAssetId: resolvedSelectedAssetId,
    detail,
  };
}

export async function getDashboardData(
  baseCurrency: CurrencyCode,
  period: PeriodOption,
): Promise<DashboardData> {
  const [archiveId, { settings, assetFolders, assets, groupedRecords, groupedRates, groupedSecurityPrices, latestFxRates, alphaVantageEnabled }] =
    await Promise.all([readActiveArchiveId(), loadPortfolioContext()]);
  const today = formatDayKey(new Date());
  const earliestRecordDate = Array.from(groupedRecords.values())
    .flat()
    .map((record) => record.recordDate)
    .sort((left, right) => left.localeCompare(right))[0];
  const assetSummaries = assets
    .map((asset) =>
      buildAssetSummary(
        asset,
        assetFolders,
        groupedRecords.get(asset.id) ?? [],
        groupedRates,
        groupedSecurityPrices,
        alphaVantageEnabled,
        baseCurrency,
        today,
      ),
    )
    .sort((left, right) => right.convertedValue - left.convertedValue);

  // Use cache for the trend loop (most expensive part: O(T × A × n log n))
  const cache = await getOrBuildCache(archiveId, baseCurrency);

  const trend = buildDashboardDates(period, earliestRecordDate).map((date) => {
    const cachedTotal = cache?.dates[date]?.["_total"];
    if (cachedTotal !== undefined) return { date, total: cachedTotal };
    return {
      date,
      total: evaluatePortfolioTotalAtDate(
        assets,
        groupedRecords,
        groupedRates,
        groupedSecurityPrices,
        baseCurrency,
        date,
      ),
    };
  });

  const totalValue = trend.at(-1)?.total ?? 0;
  const weekAnchor = formatDayKey(subDays(new Date(), 7));
  const monthAnchor = formatDayKey(subDays(new Date(), 30));
  const yearAnchor = formatDayKey(subDays(new Date(), 365));
  const ytdAnchor = formatDayKey(new Date(new Date().getFullYear() - 1, 11, 31));

  function cachedTotalAt(date: string): number {
    const cv = cache?.dates[date]?.["_total"];
    if (cv !== undefined) return cv;
    return evaluatePortfolioTotalAtDate(
      assets, groupedRecords, groupedRates, groupedSecurityPrices, baseCurrency, date,
    );
  }

  // Reuse already-computed assetSummaries instead of re-evaluating
  const topSecurities: DashboardSecurity[] = assetSummaries
    .filter((s) => s.type === "SECURITIES")
    .map((s) => ({
      id: s.id,
      name: s.name,
      symbol: s.symbol,
      currency: s.currency,
      quantity: s.quantity ?? 0,
      averageCost: s.averageCost ?? 0,
      unitPrice: s.unitPrice ?? 0,
      nativeValue: s.nativeValue,
      convertedValue: s.convertedValue,
      profitLoss: s.profitLoss ?? 0,
      profitLossPct: s.profitLossPct ?? 0,
    }))
    .sort((left, right) => right.convertedValue - left.convertedValue)
    .slice(0, 5);

  return {
    summary: {
      totalValue,
      baseCurrency,
      dayChange: roundCurrency(totalValue - cachedTotalAt(formatDayKey(subDays(new Date(), 1)))),
      weekChange: roundCurrency(totalValue - cachedTotalAt(weekAnchor)),
      monthChange: roundCurrency(totalValue - cachedTotalAt(monthAnchor)),
      yearChange: roundCurrency(totalValue - cachedTotalAt(yearAnchor)),
      ytdChange: roundCurrency(totalValue - cachedTotalAt(ytdAnchor)),
      assetCount: assetSummaries.length,
    },
    assets: assetSummaries,
    allocation: (["CASH", "SECURITIES", "OTHER"] as AssetType[]).map((type) => ({
      label: ASSET_TYPE_LABELS[type],
      value: roundCurrency(
        assetSummaries
          .filter((asset) => asset.type === type)
          .reduce((sum, asset) => sum + asset.convertedValue, 0),
      ),
    })),
    trend,
    topSecurities,
    settings,
    latestFxRates,
  };
}

export async function getHistoryData(
  baseCurrency: CurrencyCode,
  groupBy: HistoryGroupBy,
  options?: HistoryDataOptions,
) {
  const [archiveId, { assetFolders, assets, groupedRecords, groupedRates, groupedSecurityPrices }] =
    await Promise.all([readActiveArchiveId(), loadPortfolioContext()]);
  const earliestRecordDate = Array.from(groupedRecords.values())
    .flat()
    .map((record) => record.recordDate)
    .sort((left, right) => left.localeCompare(right))[0];
  const dates = buildHistoryDates(options, earliestRecordDate);

  // Use cache for the total series (eliminates O(dates × A × n log n) loop)
  if (groupBy === "total") {
    const cache = await getOrBuildCache(archiveId, baseCurrency);
    return dates.map((date) => {
      const cachedTotal = cache?.dates[date]?.["_total"];
      if (cachedTotal !== undefined) return { date, total: cachedTotal };
      return {
        date,
        total: roundCurrency(
          assets.reduce((sum, asset) => {
            const state = evaluateAssetAtDate(
              asset,
              groupedRecords.get(asset.id) ?? [],
              groupedRates,
              groupedSecurityPrices,
              baseCurrency,
              date,
            );
            return sum + state.convertedValue;
          }, 0),
        ),
      };
    });
  }

  const orderedAssets = [...assets];
  const orderedTypeKeys = ["CASH", "SECURITIES", "OTHER"].map((type) => ASSET_TYPE_LABELS[type as AssetType]);
  const orderedFolderKeys = [
    ...assetFolders.map((folder) => folder.name),
    ...(orderedAssets.some((asset) => !asset.folderId) ? ["未分类"] : []),
  ];

  // For non-total groupBy, use per-asset cached values
  const cache = await getOrBuildCache(archiveId, baseCurrency);

  function getCachedAssetValue(assetId: string, date: string): number | undefined {
    return cache?.dates[date]?.[assetId];
  }

  let topAssetNames = new Set<string>();
  let orderedAssetNames: string[] = [];
  if (groupBy === "asset") {
    const topAssetCount = Math.max(1, Math.min(50, Math.trunc(options?.topAssetCount ?? 8)));
    const rankedAssets = rankAssetsByPeakHistoryValue(
      orderedAssets,
      groupedRecords,
      groupedRates,
      groupedSecurityPrices,
      baseCurrency,
      dates,
      cache,
    );

    topAssetNames = new Set(
      rankedAssets
        .slice(0, topAssetCount)
        .map((item) => item.name),
    );
    orderedAssetNames = rankedAssets.slice(0, topAssetCount).map((item) => item.name);
  }

  const rows: HistorySeriesRow[] = [];
  for (const date of dates) {
    const row: HistorySeriesRow = { date };

    if (groupBy === "type") {
      for (const key of orderedTypeKeys) {
        row[key] = 0;
      }
    } else if (groupBy === "folder") {
      for (const key of orderedFolderKeys) {
        row[key] = 0;
      }
    } else {
      for (const assetName of orderedAssetNames) {
        row[assetName] = 0;
      }
      if (orderedAssets.some((asset) => !topAssetNames.has(asset.name))) {
        row["其他"] = 0;
      }
    }

    for (const asset of orderedAssets) {
      const cachedVal = getCachedAssetValue(asset.id, date);
      const convertedValue =
        cachedVal !== undefined
          ? cachedVal
          : evaluateAssetAtDate(
              asset,
              groupedRecords.get(asset.id) ?? [],
              groupedRates,
              groupedSecurityPrices,
              baseCurrency,
              date,
            ).convertedValue;
      const key =
        groupBy === "type"
          ? ASSET_TYPE_LABELS[asset.type]
          : groupBy === "folder"
            ? asset.folderId
              ? assetFolders.find((folder) => folder.id === asset.folderId)?.name ?? "未分类"
              : "未分类"
          : topAssetNames.has(asset.name)
            ? asset.name
            : "其他";
      row[key] = roundCurrency((row[key] as number | undefined ?? 0) + convertedValue);
    }

    rows.push(row);
  }

  return rows;
}

export async function getDataSyncOverview(baseCurrency: CurrencyCode): Promise<DataSyncOverview> {
  const repository = getRepository();
  const { assetFolders, assets, groupedRecords, groupedRates, groupedSecurityPrices, alphaVantageEnabled } = await loadPortfolioContext();
  const today = formatDayKey(new Date());
  const assetSummaries = assets.map((asset) =>
    buildAssetSummary(
      asset,
      assetFolders,
      groupedRecords.get(asset.id) ?? [],
      groupedRates,
      groupedSecurityPrices,
      alphaVantageEnabled,
      baseCurrency,
      today,
    ),
  );
  const securitySummaries = assetSummaries.filter((asset) => asset.type === "SECURITIES");
  const syncedSecuritySummaries = securitySummaries.filter((asset) => asset.priceSyncState === "synced");
  const latestCoverageEnd = syncedSecuritySummaries
    .map((asset) => asset.priceCoverageEnd)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0];
  const source = syncedSecuritySummaries.find((asset) => asset.priceSource)?.priceSource ?? undefined;

  return {
    securities: {
      trackedCount: securitySummaries.length,
      autoEnabledCount: securitySummaries.filter((asset) => asset.autoPriceEnabled).length,
      syncedCount: syncedSecuritySummaries.length,
      latestCoverageEnd,
      source,
    },
    fx: await repository.getFxCoverage(),
  };
}

export type CalendarDayContributor = {
  assetId: string;
  name: string;
  symbol: string | null;
  change: number;
};

/** Returns per-asset change for each date in the given range (anchor day before start is used to compute diff). */
export async function getCalendarBreakdown(
  baseCurrency: CurrencyCode,
  dates: string[],
  anchorDate: string,
): Promise<Map<string, CalendarDayContributor[]>> {
  if (dates.length === 0) return new Map();

  const [archiveId, { assets, groupedRecords, groupedRates, groupedSecurityPrices }] =
    await Promise.all([readActiveArchiveId(), loadPortfolioContext()]);
  const cache = await getOrBuildCache(archiveId, baseCurrency);

  const allDates = [anchorDate, ...dates];
  const valueByAssetByDate = new Map<string, Map<string, number>>();
  // Collected during the value loop to avoid a second evaluateAssetAtDate pass
  const symbolByAsset = new Map<string, string | null>();

  for (const asset of assets) {
    const records = groupedRecords.get(asset.id) ?? [];
    const byDate = new Map<string, number>();
    let capturedSymbol: string | null | undefined = undefined;

    for (const date of allDates) {
      const cachedVal = cache?.dates[date]?.[asset.id];
      if (cachedVal !== undefined) {
        byDate.set(date, cachedVal);
      } else {
        const state = evaluateAssetAtDate(asset, records, groupedRates, groupedSecurityPrices, baseCurrency, date);
        byDate.set(date, state.convertedValue);
        // Capture symbol from the first non-cached evaluation (symbol is stable per asset)
        if (capturedSymbol === undefined) capturedSymbol = state.symbol ?? null;
      }
    }

    // When all values came from cache, derive symbol directly from the latest trade record
    if (capturedSymbol === undefined && asset.type === "SECURITIES") {
      capturedSymbol = sortRecordsAsc(records)
        .filter((r) => r.recordType !== "VALUE_SNAPSHOT" && r.symbol)
        .at(-1)?.symbol ?? null;
    }

    valueByAssetByDate.set(asset.id, byDate);
    symbolByAsset.set(asset.id, capturedSymbol ?? null);
  }

  const result = new Map<string, CalendarDayContributor[]>();

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const prevDate = i === 0 ? anchorDate : dates[i - 1];
    const contributors: CalendarDayContributor[] = [];

    for (const asset of assets) {
      const byDate = valueByAssetByDate.get(asset.id)!;
      const curr = byDate.get(date) ?? 0;
      const prev = byDate.get(prevDate) ?? 0;
      const change = roundCurrency(curr - prev);
      if (Math.abs(change) >= 0.005) {
        contributors.push({
          assetId: asset.id,
          name: asset.name,
          symbol: symbolByAsset.get(asset.id) ?? null,
          change,
        });
      }
    }

    contributors.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    if (contributors.length > 0) {
      result.set(date, contributors.slice(0, 5));
    }
  }

  return result;
}
