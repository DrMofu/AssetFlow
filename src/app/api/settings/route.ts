import { NextResponse } from "next/server";
import { z } from "zod";

import { invalidatePortfolioCache } from "@/lib/cache";
import { ASSET_MILESTONE_TARGET_LIMIT } from "@/lib/constants";
import { getRepository } from "@/lib/repository";

export const dynamic = "force-dynamic";

const targetListSchema = z.array(z.coerce.number().positive().finite()).max(ASSET_MILESTONE_TARGET_LIMIT);

function normalizeTargetList(value: number[] | undefined) {
  if (!value?.length) {
    return undefined;
  }

  const targets = [...new Set(value.map((item) => Math.round(item * 100) / 100))]
    .sort((left, right) => left - right)
    .slice(0, ASSET_MILESTONE_TARGET_LIMIT);

  return targets.length ? targets : undefined;
}

const schema = z.object({
  displayCurrency: z.enum(["USD", "CNY"]),
  themePreference: z.enum(["light", "dark"]),
  historyTopAssetCount: z.coerce.number().int().min(1).max(50),
  timeZone: z.string().max(80),
  colorScheme: z.enum(["green-up", "red-up"]),
  assetMilestoneTargets: z.object({
    USD: targetListSchema.optional(),
    CNY: targetListSchema.optional(),
  }).optional().default({}),
}).transform((input) => {
  const assetMilestoneTargets: typeof input.assetMilestoneTargets = {};
  const usdTargets = normalizeTargetList(input.assetMilestoneTargets.USD);
  const cnyTargets = normalizeTargetList(input.assetMilestoneTargets.CNY);

  if (usdTargets) {
    assetMilestoneTargets.USD = usdTargets;
  }
  if (cnyTargets) {
    assetMilestoneTargets.CNY = cnyTargets;
  }

  return {
    ...input,
    assetMilestoneTargets,
  };
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
