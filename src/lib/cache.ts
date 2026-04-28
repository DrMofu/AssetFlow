import { mkdir, readFile, rm, stat, writeFile } from "fs/promises";
import path from "path";

import type { CurrencyCode } from "@/lib/types";
import { getStorePaths, readActiveArchiveId } from "@/lib/store";

export type PortfolioDailyCache = {
  archiveId: string;
  currency: CurrencyCode;
  /** "yyyy-MM-dd" — the date on which this cache was computed */
  computedAt: string;
  /**
   * Outer key: "yyyy-MM-dd" date.
   * Inner key: "_total" for the portfolio total, or an assetId for that asset's converted value.
   */
  dates: Record<string, Record<string, number>>;
};

function getCacheFilePath(archiveId: string): string {
  const { cacheDir } = getStorePaths();
  return path.join(cacheDir, `${archiveId}.json`);
}

function todayDateKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Read and validate the cache for the given archive.
 * Returns null if the file is missing, malformed, stale, or for a different currency.
 */
export async function readPortfolioCache(
  archiveId: string,
  currency: CurrencyCode,
): Promise<PortfolioDailyCache | null> {
  try {
    const filePath = getCacheFilePath(archiveId);
    const raw = await readFile(filePath, "utf8");
    const cache = JSON.parse(raw) as PortfolioDailyCache;
    if (cache.currency !== currency) return null;
    if (cache.computedAt !== todayDateKey()) return null;
    return cache;
  } catch {
    return null;
  }
}

/**
 * Write the portfolio cache to disk.
 * Creates the cache directory if it doesn't exist.
 */
export async function writePortfolioCache(
  archiveId: string,
  cache: PortfolioDailyCache,
): Promise<void> {
  const { cacheDir } = getStorePaths();
  await mkdir(cacheDir, { recursive: true });
  await writeFile(getCacheFilePath(archiveId), JSON.stringify(cache), "utf8");
}

/**
 * Delete the cache file for the given archive (defaults to the active archive).
 * Silently succeeds if the file doesn't exist.
 */
export async function invalidatePortfolioCache(archiveId?: string): Promise<void> {
  try {
    const id = archiveId ?? (await readActiveArchiveId());
    await rm(getCacheFilePath(id), { force: true });
  } catch {
    // ignore
  }
}

/**
 * Return size and build time for the active archive's cache.
 * Used by the settings UI.
 */
export async function getPortfolioCacheStats(): Promise<{
  sizeBytes: number;
  computedAt: string | null;
}> {
  try {
    const archiveId = await readActiveArchiveId();
    const filePath = getCacheFilePath(archiveId);
    const [fileStats, raw] = await Promise.all([stat(filePath), readFile(filePath, "utf8")]);
    const cache = JSON.parse(raw) as { computedAt?: string };
    return { sizeBytes: fileStats.size, computedAt: cache.computedAt ?? null };
  } catch {
    return { sizeBytes: 0, computedAt: null };
  }
}
