import { NextResponse } from "next/server";

import { getPortfolioCacheStats } from "@/lib/cache";
import { buildPortfolioCache } from "@/lib/portfolio";
import { getRepository } from "@/lib/repository";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const settings = await getRepository().getSettings();
    await buildPortfolioCache(settings.displayCurrency);
    const stats = await getPortfolioCacheStats();
    return NextResponse.json({ ok: true, ...stats });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to rebuild cache" },
      { status: 500 },
    );
  }
}
