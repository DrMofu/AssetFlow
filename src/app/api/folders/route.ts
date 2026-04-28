import { NextResponse } from "next/server";
import { z } from "zod";

import { getRepository } from "@/lib/repository";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1),
});

export async function GET() {
  const repository = getRepository();
  const folders = await repository.listAssetFolders();
  return NextResponse.json({ folders });
}

export async function POST(request: Request) {
  try {
    const body = createSchema.parse(await request.json());
    const repository = getRepository();
    const folder = await repository.createAssetFolder(body.name);
    return NextResponse.json({ folder });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create folder" },
      { status: 400 },
    );
  }
}
