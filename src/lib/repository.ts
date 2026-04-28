import {
  createArchive as createArchiveInStore,
  deleteArchive as deleteArchiveInStore,
  readArchiveOverview,
  readAssetFolders,
  readAssetRecords,
  readAssets,
  readSettings,
  switchToArchive,
  writeAssetFolders,
  writeAssetRecords,
  writeAssets,
  writeSettings,
} from "@/lib/store";
import {
  getFxCoverage as getFxCoverageFromStore,
  readFxRateSnapshotsFromCsv,
  syncFxDailyHistory as syncFxDailyHistoryFromStore,
} from "@/lib/fx-rates";
import { enqueueSyncTask } from "@/lib/sync-queue";
import {
  getSecurityPriceCoverage as getSecurityPriceCoverageFromStore,
  normalizeSecuritySymbol,
  readSecurityPriceRows,
  syncSecurityPriceHistory as syncSecurityPriceHistoryFromStore,
} from "@/lib/security-prices";
import type {
  Asset,
  AssetFolder,
  AssetRecord,
  ArchiveOverview,
  CreateAssetInput,
  CreateAssetRecordInput,
  FxCoverage,
  FxRateSnapshot,
  SecurityHoldingPeriod,
  SecurityPriceCoverage,
  SecurityPriceHistoryRow,
  SettingsInput,
  UpdateAssetInput,
  UpdateAssetRecordInput,
  UserSettings,
} from "@/lib/types";
import { createId } from "@/lib/utils";

export interface Repository {
  getSettings(): Promise<UserSettings>;
  updateSettings(input: SettingsInput): Promise<UserSettings>;
  listAssetFolders(): Promise<AssetFolder[]>;
  createAssetFolder(name: string): Promise<AssetFolder>;
  deleteAssetFolder(id: string): Promise<void>;
  reorderAssetFolder(folderId: string, beforeFolderId?: string | null): Promise<void>;
  listAssets(): Promise<Asset[]>;
  getAsset(id: string): Promise<Asset | null>;
  moveAssetToFolderAndReorder(assetId: string, folderId?: string | null, beforeAssetId?: string | null): Promise<void>;
  listAssetRecords(assetId?: string): Promise<AssetRecord[]>;
  listFxRateSnapshots(): Promise<FxRateSnapshot[]>;
  listSecurityPriceHistory(symbol?: string): Promise<SecurityPriceHistoryRow[]>;
  getSecurityPriceCoverage(symbol: string): Promise<SecurityPriceCoverage | null>;
  syncSecurityPriceHistory(target: { assetId?: string; symbol?: string; startDate?: string; holdingPeriods?: SecurityHoldingPeriod[] }): Promise<SecurityPriceCoverage | null>;
  getFxCoverage(): Promise<FxCoverage>;
  syncFxDailyHistory(): Promise<FxCoverage>;
  createAsset(input: CreateAssetInput): Promise<Asset>;
  updateAsset(input: UpdateAssetInput): Promise<Asset>;
  deleteAsset(id: string): Promise<void>;
  createAssetRecord(assetId: string, input: CreateAssetRecordInput): Promise<AssetRecord>;
  updateAssetRecord(assetId: string, input: UpdateAssetRecordInput): Promise<AssetRecord>;
  deleteAssetRecord(assetId: string, recordId: string): Promise<void>;
  getArchiveOverview(): Promise<ArchiveOverview>;
  createArchive(name?: string, mode?: "empty" | "duplicate"): Promise<void>;
  switchArchive(archiveId: string): Promise<void>;
  deleteArchive(archiveId: string): Promise<void>;
}

function compareRecordOrder(left: AssetRecord, right: AssetRecord) {
  const dateOrder = left.recordDate.localeCompare(right.recordDate);
  if (dateOrder !== 0) return dateOrder;
  const createdOrder = left.createdAt.localeCompare(right.createdAt);
  if (createdOrder !== 0) return createdOrder;
  return left.id.localeCompare(right.id);
}

function sortRecordsAsc(records: AssetRecord[]) {
  return [...records].sort(compareRecordOrder);
}

