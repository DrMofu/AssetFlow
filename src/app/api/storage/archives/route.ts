import { NextResponse } from "next/server";
import { z } from "zod";

import { getRepository } from "@/lib/repository";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().max(80).optional(),
  mode: z.enum(["empty", "duplicate"]).optional(),
});

export async function GET() {
  try {
    const repository = getRepository();
    const overview = await repository.getArchiveOverview();
    return NextResponse.json(overview);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load archives" },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const repository = getRepository();
    await repository.createArchive(body.name, body.mode ?? "duplicate");
    const overview = await repository.getArchiveOverview();
    return NextResponse.json(overview);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create archive" },
      { status: 400 },
    );
  }
}
