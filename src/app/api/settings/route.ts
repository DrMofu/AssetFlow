import { NextResponse } from "next/server";
import { z } from "zod";

import { invalidatePortfolioCache } from "@/lib/cache";
import { getRepository } from "@/lib/repository";

export const dynamic = "force-dynamic";

const schema = z.object({
  displayCurrency: z.enum(["USD", "CNY"]),
  themePreference: z.enum(["light", "dark"]),
  historyTopAssetCount: z.coerce.number().int().min(1).max(50),
  timeZone: z.string().max(80),
  colorScheme: z.enum(["green-up", "red-up"]),
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    const repository = getRepository();
    const prevSettings = await repository.getSettings();
    const settings = await repository.updateSettings(body);
    // Currency change invalidates all cached values (they are currency-specific)
    if (body.displayCurrency !== prevSettings.displayCurrency) {
      void invalidatePortfolioCache();
    }
    return NextResponse.json({ settings });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update settings" },
      { status: 400 },
    );
  }
}