function sortRecordsDesc(records: AssetRecord[]) {
  return [...records].sort((left, right) => compareRecordOrder(right, left));
}

const SECURITY_QUANTITY_EPSILON = 0.0001;

function normalizeSecurityQuantity(quantity: number) {
  return Math.abs(quantity) < SECURITY_QUANTITY_EPSILON ? 0 : quantity;
}

type LocalDataBundle = {
  settings: UserSettings;
  assetFolders: AssetFolder[];
  assets: Asset[];
  assetRecords: AssetRecord[];
};

type WriteTargets = {
  settings?: boolean;
  assetFolders?: boolean;
  assets?: boolean;
  assetRecords?: boolean;
};

const ROOT_FOLDER_ID = "__root__";

async function readLocalDataBundle(): Promise<LocalDataBundle> {
  const [settings, assetFolders, assets, assetRecords] = await Promise.all([
    readSettings(),
    readAssetFolders(),
    readAssets(),
    readAssetRecords(),
  ]);

  return {
    settings,
    assetFolders,
    assets,
    assetRecords,
  };
}

async function withLocalData<T>(
  fn: (data: LocalDataBundle) => T | Promise<T>,
  writeTargets?: WriteTargets,
) {
  const data = await readLocalDataBundle();
  const result = await fn(data);

  if (writeTargets?.settings) {
    await writeSettings(data.settings);
  }
  if (writeTargets?.assetFolders) {
    await writeAssetFolders(data.assetFolders);
  }
  if (writeTargets?.assets) {
    await writeAssets(data.assets);
  }
  if (writeTargets?.assetRecords) {
    await writeAssetRecords(data.assetRecords);
  }

  return result;
}

function resolveSecuritySyncTarget(
  data: LocalDataBundle,
  target: { assetId?: string; symbol?: string; startDate?: string; holdingPeriods?: SecurityHoldingPeriod[] },
) {
  if (target.assetId) {
    const asset = data.assets.find((item) => item.id === target.assetId && !item.archivedAt);
    if (!asset || asset.type !== "SECURITIES") {
      return null;
    }

    const records = sortRecordsAsc(data.assetRecords.filter((item) => item.assetId === target.assetId));
    const firstRecordDate = records[0]?.recordDate;
    const latestSymbol = sortRecordsDesc(records).find(
      (record): record is Extract<AssetRecord, { recordType: "STOCK_TRADE" | "STOCK_SNAPSHOT" }> =>
        record.recordType !== "VALUE_SNAPSHOT" && Boolean(normalizeSecuritySymbol(record.symbol)),
    )?.symbol;

    return {
      symbol: normalizeSecuritySymbol(latestSymbol),
      startDate: target.startDate ?? firstRecordDate,
      holdingPeriods: buildSecurityHoldingPeriods(records),
    };
  }

  return {
    symbol: normalizeSecuritySymbol(target.symbol),
    startDate: target.startDate,
    holdingPeriods: target.holdingPeriods,
  };
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
        periods.push({
          startDate: openStartDate,
          endDate: record.recordDate.slice(0, 10),
        });
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
      periods.push({
        startDate: openStartDate,
        endDate: record.recordDate.slice(0, 10),
      });
      openStartDate = null;
    }

    quantity = nextQuantity;
  }

  if (quantity > 0 && openStartDate) {
    periods.push({ startDate: openStartDate });
  }

  return periods;
}

function validateRecordMatchesAssetType(asset: Asset, record: CreateAssetRecordInput | AssetRecord) {
  if (asset.type === "SECURITIES") {
    if (record.recordType === "VALUE_SNAPSHOT") {
      throw new Error("股票资产不能使用金额快照记录");
    }
    return;
  }

  if (record.recordType !== "VALUE_SNAPSHOT") {
    throw new Error("现金和其他资产只能使用金额快照记录");
  }
}

function ensureFolderExists(data: LocalDataBundle, folderId?: string | null) {
  if (!folderId) {
    return null;
  }

  const folder = data.assetFolders.find((item) => item.id === folderId);
  if (!folder) {
    throw new Error("Folder not found");
  }

  return folder.id;
}

