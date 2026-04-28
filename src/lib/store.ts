import { cache } from "react";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseCsv, serializeCsv } from "@/lib/csv";
import type {
  Asset,
  AssetFolder,
  ArchiveOverview,
  AssetRecord,
  CurrencyCode,
  FxDailyRateRow,
  SecurityPriceHistoryRow,
  SyncStatusSnapshot,
  StockTradeSide,
  ThemePreference,
  UserArchive,
  UserSettings,
} from "@/lib/types";

const dataDir = path.join(process.cwd(), "data");
const userDataDir = path.join(dataDir, "user");
const systemDataDir = path.join(dataDir, "system");
const cacheDir = path.join(dataDir, "cache");
const archivesDir = path.join(userDataDir, "archives");
const archiveIndexPath = path.join(userDataDir, "archives.json");
const settingsPath = path.join(systemDataDir, "settings.json");
const syncStatusPath = path.join(systemDataDir, "sync-status.json");
const securityPriceHistoryDir = path.join(systemDataDir, "price_history");
const fxRatesCsvPath = path.join(systemDataDir, "usd-cny-daily.csv");

const assetColumns = [
  "id",
  "type",
  "name",
  "currency",
  "folderId",
  "sortOrder",
  "notes",
  "archivedAt",
  "createdAt",
  "updatedAt",
] as const;

const assetRecordColumns = [
  "id",
  "assetId",
  "recordType",
  "recordDate",
  "notes",
  "createdAt",
  "updatedAt",
  "amount",
  "side",
  "quantity",
  "unitPrice",
  "symbol",
] as const;

const securityPriceHistoryColumns = [
  "symbol",
  "date",
  "close",
  "currency",
  "source",
  "fetched_at",
] as const;

const fxRateColumns = [
  "date",
  "usd_to_cny",
  "cny_to_usd",
  "source",
  "fetched_at",
] as const;

type RawAssetRow = Record<(typeof assetColumns)[number], string>;
type RawAssetRecordRow = Record<(typeof assetRecordColumns)[number], string>;
type RawSecurityPriceHistoryRow = Record<(typeof securityPriceHistoryColumns)[number], string>;
type RawFxRateRow = Record<(typeof fxRateColumns)[number], string>;

const trackedUserDataFilenames = ["assets.csv", "asset-records.csv", "asset-folders.json"] as const;

type ArchiveIndex = {
  activeArchiveId: string;
  archives: UserArchive[];
};

function archiveNameFallback(index: number) {
  return index === 1 ? "默认存档" : `存档 ${index}`;
}

function createArchiveId() {
  return `archive_${randomUUID().slice(0, 8)}`;
}

function getArchiveDir(archiveId: string) {
  return path.join(archivesDir, archiveId);
}

function getArchiveFilePath(archiveId: string, filename: (typeof trackedUserDataFilenames)[number]) {
  return path.join(getArchiveDir(archiveId), filename);
}

function normalizeArchiveIndex(raw: Partial<ArchiveIndex> | null | undefined): ArchiveIndex {
  const archives = Array.isArray(raw?.archives)
    ? raw.archives
        .filter((archive): archive is UserArchive => Boolean(archive?.id && archive?.name))
        .map((archive) => ({
          id: archive.id,
          name: archive.name,
          createdAt: archive.createdAt ?? new Date(0).toISOString(),
          updatedAt: archive.updatedAt ?? archive.createdAt ?? new Date(0).toISOString(),
        }))
    : [];

  return {
    activeArchiveId: raw?.activeArchiveId && archives.some((archive) => archive.id === raw.activeArchiveId)
      ? raw.activeArchiveId
      : archives[0]?.id ?? "",
    archives,
  };
}

async function readJsonFile<T>(targetPath: string) {
  const raw = await readFile(targetPath, "utf8");
  return JSON.parse(raw) as T;
}

async function writeJsonFile(targetPath: string, value: unknown) {
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, targetPath);
}

async function ensurePrimaryFile(primaryPath: string) {
  const hasPrimary = await stat(primaryPath).then(() => true).catch(() => false);

  if (!hasPrimary) {
    throw new Error(`缺少数据文件 ${path.basename(primaryPath)}。`);
  }
}

