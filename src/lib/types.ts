export type CurrencyCode = "USD" | "CNY";
export type AssetType = "CASH" | "SECURITIES" | "OTHER";
export type HistoryGroupBy = "total" | "type" | "folder" | "asset";
export type HistoryChartMode = "stacked" | "line";
export type HistoryRangePreset = "1m" | "3m" | "ytd" | "1y" | "3y" | "all";
export type PeriodOption = "1y" | "ytd" | "3y" | "all";
export type ThemePreference = "light" | "dark";
export type ColorScheme = "green-up" | "red-up";
export type AssetRecordType = "VALUE_SNAPSHOT" | "STOCK_TRADE" | "STOCK_SNAPSHOT";
export type StockTradeSide = "BUY" | "SELL";
export type SecurityPriceSyncState = "manual" | "missing_api_key" | "not_synced" | "partial" | "synced";
export type SyncTaskKind = "security_price" | "fx_rate";
export type SyncTaskState = "queued" | "running" | "retrying" | "succeeded" | "failed";

export interface UserSettings {
  displayCurrency: CurrencyCode;
  themePreference: ThemePreference;
  historyTopAssetCount: number;
  rootFolderSortOrder: number;
  timeZone: string;
  colorScheme: ColorScheme;
}

export interface UserArchive {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssetFolder {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Asset {
  id: string;
  type: AssetType;
  name: string;
  currency: CurrencyCode;
  folderId?: string | null;
  sortOrder: number;
  notes?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssetRecordBase {
  id: string;
  assetId: string;
  recordType: AssetRecordType;
  recordDate: string;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ValueSnapshotRecord extends AssetRecordBase {
  recordType: "VALUE_SNAPSHOT";
  amount: number;
}

export interface StockTradeRecord extends AssetRecordBase {
  recordType: "STOCK_TRADE";
  side: StockTradeSide;
  quantity: number;
  unitPrice: number;
  symbol?: string | null;
}

export interface StockSnapshotRecord extends AssetRecordBase {
  recordType: "STOCK_SNAPSHOT";
  quantity: number;
  unitPrice: number;
  symbol?: string | null;
}

export type AssetRecord = ValueSnapshotRecord | StockTradeRecord | StockSnapshotRecord;

export interface SecurityPriceHistoryRow {
  symbol: string;
  date: string;
  close: number;
  currency: CurrencyCode;
  source: string;
  fetchedAt: string;
}

export interface SecurityPriceCoverage {
  symbol: string;
  state: SecurityPriceSyncState;
  coverageStart?: string;
  coverageEnd?: string;
  syncedThrough?: string;
  source?: string;
}

export interface SecurityHoldingPeriod {
  startDate: string;
  endDate?: string;
}

export interface FxDailyRateRow {
  date: string;
  usdToCny: number;
  cnyToUsd: number;
  source: string;
  fetchedAt: string;
}

export interface FxRateSnapshot {
  id: string;
  baseCurrency: CurrencyCode;
  quoteCurrency: CurrencyCode;
  rate: number;
  asOf: string;
  source: string;
}

export interface FxCoverage {
  state: "not_synced" | "synced";
  coverageStart?: string;
  coverageEnd?: string;
  syncedThrough?: string;
  source?: string;
}

export interface CreateValueSnapshotInput {
  recordType: "VALUE_SNAPSHOT";
  recordDate: string;
  amount: number;
  notes?: string;
}

export interface CreateStockTradeInput {
  recordType: "STOCK_TRADE";
  recordDate: string;
  side: StockTradeSide;
  quantity: number;
  unitPrice: number;
  symbol?: string;
  notes?: string;
}

export interface CreateStockSnapshotInput {
  recordType: "STOCK_SNAPSHOT";
  recordDate: string;
  quantity: number;
  unitPrice: number;
  symbol?: string;
  notes?: string;
}

export type CreateAssetRecordInput =
  | CreateValueSnapshotInput
  | CreateStockTradeInput
  | CreateStockSnapshotInput;

export type UpdateAssetRecordInput = CreateAssetRecordInput & { id: string };

export interface CreateAssetInput {
  type: AssetType;
  name: string;
  currency: CurrencyCode;
  folderId?: string | null;
  notes?: string;
  initialRecord: CreateAssetRecordInput;
}

export interface UpdateAssetInput {
  id: string;
  name: string;
  currency: CurrencyCode;
  folderId?: string | null;
  notes?: string;
}

export interface AssetSummary {
  id: string;
  type: AssetType;
  name: string;
  currency: CurrencyCode;
  folderId?: string | null;
  folderName?: string | null;
  notes?: string | null;
  latestRecordDate?: string;
  recordCount: number;
  nativeValue: number;
  convertedValue: number;
  convertedCurrency: CurrencyCode;
  quantity?: number;
  unitPrice?: number;
  averageCost?: number;
  profitLoss?: number;
  profitLossPct?: number;
  symbol?: string | null;
  autoPriceEnabled?: boolean;
  priceSyncState?: SecurityPriceSyncState;
  priceCoverageStart?: string;
  priceCoverageEnd?: string;
  priceSource?: string | null;
}

export interface AssetRecordViewRow {
  id: string;
  assetId: string;
  recordType: AssetRecordType;
  recordDate: string;
  notes?: string | null;
  amount?: number;
  side?: StockTradeSide;
  quantity?: number;
  unitPrice?: number;
  symbol?: string | null;
  resultingQuantity?: number;
  resultingUnitPrice?: number;
  resultingNativeValue: number;
  resultingConvertedValue: number;
}

export type AssetTimelineEventKind = "VALUE_SNAPSHOT" | "BUY" | "SELL" | "STOCK_SNAPSHOT";

export interface AssetTimelineEvent {
  id: string;
  date: string;
  kind: AssetTimelineEventKind;
  amount?: number;
  quantity?: number;
  unitPrice?: number;
  symbol?: string | null;
  notes?: string | null;
}

export interface AssetTimelinePoint {
  date: string;
  totalValueNative: number;
  totalValueConverted: number;
  securityPrice?: number | null;
  quantity?: number | null;
  events: AssetTimelineEvent[];
}

export interface AssetTimelineData {
  rangeStart?: string;
  rangeEnd?: string;
  hasSecurityPriceSeries: boolean;
  points: AssetTimelinePoint[];
}

export interface AssetDetailData {
  asset: AssetSummary;
  baseCurrency: CurrencyCode;
  records: AssetRecordViewRow[];
  priceCoverage?: SecurityPriceCoverage | null;
  timeline: AssetTimelineData;
}

export interface AssetsPageData {
  settings: UserSettings;
  folders: AssetFolder[];
  assets: AssetSummary[];
  selectedAssetId?: string;
  detail: AssetDetailData | null;
}

export interface DashboardSecurity {
  id: string;
  name: string;
  symbol?: string | null;
  currency: CurrencyCode;
  quantity: number;
  averageCost: number;
  unitPrice: number;
  nativeValue: number;
  convertedValue: number;
  profitLoss: number;
  profitLossPct: number;
}

export interface DashboardSummary {
  totalValue: number;
  baseCurrency: CurrencyCode;
  dayChange: number;
  weekChange: number;
  monthChange: number;
  yearChange: number;
  ytdChange: number;
  assetCount: number;
}

export interface DashboardData {
  summary: DashboardSummary;
  assets: AssetSummary[];
  allocation: Array<{
    label: string;
    value: number;
  }>;
  trend: Array<{
    date: string;
    total: number;
  }>;
  topSecurities: DashboardSecurity[];
  settings: UserSettings;
  latestFxRates: FxRateSnapshot[];
}

export interface SettingsInput {
  displayCurrency: CurrencyCode;
  themePreference: ThemePreference;
  historyTopAssetCount: number;
  timeZone: string;
  colorScheme: ColorScheme;
}

export interface ArchiveOverview {
  archives: UserArchive[];
  activeArchiveId: string;
}

export interface DataSyncOverview {
  securities: {
    trackedCount: number;
    autoEnabledCount: number;
    syncedCount: number;
    latestCoverageEnd?: string;
    source?: string;
  };
  fx: FxCoverage;
}

export interface SyncTaskStatus {
  key: string;
  kind: SyncTaskKind;
  label: string;
  state: SyncTaskState;
  attempts: number;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt: string;
  nextRetryAt?: string;
  errorMessage?: string;
}

export interface SyncStatusSnapshot {
  updatedAt: string;
  queueLength: number;
  runningCount: number;
  lastError?: string;
  tasks: SyncTaskStatus[];
}

export interface HistorySeriesRow {
  date: string;
  [key: string]: string | number;
}

export interface HistoryDataOptions {
  preset?: HistoryRangePreset;
  startDate?: string;
  endDate?: string;
  topAssetCount?: number;
}
