import { NextResponse } from "next/server";
import { z } from "zod";

import { setEnvValue } from "@/lib/env";

export const dynamic = "force-dynamic";

const schema = z.object({
  apiKey: z.string(),
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    await setEnvValue("ALPHA_VANTAGE_API_KEY", body.apiKey.trim());

    return NextResponse.json({
      ok: true,
      hasApiKey: body.apiKey.trim().length > 0,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update API key" },
      { status: 400 },
    );
  }
}