async function readCsvObjects<T extends string>(targetPath: string, columns: readonly T[]) {
  const raw = await readFile(targetPath, "utf8");
  const rows = parseCsv(raw);
  const [headerRow = [], ...dataRows] = rows;
  const headerIndex = new Map(headerRow.map((column, index) => [column, index]));

  return dataRows.map((row) =>
    Object.fromEntries(
      columns.map((column) => [column, row[headerIndex.get(column) ?? -1] ?? ""]),
    ) as Record<T, string>,
  );
}

async function writeCsvObjects<T extends string>(
  targetPath: string,
  columns: readonly T[],
  rows: Array<Record<T, string | number | null | undefined>>,
) {
  const csv = serializeCsv([
    [...columns],
    ...rows.map((row) => columns.map((column) => row[column] ?? "")),
  ]);
  await writeFile(targetPath, csv, "utf8");
}

function normalizeSecurityPriceHistorySymbol(value: string) {
  return value.trim().toUpperCase();
}

function toSecurityPriceHistoryFilename(symbol: string) {
  return `${normalizeSecurityPriceHistorySymbol(symbol).replace(/[^A-Z0-9._-]+/g, "_")}.csv`;
}

function getSecurityPriceHistoryFilePath(symbol: string) {
  return path.join(securityPriceHistoryDir, toSecurityPriceHistoryFilename(symbol));
}

async function writeSecurityPriceHistoryFiles(rows: SecurityPriceHistoryRow[]) {
  const groupedRows = new Map<string, SecurityPriceHistoryRow[]>();
  for (const row of rows) {
    const symbol = normalizeSecurityPriceHistorySymbol(row.symbol);
    if (!symbol) {
      continue;
    }

    const list = groupedRows.get(symbol) ?? [];
    list.push({
      ...row,
      symbol,
    });
    groupedRows.set(symbol, list);
  }

  const expectedFilenames = new Set<string>();
  for (const [symbol, symbolRows] of groupedRows) {
    const filename = toSecurityPriceHistoryFilename(symbol);
    expectedFilenames.add(filename);
    await writeCsvObjects(
      getSecurityPriceHistoryFilePath(symbol),
      securityPriceHistoryColumns,
      symbolRows.map((row) => serializeSecurityPriceHistoryRow(row)),
    );
  }

  const existingEntries = await readdir(securityPriceHistoryDir, { withFileTypes: true });
  await Promise.all(
    existingEntries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".csv") && !expectedFilenames.has(entry.name))
      .map((entry) => unlink(path.join(securityPriceHistoryDir, entry.name))),
  );
}

function normalizeSettings(raw: Partial<UserSettings>) {
  const colorScheme = raw.colorScheme === "red-up" ? "red-up" : "green-up";
  return {
    displayCurrency: (raw.displayCurrency ?? "USD") as CurrencyCode,
    themePreference: (raw.themePreference ?? "light") as ThemePreference,
    historyTopAssetCount: Math.max(1, Math.min(50, Number(raw.historyTopAssetCount ?? 8))),
    rootFolderSortOrder: Math.max(0, Number(raw.rootFolderSortOrder ?? 0)),
    timeZone: typeof raw.timeZone === "string" ? raw.timeZone : "",
    colorScheme,
  } satisfies UserSettings;
}

function normalizeSyncStatus(raw: Partial<SyncStatusSnapshot> | null | undefined): SyncStatusSnapshot {
  return {
    updatedAt: raw?.updatedAt ?? new Date(0).toISOString(),
    queueLength: Number(raw?.queueLength ?? 0),
    runningCount: Number(raw?.runningCount ?? 0),
    lastError: raw?.lastError ?? undefined,
    tasks: Array.isArray(raw?.tasks) ? raw.tasks : [],
  };
}

async function ensureArchiveDir(archiveId: string) {
  await mkdir(getArchiveDir(archiveId), { recursive: true });
}

