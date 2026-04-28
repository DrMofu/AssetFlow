import { NextResponse } from "next/server";

import { PERIOD_OPTIONS } from "@/lib/constants";
import { getDashboardData } from "@/lib/portfolio";
import { getRepository } from "@/lib/repository";
import type { PeriodOption } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const period = (searchParams.get("period") as PeriodOption) || "1y";
  const safePeriod = PERIOD_OPTIONS.includes(period) ? period : "1y";
  const repository = getRepository();
  const settings = await repository.getSettings();

  const data = await getDashboardData(settings.displayCurrency, safePeriod);
  return NextResponse.json(data);
}
