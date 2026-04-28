import { NextResponse } from "next/server";

import { getRepository } from "@/lib/repository";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const repository = getRepository();
    await repository.deleteArchive(id);
    const overview = await repository.getArchiveOverview();
    return NextResponse.json(overview);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete archive" },
      { status: 400 },
    );
  }
}