function sortFoldersForDisplay(folders: AssetFolder[]) {
  return [...folders].sort((left, right) => left.sortOrder - right.sortOrder);
}

function sortAssetsForDisplay(assets: Asset[]) {
  return [...assets].sort((left, right) => {
    const folderOrder = (left.folderId ?? "").localeCompare(right.folderId ?? "");
    if (folderOrder !== 0) return folderOrder;
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
    return left.createdAt.localeCompare(right.createdAt);
  });
}

function resequenceFolderOrders(folders: AssetFolder[]) {
  sortFoldersForDisplay(folders).forEach((folder, index) => {
    folder.sortOrder = index + 1;
  });
}

function resequenceAssetOrders(assets: Asset[], folderId?: string | null) {
  assets
    .filter((asset) => (asset.folderId ?? null) === (folderId ?? null))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt))
    .forEach((asset, index) => {
      asset.sortOrder = index + 1;
    });
}

function validateSecurityTimeline(records: AssetRecord[]) {
  let quantity = 0;

  for (const record of sortRecordsAsc(records)) {
    if (record.recordType === "VALUE_SNAPSHOT") {
      continue;
    }

    if (record.recordType === "STOCK_SNAPSHOT") {
      quantity = record.quantity;
      if (quantity < 0) {
        throw new Error("股票持仓快照不能为负数");
      }
      continue;
    }

    quantity += record.side === "BUY" ? record.quantity : -record.quantity;
    if (quantity < 0) {
      throw new Error("卖出后持股数不能为负数");
    }
  }
}

function buildRecord(assetId: string, input: CreateAssetRecordInput, now: string): AssetRecord {
  const base = {
    id: createId("record"),
    assetId,
    recordType: input.recordType,
    recordDate: new Date(input.recordDate).toISOString(),
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
  };

  if (input.recordType === "VALUE_SNAPSHOT") {
    return {
      ...base,
      recordType: "VALUE_SNAPSHOT",
      amount: input.amount,
    };
  }

  if (input.recordType === "STOCK_SNAPSHOT") {
    return {
      ...base,
      recordType: "STOCK_SNAPSHOT",
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      symbol: normalizeSecuritySymbol(input.symbol) ?? null,
    };
  }

  return {
    ...base,
    recordType: "STOCK_TRADE",
    side: input.side,
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    symbol: normalizeSecuritySymbol(input.symbol) ?? null,
  };
}

