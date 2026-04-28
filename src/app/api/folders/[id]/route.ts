import { NextResponse } from "next/server";

import { getRepository } from "@/lib/repository";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const repository = getRepository();
    await repository.deleteAssetFolder(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete folder" },
      { status: 400 },
    );
  }
}
