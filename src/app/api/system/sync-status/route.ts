import { NextResponse } from "next/server";

import { forceRetryFailedDataSync, getDataSyncOverview } from "@/lib/portfolio";
import { getRepository } from "@/lib/repository";
import { clearSecuritySyncCooldown, getSyncStatusSnapshot } from "@/lib/sync-queue";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const repository = getRepository();
    const settings = await repository.getSettings();
    const [overview, queue] = await Promise.all([
      getDataSyncOverview(settings.displayCurrency),
      getSyncStatusSnapshot(),
    ]);

    return NextResponse.json({
      overview,
      queue,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch sync status" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { action?: string };
    if (body.action !== "force_retry_failed") {
      return NextResponse.json({ error: "Unsupported sync action" }, { status: 400 });
    }

    await clearSecuritySyncCooldown();
    await forceRetryFailedDataSync();

    const repository = getRepository();
    const settings = await repository.getSettings();
    const [overview, queue] = await Promise.all([
      getDataSyncOverview(settings.displayCurrency),
      getSyncStatusSnapshot(),
    ]);

    return NextResponse.json({
      overview,
      queue,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to force retry sync" },
      { status: 500 },
    );
  }
}
