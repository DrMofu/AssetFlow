import { AssetsDatabase } from "@/components/assets-database";
import { getAssetsPageData } from "@/lib/portfolio";
import { HISTORY_RANGE_PRESET_OPTIONS } from "@/lib/constants";
import type { HistoryRangePreset } from "@/lib/types";

export const dynamic = "force-dynamic";

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawRange = readParam(params.range) as HistoryRangePreset | undefined;
  const startDate = readParam(params.start) || "";
  const endDate = readParam(params.end) || "";
  const rangePreset = HISTORY_RANGE_PRESET_OPTIONS.includes(rawRange ?? "all") ? (rawRange ?? "all") : "all";
  const { folders, assets, detail, selectedAssetId, settings } = await getAssetsPageData(
    readParam(params.asset),
    rangePreset,
    startDate || undefined,
    endDate || undefined,
  );

  return (
    <AssetsDatabase
      folders={folders}
      assets={assets}
      detail={detail}
      baseCurrency={settings.displayCurrency}
      rootFolderSortOrder={settings.rootFolderSortOrder}
      selectedAssetId={selectedAssetId}
      rangePreset={rangePreset}
      startDate={startDate}
      endDate={endDate}
    />
  );
}
