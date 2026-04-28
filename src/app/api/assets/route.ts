import { NextResponse } from "next/server";
import { z } from "zod";

import { invalidatePortfolioCache } from "@/lib/cache";
import { getAssetSummaries } from "@/lib/portfolio";
import { getRepository } from "@/lib/repository";

export const dynamic = "force-dynamic";

const valueSnapshotSchema = z.object({
  recordType: z.literal("VALUE_SNAPSHOT"),
  recordDate: z.string().min(1),
  amount: z.number().nonnegative(),
  notes: z.string().optional().nullable(),
});

const stockTradeSchema = z.object({
  recordType: z.literal("STOCK_TRADE"),
  recordDate: z.string().min(1),
  side: z.enum(["BUY", "SELL"]),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  symbol: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const stockSnapshotSchema = z.object({
  recordType: z.literal("STOCK_SNAPSHOT"),
  recordDate: z.string().min(1),
  quantity: z.number().nonnegative(),
  unitPrice: z.number().nonnegative(),
  symbol: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const createSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("CASH"),
    name: z.string().min(1),
    currency: z.enum(["USD", "CNY"]),
    folderId: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    initialRecord: valueSnapshotSchema,
  }),
  z.object({
    type: z.literal("OTHER"),
    name: z.string().min(1),
    currency: z.enum(["USD", "CNY"]),
    folderId: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    initialRecord: valueSnapshotSchema,
  }),
  z.object({
    type: z.literal("SECURITIES"),
    name: z.string().min(1),
    currency: z.enum(["USD", "CNY"]),
    folderId: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    initialRecord: z.union([stockTradeSchema, stockSnapshotSchema]),
  }),
]);

function normalizeInitialRecord(
  record: z.infer<typeof valueSnapshotSchema> | z.infer<typeof stockTradeSchema> | z.infer<typeof stockSnapshotSchema>,
) {
  if (record.recordType === "VALUE_SNAPSHOT") {
    return {
      recordType: "VALUE_SNAPSHOT" as const,
      recordDate: record.recordDate,
      amount: record.amount,
      notes: record.notes ?? undefined,
    };
  }

  if (record.recordType === "STOCK_SNAPSHOT") {
    return {
      recordType: "STOCK_SNAPSHOT" as const,
      recordDate: record.recordDate,
      quantity: record.quantity,
      unitPrice: record.unitPrice,
      symbol: record.symbol ?? undefined,
      notes: record.notes ?? undefined,
    };
  }

  return {
    recordType: "STOCK_TRADE" as const,
    recordDate: record.recordDate,
    side: record.side,
    quantity: record.quantity,
    unitPrice: record.unitPrice,
    symbol: record.symbol ?? undefined,
    notes: record.notes ?? undefined,
  };
}

export async function GET() {
  const repository = getRepository();
  const settings = await repository.getSettings();
  const summaries = await getAssetSummaries(settings.displayCurrency);
  return NextResponse.json({ assets: summaries, baseCurrency: settings.displayCurrency });
}

export async function POST(request: Request) {
  try {
    const body = createSchema.parse(await request.json());
    const repository = getRepository();
    const asset = await repository.createAsset({
      type: body.type,
      name: body.name,
      currency: body.currency,
      folderId: body.folderId ?? undefined,
      notes: body.notes ?? undefined,
      initialRecord: normalizeInitialRecord(body.initialRecord),
    });
    void invalidatePortfolioCache();
    return NextResponse.json({ asset });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create asset" },
      { status: 400 },
    );
  }
}
