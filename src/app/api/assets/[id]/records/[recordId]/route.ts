import { NextResponse } from "next/server";
import { z } from "zod";

import { invalidatePortfolioCache } from "@/lib/cache";
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

const updateSchema = z.union([valueSnapshotSchema, stockTradeSchema, stockSnapshotSchema]);

function normalizeRecordInput(
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

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string; recordId: string }> },
) {
  try {
    const body = updateSchema.parse(await request.json());
    const { id, recordId } = await context.params;
    const repository = getRepository();
    const record = await repository.updateAssetRecord(id, {
      id: recordId,
      ...normalizeRecordInput(body),
    });
    void invalidatePortfolioCache();
    return NextResponse.json({ record });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update record" },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; recordId: string }> },
) {
  try {
    const { id, recordId } = await context.params;
    const repository = getRepository();
    await repository.deleteAssetRecord(id, recordId);
    void invalidatePortfolioCache();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete record" },
      { status: 400 },
    );
  }
}