const jsonRepository: Repository = {
  async getSettings() {
    return readSettings();
  },
  async updateSettings(input) {
    return withLocalData((data) => {
      data.settings = {
        ...data.settings,
        ...input,
      };
      return data.settings;
    }, { settings: true });
  },
  async listAssetFolders() {
    return withLocalData((data) => sortFoldersForDisplay(data.assetFolders));
  },
  async createAssetFolder(name) {
    return withLocalData((data) => {
      const trimmedName = name.trim();
      if (!trimmedName) {
        throw new Error("Folder name is required");
      }
      if (data.assetFolders.some((folder) => folder.name.localeCompare(trimmedName, "zh-CN", { sensitivity: "accent" }) === 0)) {
        throw new Error("Folder name already exists");
      }

      const folder: AssetFolder = {
        id: createId("folder"),
        name: trimmedName,
        sortOrder: data.assetFolders.length + 1,
      };
      data.assetFolders.push(folder);
      return folder;
    }, { assetFolders: true });
  },
  async deleteAssetFolder(id) {
    return withLocalData((data) => {
      const folder = data.assetFolders.find((item) => item.id === id);
      if (!folder) {
        throw new Error("Folder not found");
      }

      const now = new Date().toISOString();
      data.assetFolders = data.assetFolders.filter((item) => item.id !== id);
      for (const asset of data.assets) {
        if (asset.folderId === id) {
          asset.folderId = null;
          asset.sortOrder = data.assets.filter((item) => !item.folderId).length + 1;
          asset.updatedAt = now;
        }
      }
      resequenceFolderOrders(data.assetFolders);
      resequenceAssetOrders(data.assets, id);
      resequenceAssetOrders(data.assets, null);
    }, { assetFolders: true, assets: true });
  },
  async reorderAssetFolder(folderId, beforeFolderId) {
    return withLocalData((data) => {
      const orderedItems = [
        {
          id: ROOT_FOLDER_ID,
          sortOrder: data.settings.rootFolderSortOrder,
        },
        ...data.assetFolders.map((folder) => ({
          id: folder.id,
          sortOrder: folder.sortOrder,
        })),
      ].sort((left, right) => left.sortOrder - right.sortOrder);

      const movingIndex = orderedItems.findIndex((item) => item.id === folderId);
      if (movingIndex === -1) {
        throw new Error("Folder not found");
      }

      const [movingItem] = orderedItems.splice(movingIndex, 1);
      const beforeIndex = beforeFolderId ? orderedItems.findIndex((item) => item.id === beforeFolderId) : -1;
      if (beforeFolderId && beforeIndex === -1) {
        throw new Error("Target folder not found");
      }

      orderedItems.splice(beforeIndex >= 0 ? beforeIndex : orderedItems.length, 0, movingItem);

      orderedItems.forEach((item, index) => {
        if (item.id === ROOT_FOLDER_ID) {
          data.settings.rootFolderSortOrder = index + 1;
          return;
        }

        const folder = data.assetFolders.find((candidate) => candidate.id === item.id);
        if (folder) {
          folder.sortOrder = index + 1;
        }
      });

      resequenceFolderOrders(data.assetFolders);
    }, { assetFolders: true, settings: true });
  },
  async listAssets() {
    return withLocalData((data) =>
      sortAssetsForDisplay(data.assets.filter((asset) => !asset.archivedAt)),
    );
  },
  async getAsset(id) {
    return withLocalData((data) => data.assets.find((asset) => asset.id === id && !asset.archivedAt) ?? null);
  },
  async listAssetRecords(assetId) {
    return withLocalData((data) => {
      const records = assetId
        ? data.assetRecords.filter((record) => record.assetId === assetId)
        : data.assetRecords;
      return sortRecordsDesc(records);
    });
  },
  async listFxRateSnapshots() {
    return readFxRateSnapshotsFromCsv();
  },
  async listSecurityPriceHistory(symbol) {
    const rows = await readSecurityPriceRows();
    const normalizedSymbol = normalizeSecuritySymbol(symbol);
    return normalizedSymbol ? rows.filter((row) => row.symbol === normalizedSymbol) : rows;
  },
  async getSecurityPriceCoverage(symbol) {
    return getSecurityPriceCoverageFromStore(symbol);
  },
  async syncSecurityPriceHistory(target) {
    return withLocalData((data) => {
      const resolved = resolveSecuritySyncTarget(data, target);
      if (!resolved?.symbol || !resolved.startDate) {
        return null;
      }

      return syncSecurityPriceHistoryFromStore({
        symbol: resolved.symbol,
        startDate: resolved.startDate,
        holdingPeriods: resolved.holdingPeriods,
      });
    });
  },
  async getFxCoverage() {
    return getFxCoverageFromStore();
  },
  async syncFxDailyHistory() {
    return withLocalData((data) => {
      const earliestRecordDate = sortRecordsAsc(data.assetRecords)[0]?.recordDate;
      if (!earliestRecordDate) {
        return getFxCoverageFromStore();
      }

      return syncFxDailyHistoryFromStore(earliestRecordDate);
    });
  },
  async createAsset(input) {
    const asset = await withLocalData((data) => {
      const now = new Date().toISOString();
      const asset: Asset = {
        id: createId("asset"),
        type: input.type,
        name: input.name,
        currency: input.currency,
        folderId: ensureFolderExists(data, input.folderId),
        sortOrder:
          data.assets.filter((item) => (item.folderId ?? null) === (input.folderId ?? null) && !item.archivedAt).length + 1,
        notes: input.notes ?? null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      validateRecordMatchesAssetType(asset, input.initialRecord);
      const record = buildRecord(asset.id, input.initialRecord, now);

      data.assets.unshift(asset);
      data.assetRecords.unshift(record);

      if (asset.type === "SECURITIES") {
        validateSecurityTimeline(data.assetRecords.filter((item) => item.assetId === asset.id));
      }

      return asset;
    }, { assets: true, assetRecords: true });

    if (asset.type === "SECURITIES") {
      const symbol = normalizeSecuritySymbol(
        input.initialRecord.recordType === "VALUE_SNAPSHOT" ? null : input.initialRecord.symbol,
      );
      if (symbol) {
        await enqueueSyncTask({
          key: `security:${symbol}`,
          kind: "security_price",
          label: `${symbol} 日价格`,
          run: async () => {
            await syncSecurityPriceHistoryFromStore({
              symbol,
              startDate: new Date(input.initialRecord.recordDate).toISOString(),
              holdingPeriods: [{ startDate: new Date(input.initialRecord.recordDate).toISOString().slice(0, 10) }],
            });
          },
        });
      }
    }

    return asset;
  },
  async updateAsset(input) {
    return withLocalData((data) => {
      const asset = data.assets.find((item) => item.id === input.id && !item.archivedAt);
      if (!asset) {
        throw new Error("Asset not found");
      }

      asset.name = input.name;
      asset.currency = input.currency;
      const nextFolderId = ensureFolderExists(data, input.folderId);
      if ((asset.folderId ?? null) !== (nextFolderId ?? null)) {
        const previousFolderId = asset.folderId ?? null;
        asset.folderId = nextFolderId;
        asset.sortOrder =
          data.assets.filter((item) => item.id !== asset.id && (item.folderId ?? null) === (nextFolderId ?? null) && !item.archivedAt).length + 1;
        resequenceAssetOrders(data.assets, previousFolderId);
        resequenceAssetOrders(data.assets, nextFolderId ?? null);
      }
      asset.notes = input.notes ?? null;
      asset.updatedAt = new Date().toISOString();
      return asset;
    }, { assets: true });
  },
  async deleteAsset(id) {
    return withLocalData((data) => {
      const asset = data.assets.find((item) => item.id === id && !item.archivedAt);
      if (!asset) {
        throw new Error("Asset not found");
      }

      const folderId = asset.folderId ?? null;
      data.assets = data.assets.filter((item) => item.id !== id);
      data.assetRecords = data.assetRecords.filter((record) => record.assetId !== id);
      resequenceAssetOrders(data.assets, folderId);
    }, { assets: true, assetRecords: true });
  },
  async moveAssetToFolderAndReorder(assetId, folderId, beforeAssetId) {
    return withLocalData((data) => {
      const asset = data.assets.find((item) => item.id === assetId && !item.archivedAt);
      if (!asset) {
        throw new Error("Asset not found");
      }

      const targetFolderId = ensureFolderExists(data, folderId);
      const previousFolderId = asset.folderId ?? null;
      const targetAssets = data.assets
        .filter((item) => item.id !== assetId && !item.archivedAt && (item.folderId ?? null) === (targetFolderId ?? null))
        .sort((left, right) => left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt));

      if (beforeAssetId) {
        const existsInTarget = targetAssets.some((item) => item.id === beforeAssetId);
        if (!existsInTarget) {
          throw new Error("Target asset not found");
        }
      }

      asset.folderId = targetFolderId;
      asset.updatedAt = new Date().toISOString();

      const insertIndex = beforeAssetId ? targetAssets.findIndex((item) => item.id === beforeAssetId) : targetAssets.length;
      const reordered = [...targetAssets];
      reordered.splice(insertIndex >= 0 ? insertIndex : reordered.length, 0, asset);
      reordered.forEach((item, index) => {
        item.sortOrder = index + 1;
      });

      resequenceAssetOrders(data.assets, previousFolderId);
      resequenceAssetOrders(data.assets, targetFolderId ?? null);
    }, { assets: true });
  },
  async createAssetRecord(assetId, input) {
    const record = await withLocalData((data) => {
      const asset = data.assets.find((item) => item.id === assetId && !item.archivedAt);
      if (!asset) {
        throw new Error("Asset not found");
      }

      validateRecordMatchesAssetType(asset, input);
      const now = new Date().toISOString();
      const record = buildRecord(assetId, input, now);
      const nextRecords = [...data.assetRecords, record];

      if (asset.type === "SECURITIES") {
        validateSecurityTimeline(nextRecords.filter((item) => item.assetId === assetId));
      }

      asset.updatedAt = now;
      data.assetRecords.unshift(record);
      return record;
    }, { assets: true, assetRecords: true });

    if (record.recordType !== "VALUE_SNAPSHOT") {
      const symbol = normalizeSecuritySymbol(record.symbol);
      if (symbol) {
        const records = await this.listAssetRecords(assetId);
        const holdingPeriods = buildSecurityHoldingPeriods(sortRecordsAsc(records));
        await enqueueSyncTask({
          key: `security:${symbol}`,
          kind: "security_price",
          label: `${symbol} 日价格`,
          run: async () => {
            await syncSecurityPriceHistoryFromStore({
              symbol,
              startDate: record.recordDate,
              holdingPeriods,
            });
          },
        });
      }
    }
    return record;
  },
  async updateAssetRecord(assetId, input) {
    const updatedRecord = await withLocalData((data) => {
      const asset = data.assets.find((item) => item.id === assetId && !item.archivedAt);
      if (!asset) {
        throw new Error("Asset not found");
      }

      const index = data.assetRecords.findIndex((item) => item.id === input.id && item.assetId === assetId);
      if (index === -1) {
        throw new Error("Record not found");
      }

      validateRecordMatchesAssetType(asset, input);
      const existing = data.assetRecords[index];
      const updatedAt = new Date().toISOString();
      const updatedRecord = {
        ...buildRecord(assetId, input, existing.createdAt),
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt,
      } satisfies AssetRecord;

      const nextRecords = [...data.assetRecords];
      nextRecords[index] = updatedRecord;

      if (asset.type === "SECURITIES") {
        validateSecurityTimeline(nextRecords.filter((item) => item.assetId === assetId));
      }

      asset.updatedAt = updatedAt;
      data.assetRecords[index] = updatedRecord;
      return updatedRecord;
    }, { assets: true, assetRecords: true });

    if (updatedRecord.recordType !== "VALUE_SNAPSHOT") {
      const symbol = normalizeSecuritySymbol(updatedRecord.symbol);
      if (symbol) {
        const records = await this.listAssetRecords(assetId);
        const holdingPeriods = buildSecurityHoldingPeriods(sortRecordsAsc(records));
        await enqueueSyncTask({
          key: `security:${symbol}`,
          kind: "security_price",
          label: `${symbol} 日价格`,
          run: async () => {
            await syncSecurityPriceHistoryFromStore({
              symbol,
              startDate: updatedRecord.recordDate,
              holdingPeriods,
            });
          },
        });
      }
    }
    return updatedRecord;
  },
  async deleteAssetRecord(assetId, recordId) {
    return withLocalData((data) => {
      const asset = data.assets.find((item) => item.id === assetId && !item.archivedAt);
      if (!asset) {
        throw new Error("Asset not found");
      }

      const existing = data.assetRecords.find((item) => item.id === recordId && item.assetId === assetId);
      if (!existing) {
        throw new Error("Record not found");
      }

      const nextRecords = data.assetRecords.filter((item) => item.id !== recordId);
      if (asset.type === "SECURITIES") {
        validateSecurityTimeline(nextRecords.filter((item) => item.assetId === assetId));
      }

      asset.updatedAt = new Date().toISOString();
      data.assetRecords = nextRecords;
    }, { assets: true, assetRecords: true });
  },
  async getArchiveOverview() {
    return readArchiveOverview();
  },
  async createArchive(name, mode) {
    await createArchiveInStore(name, mode);
  },
  async switchArchive(archiveId) {
    await switchToArchive(archiveId);
  },
  async deleteArchive(archiveId) {
    await deleteArchiveInStore(archiveId);
  },
};

export function getRepository() {
  return jsonRepository;
}
