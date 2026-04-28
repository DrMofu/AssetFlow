import {
  DataSyncStatusForm,
  MarketDataKeyForm,
  PreferencesForm,
  StorageActionsForm,
} from "@/components/forms";
import { CacheManagementForm } from "@/components/cache-management-form";
import { getPortfolioCacheStats } from "@/lib/cache";
import { getEnvValue } from "@/lib/env";
import { getDataSyncOverview } from "@/lib/portfolio";
import { getRepository } from "@/lib/repository";
import { getSyncStatusSnapshot } from "@/lib/sync-queue";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const repository = getRepository();
  const settings = await repository.getSettings();
  const [syncOverview, syncQueue, cacheStats] = await Promise.all([
    getDataSyncOverview(settings.displayCurrency),
    getSyncStatusSnapshot(),
    getPortfolioCacheStats(),
  ]);
  const alphaVantageApiKey = await getEnvValue("ALPHA_VANTAGE_API_KEY");

  return (
    <div className="grid items-start gap-6 xl:grid-cols-3">
      <div className="grid gap-6">
        <PreferencesForm />
        <MarketDataKeyForm initialApiKey={alphaVantageApiKey} />
      </div>
      <div className="grid gap-6">
        <DataSyncStatusForm overview={syncOverview} initialQueue={syncQueue} />
      </div>
      <div className="grid gap-6">
        <CacheManagementForm initialStats={cacheStats} />
        <StorageActionsForm />
      </div>
    </div>
  );
}