async function writeEmptyArchiveFile(
  archiveId: string,
  filename: (typeof trackedUserDataFilenames)[number],
) {
  const target = getArchiveFilePath(archiveId, filename);
  if (filename === "asset-folders.json") {
    await writeJsonFile(target, []);
    return;
  }
  if (filename === "assets.csv") {
    await writeCsvObjects(target, assetColumns, []);
    return;
  }
  await writeCsvObjects(target, assetRecordColumns, []);
}

async function ensureArchiveFilesExist(archiveId: string) {
  await ensureArchiveDir(archiveId);
  await Promise.all(
    trackedUserDataFilenames.map(async (filename) => {
      const exists = await stat(getArchiveFilePath(archiveId, filename))
        .then(() => true)
        .catch(() => false);
      if (!exists) {
        await writeEmptyArchiveFile(archiveId, filename);
      }
    }),
  );
}

async function copyArchiveFiles(sourceArchiveId: string, targetArchiveId: string) {
  await ensureArchiveDir(targetArchiveId);
  await Promise.all(
    trackedUserDataFilenames.map((filename) =>
      copyFile(
        getArchiveFilePath(sourceArchiveId, filename),
        getArchiveFilePath(targetArchiveId, filename),
      ),
    ),
  );
}

function normalizeAsset(row: RawAssetRow): Asset {
  return {
    id: row.id,
    type: row.type as Asset["type"],
    name: row.name,
    currency: row.currency as CurrencyCode,
    folderId: row.folderId || null,
    sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : 0,
    notes: row.notes || null,
    archivedAt: row.archivedAt || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeAssetRecord(row: RawAssetRecordRow): AssetRecord {
  const base = {
    id: row.id,
    assetId: row.assetId,
    recordType: row.recordType as AssetRecord["recordType"],
    recordDate: row.recordDate,
    notes: row.notes || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };

  if (row.recordType === "VALUE_SNAPSHOT") {
    return {
      ...base,
      recordType: "VALUE_SNAPSHOT",
      amount: Number(row.amount || 0),
    };
  }

  if (row.recordType === "STOCK_SNAPSHOT") {
    return {
      ...base,
      recordType: "STOCK_SNAPSHOT",
      quantity: Number(row.quantity || 0),
      unitPrice: Number(row.unitPrice || 0),
      symbol: row.symbol || null,
    };
  }

  return {
    ...base,
    recordType: "STOCK_TRADE",
    side: (row.side || "BUY") as StockTradeSide,
    quantity: Number(row.quantity || 0),
    unitPrice: Number(row.unitPrice || 0),
    symbol: row.symbol || null,
  };
}

function serializeAsset(asset: Asset): Record<(typeof assetColumns)[number], string | number | null> {
  return {
    id: asset.id,
    type: asset.type,
    name: asset.name,
    currency: asset.currency,
    folderId: asset.folderId ?? null,
    sortOrder: asset.sortOrder,
    notes: asset.notes ?? null,
    archivedAt: asset.archivedAt ?? null,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

function serializeAssetRecord(
  record: AssetRecord,
): Record<(typeof assetRecordColumns)[number], string | number | null> {
  if (record.recordType === "VALUE_SNAPSHOT") {
    return {
      id: record.id,
      assetId: record.assetId,
      recordType: record.recordType,
      recordDate: record.recordDate,
      notes: record.notes ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      amount: record.amount,
      side: null,
      quantity: null,
      unitPrice: null,
      symbol: null,
    };
  }

  if (record.recordType === "STOCK_SNAPSHOT") {
    return {
      id: record.id,
      assetId: record.assetId,
      recordType: record.recordType,
      recordDate: record.recordDate,
      notes: record.notes ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      amount: null,
      side: null,
      quantity: record.quantity,
      unitPrice: record.unitPrice,
      symbol: record.symbol ?? null,
    };
  }

  return {
    id: record.id,
    assetId: record.assetId,
    recordType: record.recordType,
    recordDate: record.recordDate,
    notes: record.notes ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    amount: null,
    side: record.side,
    quantity: record.quantity,
    unitPrice: record.unitPrice,
    symbol: record.symbol ?? null,
  };
}

function normalizeSecurityPriceHistoryRow(row: RawSecurityPriceHistoryRow): SecurityPriceHistoryRow {
  return {
    symbol: row.symbol.trim().toUpperCase(),
    date: row.date,
    close: Number(row.close || 0),
    currency: (row.currency || "USD") as CurrencyCode,
    source: row.source || "Alpha Vantage TIME_SERIES_DAILY",
    fetchedAt: row.fetched_at || new Date(`${row.date}T00:00:00.000Z`).toISOString(),
  };
}

function serializeSecurityPriceHistoryRow(
  row: SecurityPriceHistoryRow,
): Record<(typeof securityPriceHistoryColumns)[number], string | number | null> {
  return {
    symbol: row.symbol.trim().toUpperCase(),
    date: row.date,
    close: row.close,
    currency: row.currency,
    source: row.source,
    fetched_at: row.fetchedAt,
  };
}

function normalizeFxDailyRateRow(row: RawFxRateRow): FxDailyRateRow {
  return {
    date: row.date,
    usdToCny: Number(row.usd_to_cny || 0),
    cnyToUsd: Number(row.cny_to_usd || 0),
    source: row.source || "FRED DEXCHUS",
    fetchedAt: row.fetched_at || new Date(`${row.date}T00:00:00.000Z`).toISOString(),
  };
}

function serializeFxDailyRateRow(
  row: FxDailyRateRow,
): Record<(typeof fxRateColumns)[number], string | number | null> {
  return {
    date: row.date,
    usd_to_cny: row.usdToCny,
    cny_to_usd: row.cnyToUsd,
    source: row.source,
    fetched_at: row.fetchedAt,
  };
}

let _ensureStoreFilesPromise: Promise<void> | null = null;

export function ensureStoreFiles(): Promise<void> {
  if (!_ensureStoreFilesPromise) {
    _ensureStoreFilesPromise = _doEnsureStoreFiles().catch((err) => {
      _ensureStoreFilesPromise = null;
      throw err;
    });
  }
  return _ensureStoreFilesPromise;
}

async function _doEnsureStoreFiles() {
  await mkdir(dataDir, { recursive: true });
  await mkdir(userDataDir, { recursive: true });
  await mkdir(systemDataDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  await mkdir(securityPriceHistoryDir, { recursive: true });
  await mkdir(archivesDir, { recursive: true });
  await rm(path.join(userDataDir, "backup"), { recursive: true, force: true });

  const hasSyncStatus = await stat(syncStatusPath).then(() => true).catch(() => false);
  if (!hasSyncStatus) {
    const initialSyncStatus = normalizeSyncStatus(null);
    await writeJsonFile(syncStatusPath, initialSyncStatus);
  }

  const hasSettings = await stat(settingsPath).then(() => true).catch(() => false);
  if (!hasSettings) {
    await writeJsonFile(settingsPath, normalizeSettings({}));
  }

  await ensurePrimaryFile(syncStatusPath);

  const hasFxRates = await stat(fxRatesCsvPath).then(() => true).catch(() => false);
  if (!hasFxRates) {
    await writeCsvObjects(fxRatesCsvPath, fxRateColumns, []);
  }

  const hasArchiveIndex = await stat(archiveIndexPath).then(() => true).catch(() => false);
  if (!hasArchiveIndex) {
    const now = new Date().toISOString();
    const defaultArchive: UserArchive = {
      id: createArchiveId(),
      name: "默认存档",
      createdAt: now,
      updatedAt: now,
    };
    await writeJsonFile(archiveIndexPath, {
      activeArchiveId: defaultArchive.id,
      archives: [defaultArchive],
    } satisfies ArchiveIndex);
    await ensureArchiveFilesExist(defaultArchive.id);
    return;
  }

  const archiveIndex = normalizeArchiveIndex(await readJsonFile<Partial<ArchiveIndex>>(archiveIndexPath));
  if (!archiveIndex.archives.length) {
    const now = new Date().toISOString();
    const defaultArchive: UserArchive = {
      id: createArchiveId(),
      name: "默认存档",
      createdAt: now,
      updatedAt: now,
    };
    await writeJsonFile(archiveIndexPath, {
      activeArchiveId: defaultArchive.id,
      archives: [defaultArchive],
    } satisfies ArchiveIndex);
    await ensureArchiveFilesExist(defaultArchive.id);
    return;
  }

  for (const archive of archiveIndex.archives) {
    await ensureArchiveFilesExist(archive.id);
  }
}

async function getActiveArchiveId() {
  await ensureStoreFiles();
  const raw = await readJsonFile<Partial<ArchiveIndex>>(archiveIndexPath);
  return normalizeArchiveIndex(raw).activeArchiveId;
}

// Wrapped with React.cache() so the archive index file is read at most once
// per server-component render pass (deduplicates the 6+ callers on the dashboard page).
export const readActiveArchiveId = cache(getActiveArchiveId);

async function getActiveAssetsCsvPath() {
  return getArchiveFilePath(await getActiveArchiveId(), "assets.csv");
}

async function getActiveAssetRecordsCsvPath() {
  return getArchiveFilePath(await getActiveArchiveId(), "asset-records.csv");
}

async function getActiveAssetFoldersPath() {
  return getArchiveFilePath(await getActiveArchiveId(), "asset-folders.json");
}

export async function readSettings() {
  await ensureStoreFiles();
  const raw = await readJsonFile<Partial<UserSettings>>(settingsPath);
  return normalizeSettings(raw);
}

export async function writeSettings(settings: UserSettings) {
  await writeJsonFile(settingsPath, settings);
}

export async function readArchiveOverview(): Promise<ArchiveOverview> {
  await ensureStoreFiles();
  const raw = await readJsonFile<Partial<ArchiveIndex>>(archiveIndexPath);
  const index = normalizeArchiveIndex(raw);
  return {
    archives: index.archives,
    activeArchiveId: index.activeArchiveId,
  };
}

export async function createArchive(name?: string, mode: "empty" | "duplicate" = "duplicate") {
  await ensureStoreFiles();
  const overview = await readArchiveOverview();
  const now = new Date().toISOString();
  const archive: UserArchive = {
    id: createArchiveId(),
    name: name?.trim() || archiveNameFallback(overview.archives.length + 1),
    createdAt: now,
    updatedAt: now,
  };

  await ensureArchiveDir(archive.id);
  if (mode === "empty") {
    await Promise.all(
      trackedUserDataFilenames.map((filename) => writeEmptyArchiveFile(archive.id, filename)),
    );
  } else {
    await copyArchiveFiles(overview.activeArchiveId, archive.id);
  }
  await writeJsonFile(archiveIndexPath, {
    activeArchiveId: overview.activeArchiveId,
    archives: [...overview.archives, archive],
  } satisfies ArchiveIndex);
  return archive;
}

export async function switchToArchive(archiveId: string) {
  await ensureStoreFiles();
  const overview = await readArchiveOverview();
  const archive = overview.archives.find((item) => item.id === archiveId);
  if (!archive) {
    throw new Error("存档不存在");
  }

  const now = new Date().toISOString();
  await writeJsonFile(archiveIndexPath, {
    activeArchiveId: archiveId,
    archives: overview.archives.map((item) =>
      item.id === archiveId ? { ...item, updatedAt: now } : item,
    ),
  } satisfies ArchiveIndex);
}

export async function deleteArchive(archiveId: string) {
  await ensureStoreFiles();
  const overview = await readArchiveOverview();
  if (overview.archives.length <= 1) {
    throw new Error("至少需要保留一个存档");
  }

  const archive = overview.archives.find((item) => item.id === archiveId);
  if (!archive) {
    throw new Error("存档不存在");
  }

  const remainingArchives = overview.archives.filter((item) => item.id !== archiveId);
  const activeArchiveId =
    archiveId === overview.activeArchiveId ? remainingArchives[0].id : overview.activeArchiveId;

  await rm(getArchiveDir(archiveId), { recursive: true, force: true });
  await writeJsonFile(archiveIndexPath, {
    activeArchiveId,
    archives: remainingArchives,
  } satisfies ArchiveIndex);
}

export async function readSyncStatus() {
  await ensureStoreFiles();
  try {
    const raw = await readJsonFile<Partial<SyncStatusSnapshot>>(syncStatusPath);
    return normalizeSyncStatus(raw);
  } catch {
    const fallback = normalizeSyncStatus(null);
    await writeJsonFile(syncStatusPath, fallback);
    return fallback;
  }
}

export async function writeSyncStatus(syncStatus: SyncStatusSnapshot) {
  await writeJsonFile(syncStatusPath, normalizeSyncStatus(syncStatus));
}

export async function readAssets() {
  const targetPath = await getActiveAssetsCsvPath();
  const rows = await readCsvObjects(targetPath, assetColumns);
  return rows.map((row, index) => {
    const asset = normalizeAsset(row as RawAssetRow);
    return asset.sortOrder > 0 ? asset : { ...asset, sortOrder: index + 1 };
  });
}

export async function readAssetFolders() {
  const targetPath = await getActiveAssetFoldersPath();
  const raw = await readJsonFile<AssetFolder[]>(targetPath);
  return Array.isArray(raw)
    ? raw
        .map((folder, index) => ({
          id: folder.id,
          name: folder.name,
          sortOrder: Number.isFinite(Number(folder.sortOrder)) ? Number(folder.sortOrder) : index + 1,
        }))
        .sort((left, right) => left.sortOrder - right.sortOrder)
    : [];
}

export async function writeAssetFolders(assetFolders: AssetFolder[]) {
  const targetPath = await getActiveAssetFoldersPath();
  await writeJsonFile(targetPath, assetFolders);
}

export async function writeAssets(assets: Asset[]) {
  const targetPath = await getActiveAssetsCsvPath();
  await writeCsvObjects(
    targetPath,
    assetColumns,
    assets.map((asset) => serializeAsset(asset)),
  );
}

export async function readAssetRecords() {
  const targetPath = await getActiveAssetRecordsCsvPath();
  const rows = await readCsvObjects(targetPath, assetRecordColumns);
  return rows.map((row) => normalizeAssetRecord(row as RawAssetRecordRow));
}

export async function writeAssetRecords(assetRecords: AssetRecord[]) {
  const targetPath = await getActiveAssetRecordsCsvPath();
  await writeCsvObjects(
    targetPath,
    assetRecordColumns,
    assetRecords.map((record) => serializeAssetRecord(record)),
  );
}

export async function readSecurityPriceHistory() {
  await ensureStoreFiles();
  const entries = await readdir(securityPriceHistoryDir, { withFileTypes: true });
  const csvFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".csv"))
    .map((entry) => path.join(securityPriceHistoryDir, entry.name))
    .sort();

  const groups = await Promise.all(
    csvFiles.map(async (filePath) => {
      const rows = await readCsvObjects(filePath, securityPriceHistoryColumns);
      return rows.map((row) => normalizeSecurityPriceHistoryRow(row as RawSecurityPriceHistoryRow));
    }),
  );

  return groups.flat();
}

export async function writeSecurityPriceHistory(rows: SecurityPriceHistoryRow[]) {
  await ensureStoreFiles();
  await writeSecurityPriceHistoryFiles(rows);
}

export async function readFxDailyRates() {
  await ensureStoreFiles();
  const rows = await readCsvObjects(fxRatesCsvPath, fxRateColumns);
  return rows.map((row) => normalizeFxDailyRateRow(row as RawFxRateRow));
}

export async function writeFxDailyRates(rows: FxDailyRateRow[]) {
  await writeCsvObjects(
    fxRatesCsvPath,
    fxRateColumns,
    rows.map((row) => serializeFxDailyRateRow(row)),
  );
}

export function getStorePaths() {
  return {
    dataDir,
    userDataDir,
    systemDataDir,
    cacheDir,
    archivesDir,
    archiveIndexPath,
    settingsPath,
    syncStatusPath,
    securityPriceHistoryDir,
    fxRatesCsvPath,
  };
}
