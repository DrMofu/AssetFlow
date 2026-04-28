import { NextResponse } from "next/server";
import { z } from "zod";

import { getRepository } from "@/lib/repository";

export const dynamic = "force-dynamic";

const schema = z.object({
  folderId: z.string().min(1),
  beforeFolderId: z.string().optional().nullable(),
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const repository = getRepository();
    await repository.reorderAssetFolder(body.folderId, body.beforeFolderId ?? undefined);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reorder folder" },
      { status: 400 },
    );
  }
}
