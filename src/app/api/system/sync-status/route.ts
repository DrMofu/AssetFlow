import { NextResponse } from "next/server";

import { getDataSyncOverview } from "@/lib/portfolio";
import { getRepository } from "@/lib/repository";
import { getSyncStatusSnapshot } from "@/lib/sync-queue";

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
