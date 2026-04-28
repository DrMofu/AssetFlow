import { NextResponse } from "next/server";

import { invalidatePortfolioCache } from "@/lib/cache";
import { getRepository } from "@/lib/repository";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const repository = getRepository();
    await repository.switchArchive(id);
    // Invalidate the newly-active archive's cache (may be stale from a previous session/day)
    void invalidatePortfolioCache();
    const overview = await repository.getArchiveOverview();
    return NextResponse.json(overview);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to switch archive" },
      { status: 400 },
    );
  }
}
