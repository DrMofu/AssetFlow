import { NextResponse } from "next/server";
import { z } from "zod";

import { invalidatePortfolioCache } from "@/lib/cache";
import { getAssetDetailData } from "@/lib/portfolio";
import { getRepository } from "@/lib/repository";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().min(1),
  currency: z.enum(["USD", "CNY"]),
  folderId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const repository = getRepository();
  const settings = await repository.getSettings();
  const { id } = await context.params;
  const detail = await getAssetDetailData(id, settings.displayCurrency);

  if (!detail) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  return NextResponse.json(detail);
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = updateSchema.parse(await request.json());
    const repository = getRepository();
    const asset = await repository.updateAsset({
      id,
      name: body.name,
      currency: body.currency,
      folderId: body.folderId ?? undefined,
      notes: body.notes ?? undefined,
    });
    void invalidatePortfolioCache();
    return NextResponse.json({ asset });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update asset" },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const repository = getRepository();
    await repository.deleteAsset(id);
    void invalidatePortfolioCache();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete asset" },
      { status: 400 },
    );
  }
}
