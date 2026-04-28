import { NextResponse } from "next/server";

import { getPortfolioCacheStats } from "@/lib/cache";
import { getRepository } from "@/lib/repository";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await getRepository().getSettings();
    const stats = await getPortfolioCacheStats();
    return NextResponse.json({ ...stats, currency: settings.displayCurrency });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get cache stats" },
      { status: 500 },
    );
  }
}
