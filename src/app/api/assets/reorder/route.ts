import { NextResponse } from "next/server";
import { z } from "zod";

import { getRepository } from "@/lib/repository";

export const dynamic = "force-dynamic";

const schema = z.object({
  assetId: z.string().min(1),
  folderId: z.string().optional().nullable(),
  beforeAssetId: z.string().optional().nullable(),
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const repository = getRepository();
    await repository.moveAssetToFolderAndReorder(body.assetId, body.folderId ?? undefined, body.beforeAssetId ?? undefined);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reorder asset" },
      { status: 400 },
    );
  }
}
