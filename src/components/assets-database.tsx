"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { SensitiveValue } from "@/components/app-preferences";
import { AssetTimelineChart } from "@/components/charts";
import type {
  AssetFolder,
  AssetDetailData,
  AssetRecordType,
  AssetSummary,
  AssetType,
  CreateAssetInput,
  CreateAssetRecordInput,
  CurrencyCode,
  HistoryRangePreset,
  StockTradeSide,
} from "@/lib/types";
import { formatCurrency, formatPercent, formatStoredCalendarDateLabel } from "@/lib/utils";

type AssetModalState =
  | { mode: "create" }
  | {
      mode: "edit";
      asset: AssetSummary;
    }
  | null;

type RecordModalState =
  | {
      mode: "create";
      asset: AssetSummary;
    }
  | {
      mode: "edit";
      asset: AssetSummary;
      record: AssetDetailData["records"][number];
    }
  | null;

type FolderModalState = { mode: "create" } | null;

type DragPayload =
  | {
      type: "asset";
      id: string;
      folderId: string | null;
    }
  | {
      type: "folder";
      id: string;
    };

const HIDE_ZERO_VALUE_ASSETS_STORAGE_KEY = "assetflow:assets:hide-zero-value-assets";
const COLLAPSED_FOLDERS_STORAGE_KEY = "assetflow:assets:collapsed-folders";

async function requestJson<T>(url: string, options: RequestInit) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });

  const result = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(result.error ?? "Request failed");
  }

  return result;
}

function typeLabel(type: AssetType) {
  if (type === "CASH") return "现金";
  if (type === "OTHER") return "其他";
  return "股票";
}

function recordTypeLabel(recordType: AssetRecordType) {
  if (recordType === "VALUE_SNAPSHOT") return "金额快照";
  if (recordType === "STOCK_SNAPSHOT") return "持仓快照";
  return "交易记录";
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M13.9 3.6a1.5 1.5 0 0 1 2.1 0l.4.4a1.5 1.5 0 0 1 0 2.1l-8.8 8.8-3.3.8.8-3.3 8.8-8.8Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m12.8 4.7 2.5 2.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
      <path
        d="M5.5 5.5 14.5 14.5M14.5 5.5l-9 9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ZeroVisibilityIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <circle cx="10" cy="10" r="6.3" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M7.3 10a2.7 2.7 0 1 1 5.4 0 2.7 2.7 0 0 1-5.4 0Z"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      {hidden ? (
        <path d="M4.2 15.8 15.8 4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      ) : null}
    </svg>
  );
}

function defaultRecordTypeForAsset(type: AssetType): AssetRecordType {
  return type === "SECURITIES" ? "STOCK_TRADE" : "VALUE_SNAPSHOT";
}

function buildDefaultAssetPayload(): CreateAssetInput {
  return {
    type: "CASH",
    name: "",
    currency: "USD",
    folderId: null,
    notes: "",
    initialRecord: {
      recordType: "VALUE_SNAPSHOT",
      recordDate: new Date().toISOString().slice(0, 10),
      amount: 0,
      notes: "",
    },
  };
}

function folderLabel(folderId: string | null | undefined, folders: AssetFolder[]) {
  if (!folderId) return "默认";
  return folders.find((folder) => folder.id === folderId)?.name ?? "默认";
}

function encodeDragPayload(payload: DragPayload) {
  return JSON.stringify(payload);
}

function decodeDragPayload(raw: string): DragPayload | null {
  try {
    const parsed = JSON.parse(raw) as DragPayload;
    if (parsed && (parsed.type === "asset" || parsed.type === "folder") && typeof parsed.id === "string") {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function buildDefaultRecordPayload(asset: AssetSummary): CreateAssetRecordInput {
  if (asset.type === "SECURITIES") {
    return {
      recordType: "STOCK_TRADE",
      recordDate: new Date().toISOString().slice(0, 10),
      side: "BUY",
      quantity: 1,
      unitPrice: asset.unitPrice ?? 0,
      symbol: asset.symbol ?? "",
      notes: "",
    };
  }

  return {
    recordType: "VALUE_SNAPSHOT",
    recordDate: new Date().toISOString().slice(0, 10),
    amount: asset.nativeValue,
    notes: "",
  };
}

function buildExistingRecordPayload(record: AssetDetailData["records"][number]): CreateAssetRecordInput {
  if (record.recordType === "VALUE_SNAPSHOT") {
    return {
      recordType: "VALUE_SNAPSHOT",
      recordDate: record.recordDate.slice(0, 10),
      amount: record.amount ?? 0,
      notes: record.notes ?? "",
    };
  }

  if (record.recordType === "STOCK_SNAPSHOT") {
    return {
      recordType: "STOCK_SNAPSHOT",
      recordDate: record.recordDate.slice(0, 10),
      quantity: record.quantity ?? 0,
      unitPrice: record.unitPrice ?? 0,
      symbol: record.symbol ?? "",
      notes: record.notes ?? "",
    };
  }

  return {
    recordType: "STOCK_TRADE",
    recordDate: record.recordDate.slice(0, 10),
    side: record.side ?? "BUY",
    quantity: record.quantity ?? 0,
    unitPrice: record.unitPrice ?? 0,
    symbol: record.symbol ?? "",
    notes: record.notes ?? "",
  };
}

function formatShareQuantity(value?: number | null) {
  if (value == null) return "0";

  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function securitySyncStatusLabel(detail: AssetDetailData) {
  const asset = detail.asset;
  if (asset.type !== "SECURITIES") {
    return null;
  }

  if (!asset.symbol) {
    return null;
  }

  if (asset.priceSyncState === "synced") {
    return asset.priceCoverageEnd
      ? `股价同步至 ${formatStoredCalendarDateLabel(asset.priceCoverageEnd)}`
      : "已完成";
  }

  if (asset.priceSyncState === "missing_api_key" || asset.priceSyncState === "manual") {
    return "失败";
  }

  return "同步中";
}

function buildAssetHrefWithDates(
  assetId?: string,
  rangePreset: HistoryRangePreset = "all",
  startDate?: string,
  endDate?: string,
) {
  const params = new URLSearchParams();
  if (assetId) {
    params.set("asset", assetId);
  }
  params.set("range", rangePreset);
  if (startDate && endDate && startDate <= endDate) {
    params.set("start", startDate);
    params.set("end", endDate);
  }
  const query = params.toString();
  return query ? `/assets?${query}` : "/assets";
}

function AssetModal({
  state,
  folders,
  onClose,
  onSaved,
}: {
  state: Exclude<AssetModalState, null>;
  folders: AssetFolder[];
  onClose: () => void;
  onSaved: (assetId: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<CreateAssetInput>(
    state?.mode === "edit"
      ? {
          type: state.asset.type,
          name: state.asset.name,
          currency: state.asset.currency,
          folderId: state.asset.folderId ?? null,
          notes: state.asset.notes ?? "",
          initialRecord: {
            recordType: defaultRecordTypeForAsset(state.asset.type) as CreateAssetRecordInput["recordType"],
            recordDate: new Date().toISOString().slice(0, 10),
            amount: 0,
            notes: "",
          } as CreateAssetRecordInput,
        }
      : buildDefaultAssetPayload(),
  );

  const isEdit = state?.mode === "edit";

  function updateAssetField<K extends keyof CreateAssetInput>(key: K, value: CreateAssetInput[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateInitialRecord(nextType?: AssetType) {
    const assetType = nextType ?? draft.type;
    const currency = nextType ? "USD" : draft.currency;
    setDraft({
      type: assetType,
      name: "",
      currency,
      folderId: draft.folderId ?? null,
      notes: "",
      initialRecord:
        assetType === "SECURITIES"
          ? {
              recordType: "STOCK_TRADE",
              recordDate: new Date().toISOString().slice(0, 10),
              side: "BUY",
              quantity: 1,
              unitPrice: 0,
              symbol: "",
              notes: "",
            }
          : {
              recordType: "VALUE_SNAPSHOT",
              recordDate: new Date().toISOString().slice(0, 10),
              amount: 0,
              notes: "",
            },
    });
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);

    try {
      if (isEdit && state) {
        const result = await requestJson<{ asset: AssetSummary }>(`/api/assets/${state.asset.id}`, {
          method: "PUT",
          body: JSON.stringify({
            name: draft.name,
            currency: draft.currency,
            folderId: draft.folderId,
            notes: draft.notes,
          }),
        });
        onSaved(result.asset.id);
        return;
      }

      const result = await requestJson<{ asset: AssetSummary }>("/api/assets", {
        method: "POST",
        body: JSON.stringify(draft),
      });
      onSaved(result.asset.id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "保存失败");
    } finally {
      setSubmitting(false);
    }
  }

  const initialRecord = draft.initialRecord;
  const initialSecurityRecord =
    draft.type === "SECURITIES" && initialRecord.recordType !== "VALUE_SNAPSHOT"
      ? initialRecord
      : null;
  const initialValueRecord =
    draft.type !== "SECURITIES" && initialRecord.recordType === "VALUE_SNAPSHOT"
      ? initialRecord
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="af-card flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="af-kicker text-xs uppercase tracking-[0.22em]">
              {isEdit ? "编辑资产" : "新增资产"}
            </p>
            <h3 className="mt-2 text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
              {isEdit ? "编辑资产" : "新增资产"}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭窗口"
            className="af-button-info h-9 w-9 shrink-0 rounded-full p-0"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="mt-6 min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="grid gap-4">
          {!isEdit ? (
            <label className="af-text-muted grid gap-2 text-sm">
              资产类型
              <select
                value={draft.type}
                onChange={(event) => updateInitialRecord(event.target.value as AssetType)}
                className="af-input rounded-2xl px-4 py-3"
              >
                <option value="CASH">现金</option>
                <option value="SECURITIES">股票</option>
                <option value="OTHER">其他</option>
              </select>
            </label>
          ) : (
            <div className="af-card-soft rounded-2xl px-4 py-3">
              <p className="af-text-muted text-sm">资产类型</p>
              <p className="mt-1 font-semibold" style={{ color: "var(--text-primary)" }}>
                {typeLabel(draft.type)}
              </p>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <label className="af-text-muted grid gap-2 text-sm">
              资产名称
              <input
                value={draft.name}
                onChange={(event) => updateAssetField("name", event.target.value)}
                className="af-input rounded-2xl px-4 py-3"
              />
            </label>
            <label className="af-text-muted grid gap-2 text-sm">
              币种
              <select
                value={draft.currency}
                onChange={(event) => updateAssetField("currency", event.target.value as CurrencyCode)}
                className="af-input rounded-2xl px-4 py-3"
              >
                <option value="USD">USD</option>
                <option value="CNY">RMB</option>
              </select>
            </label>
          </div>

          <label className="af-text-muted grid gap-2 text-sm">
            所属文件夹
            <select
              value={draft.folderId ?? ""}
              onChange={(event) => updateAssetField("folderId", event.target.value || null)}
              className="af-input rounded-2xl px-4 py-3"
            >
              <option value="">默认</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </label>

          <label className="af-text-muted grid gap-2 text-sm">
            资产备注
            <textarea
              value={draft.notes ?? ""}
              onChange={(event) => updateAssetField("notes", event.target.value)}
              className="af-input min-h-20 rounded-2xl px-4 py-3"
            />
          </label>

          {!isEdit ? (
            <div className="af-card-soft grid gap-4 rounded-[24px] p-4">
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  初始记录
                </p>
                <p className="af-text-muted mt-1 text-sm">创建资产时必须同时写入第一条时间记录。</p>
              </div>

              {draft.type === "SECURITIES" ? (
                <>
                  <label className="af-text-muted grid gap-2 text-sm">
                    记录类型
                    <select
                      value={initialSecurityRecord?.recordType ?? "STOCK_TRADE"}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          initialRecord:
                            event.target.value === "STOCK_SNAPSHOT"
                              ? {
                                  recordType: "STOCK_SNAPSHOT",
                                  recordDate: new Date().toISOString().slice(0, 10),
                                  quantity: 0,
                                  unitPrice: 0,
                                  symbol: "",
                                  notes: "",
                                }
                              : {
                                  recordType: "STOCK_TRADE",
                                  recordDate: new Date().toISOString().slice(0, 10),
                                  side: "BUY",
                                  quantity: 1,
                                  unitPrice: 0,
                                  symbol: "",
                                  notes: "",
                                },
                        }))
                      }
                      className="af-input rounded-2xl px-4 py-3"
                    >
                      <option value="STOCK_TRADE">交易记录</option>
                      <option value="STOCK_SNAPSHOT">持仓快照</option>
                    </select>
                  </label>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="af-text-muted grid gap-2 text-sm">
                      日期
                    <input
                        type="date"
                        value={initialSecurityRecord?.recordDate ?? ""}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            initialRecord: { ...current.initialRecord, recordDate: event.target.value } as CreateAssetRecordInput,
                          }))
                        }
                        className="af-input rounded-2xl px-4 py-3"
                      />
                    </label>
                    <label className="af-text-muted grid gap-2 text-sm">
                      股票代码
                      <input
                        value={initialSecurityRecord?.symbol ?? ""}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            initialRecord: { ...current.initialRecord, symbol: event.target.value } as CreateAssetRecordInput,
                          }))
                        }
                        className="af-input rounded-2xl px-4 py-3"
                        placeholder="例如 NVDA"
                      />
                      <span className="text-xs">填写后会自动补齐该股票从最早记录日开始的每日价格。</span>
                    </label>
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    {initialSecurityRecord?.recordType === "STOCK_TRADE" ? (
                      <label className="af-text-muted grid gap-2 text-sm">
                        买卖方向
                        <select
                          value={initialSecurityRecord.side}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              initialRecord: {
                                ...current.initialRecord,
                                side: event.target.value as StockTradeSide,
                              } as CreateAssetRecordInput,
                            }))
                          }
                          className="af-input rounded-2xl px-4 py-3"
                        >
                          <option value="BUY">买入</option>
                          <option value="SELL">卖出</option>
                        </select>
                      </label>
                    ) : (
                      <div className="af-card-soft rounded-2xl px-4 py-3">
                        <p className="af-text-muted text-sm">记录模式</p>
                        <p className="mt-1 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                          直接重置持仓
                        </p>
                      </div>
                    )}
                    <label className="af-text-muted grid gap-2 text-sm">
                      股数
                      <input
                        type="number"
                        step="0.0001"
                        value={initialSecurityRecord?.quantity ?? 0}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            initialRecord: {
                              ...current.initialRecord,
                              quantity: Number(event.target.value),
                            } as CreateAssetRecordInput,
                          }))
                        }
                        className="af-input rounded-2xl px-4 py-3"
                      />
                    </label>
                    <label className="af-text-muted grid gap-2 text-sm">
                      单价
                      <input
                        type="number"
                        step="0.0001"
                        value={initialSecurityRecord?.unitPrice ?? 0}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            initialRecord: {
                              ...current.initialRecord,
                              unitPrice: Number(event.target.value),
                            } as CreateAssetRecordInput,
                          }))
                        }
                        className="af-input rounded-2xl px-4 py-3"
                      />
                    </label>
                  </div>
                </>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="af-text-muted grid gap-2 text-sm">
                    日期
                    <input
                      type="date"
                      value={initialValueRecord?.recordDate ?? ""}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          initialRecord: { ...current.initialRecord, recordDate: event.target.value } as CreateAssetRecordInput,
                        }))
                      }
                      className="af-input rounded-2xl px-4 py-3"
                    />
                  </label>
                  <label className="af-text-muted grid gap-2 text-sm">
                    金额
                    <input
                      type="number"
                      step="0.01"
                      value={initialValueRecord?.amount ?? 0}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          initialRecord: { ...current.initialRecord, amount: Number(event.target.value) } as CreateAssetRecordInput,
                        }))
                      }
                      className="af-input rounded-2xl px-4 py-3"
                    />
                  </label>
                </div>
              )}

              <label className="af-text-muted grid gap-2 text-sm">
                记录备注
                <textarea
                  value={initialRecord.notes ?? ""}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      initialRecord: { ...current.initialRecord, notes: event.target.value } as CreateAssetRecordInput,
                    }))
                  }
                  className="af-input min-h-20 rounded-2xl px-4 py-3"
                />
              </label>
            </div>
          ) : null}

          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          </div>
        </div>
        <div
          className="mt-5 flex flex-wrap justify-end gap-3 border-t pt-5"
          style={{ borderColor: "var(--border-color)" }}
        >
          <button type="button" onClick={onClose} className="af-button-secondary rounded-full px-5 py-3 text-sm font-semibold">
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="af-button-success rounded-full px-5 py-3 text-sm font-semibold disabled:opacity-60"
          >
            {submitting ? "保存中..." : "确认"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RecordModal({
  state,
  onClose,
  onSaved,
}: {
  state: Exclude<RecordModalState, null>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<CreateAssetRecordInput>(
    state.mode === "edit" ? buildExistingRecordPayload(state.record) : buildDefaultRecordPayload(state.asset),
  );

  const isEdit = state.mode === "edit";
  const stockDraft = draft.recordType !== "VALUE_SNAPSHOT" ? draft : null;
  const valueDraft = draft.recordType === "VALUE_SNAPSHOT" ? draft : null;
  const stockSymbol = state.asset.symbol ?? stockDraft?.symbol ?? "";

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);

    const payload =
      state.asset.type === "SECURITIES" && draft.recordType !== "VALUE_SNAPSHOT"
        ? ({
            ...draft,
            symbol: stockSymbol || undefined,
          } as CreateAssetRecordInput)
        : draft;

    try {
      if (isEdit) {
        await requestJson(`/api/assets/${state.asset.id}/records/${state.record.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } else {
        await requestJson(`/api/assets/${state.asset.id}/records`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      onSaved();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "保存失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="af-card flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="af-kicker text-xs uppercase tracking-[0.22em]">
              {isEdit ? "编辑记录" : "新增记录"}
            </p>
            <h3 className="mt-2 text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
              {isEdit ? "编辑时间记录" : "新增时间记录"}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭窗口"
            className="af-button-info h-9 w-9 shrink-0 rounded-full p-0"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="mt-6 min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="grid gap-4">
          {state.asset.type === "SECURITIES" ? (
            <>
              <div className="grid gap-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                <label className="af-text-muted grid gap-2 text-sm">
                  记录类型
                  <select
                    value={stockDraft?.recordType ?? "STOCK_TRADE"}
                    onChange={(event) =>
                      setDraft(
                        event.target.value === "STOCK_SNAPSHOT"
                          ? {
                              recordType: "STOCK_SNAPSHOT",
                              recordDate: draft.recordDate,
                              quantity: stockDraft?.quantity ?? 0,
                              unitPrice: stockDraft?.unitPrice ?? 0,
                              symbol: stockSymbol,
                              notes: draft.notes ?? "",
                            }
                          : {
                              recordType: "STOCK_TRADE",
                              recordDate: draft.recordDate,
                              side: stockDraft?.recordType === "STOCK_TRADE" ? stockDraft.side : "BUY",
                              quantity: stockDraft?.quantity ?? 0,
                              unitPrice: stockDraft?.unitPrice ?? 0,
                              symbol: stockSymbol,
                              notes: draft.notes ?? "",
                            },
                      )
                    }
                    className="af-input rounded-2xl px-4 py-3"
                  >
                    <option value="STOCK_TRADE">交易记录</option>
                    <option value="STOCK_SNAPSHOT">持仓快照</option>
                  </select>
                </label>
                <label className="af-text-muted grid gap-2 text-sm">
                  日期
                  <input
                    type="date"
                    value={stockDraft?.recordDate ?? ""}
                    onChange={(event) => setDraft((current) => ({ ...current, recordDate: event.target.value }))}
                    className="af-input rounded-2xl px-4 py-3"
                  />
                </label>
              </div>

              <div className="af-card-soft flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3">
                <div className="min-w-0">
                  <p className="af-text-muted text-xs">股票代码</p>
                  <p className="mt-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    {stockSymbol || "未设置"}
                  </p>
                </div>
                <p className="af-text-muted text-xs">
                  股票代码跟随资产本体；在记录里不单独修改。
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)_minmax(0,1fr)]">
                {stockDraft?.recordType === "STOCK_TRADE" ? (
                  <label className="af-text-muted grid gap-2 text-sm">
                    买卖方向
                    <select
                      value={stockDraft.side}
                      onChange={(event) =>
                        setDraft((current) =>
                          ({ ...current, side: event.target.value as StockTradeSide } as CreateAssetRecordInput),
                        )
                      }
                      className="af-input rounded-2xl px-4 py-3"
                    >
                      <option value="BUY">买入</option>
                      <option value="SELL">卖出</option>
                    </select>
                  </label>
                ) : (
                  <div className="af-card-soft rounded-2xl px-4 py-3">
                    <p className="af-text-muted text-sm">记录模式</p>
                    <p className="mt-1 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      直接重置持仓
                    </p>
                  </div>
                )}

                <label className="af-text-muted grid gap-2 text-sm">
                  股数
                  <input
                    type="number"
                    step="0.0001"
                    value={stockDraft?.quantity ?? 0}
                    onChange={(event) =>
                      setDraft((current) =>
                        ({ ...current, quantity: Number(event.target.value) } as CreateAssetRecordInput),
                      )
                    }
                    className="af-input rounded-2xl px-4 py-3"
                  />
                </label>
                <label className="af-text-muted grid gap-2 text-sm">
                  单价
                  <input
                    type="number"
                    step="0.0001"
                    value={stockDraft?.unitPrice ?? 0}
                    onChange={(event) =>
                      setDraft((current) =>
                        ({ ...current, unitPrice: Number(event.target.value) } as CreateAssetRecordInput),
                      )
                    }
                    className="af-input rounded-2xl px-4 py-3"
                  />
                </label>
              </div>
            </>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <label className="af-text-muted grid gap-2 text-sm">
                日期
                <input
                  type="date"
                  value={valueDraft?.recordDate ?? ""}
                  onChange={(event) => setDraft((current) => ({ ...current, recordDate: event.target.value }))}
                  className="af-input rounded-2xl px-4 py-3"
                />
              </label>
              <label className="af-text-muted grid gap-2 text-sm">
                金额
                <input
                  type="number"
                  step="0.01"
                  value={valueDraft?.amount ?? 0}
                  onChange={(event) =>
                    setDraft((current) =>
                      ({ ...current, amount: Number(event.target.value) } as CreateAssetRecordInput),
                    )
                  }
                  className="af-input rounded-2xl px-4 py-3"
                />
              </label>
            </div>
          )}

          <label className="af-text-muted grid gap-2 text-sm">
            记录备注
            <textarea
              value={draft.notes ?? ""}
              onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
              className="af-input min-h-20 rounded-2xl px-4 py-3"
            />
          </label>

          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          </div>
        </div>
        <div
          className="mt-5 flex flex-wrap justify-end gap-3 border-t pt-5"
          style={{ borderColor: "var(--border-color)" }}
        >
          <button type="button" onClick={onClose} className="af-button-secondary rounded-full px-5 py-3 text-sm font-semibold">
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="af-button-success rounded-full px-5 py-3 text-sm font-semibold disabled:opacity-60"
          >
            {submitting ? "保存中..." : "确认"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FolderModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await requestJson("/api/folders", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      onSaved();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "创建失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="af-card flex w-full max-w-lg flex-col rounded-[28px] p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="af-kicker text-xs uppercase tracking-[0.22em]">新增文件夹</p>
            <h3 className="mt-2 text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
              新增文件夹
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭窗口"
            className="af-button-info h-9 w-9 shrink-0 rounded-full p-0"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="mt-6 grid gap-4">
          <label className="af-text-muted grid gap-2 text-sm">
            文件夹名称
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="af-input rounded-2xl px-4 py-3"
              placeholder="例如 Robinhood"
            />
          </label>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        </div>
        <div
          className="mt-5 flex flex-wrap justify-end gap-3 border-t pt-5"
          style={{ borderColor: "var(--border-color)" }}
        >
          <button type="button" onClick={onClose} className="af-button-secondary rounded-full px-5 py-3 text-sm font-semibold">
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="af-button-success rounded-full px-5 py-3 text-sm font-semibold disabled:opacity-60"
          >
            {submitting ? "创建中..." : "确认"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AssetsDatabase({
  folders,
  assets,
  detail,
  baseCurrency,
  rootFolderSortOrder,
  selectedAssetId,
  rangePreset,
  startDate,
  endDate,
}: {
  folders: AssetFolder[];
  assets: AssetSummary[];
  detail: AssetDetailData | null;
  baseCurrency: CurrencyCode;
  rootFolderSortOrder: number;
  selectedAssetId?: string;
  rangePreset: HistoryRangePreset;
  startDate?: string;
  endDate?: string;
}) {
  const ROOT_SECTION_ID = "__root__";
  const router = useRouter();
  const [assetModalState, setAssetModalState] = useState<AssetModalState>(null);
  const [folderModalState, setFolderModalState] = useState<FolderModalState>(null);
  const [recordModalState, setRecordModalState] = useState<RecordModalState>(null);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null);
  const [dragTargetKey, setDragTargetKey] = useState<string | null>(null);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<string[]>([]);
  const [hideZeroValueAssets, setHideZeroValueAssets] = useState(false);
  const [selectedRecordDate, setSelectedRecordDate] = useState<string | null>(null);
  const [hasLoadedHideZeroValuePreference, setHasLoadedHideZeroValuePreference] = useState(false);
  const [hasLoadedCollapsedFoldersPreference, setHasLoadedCollapsedFoldersPreference] = useState(false);
  const dragPayloadRef = useRef<DragPayload | null>(null);
  const dragCleanupTimerRef = useRef<number | null>(null);
  const chartCardRef = useRef<HTMLDivElement | null>(null);
  const detailTableRef = useRef<HTMLDivElement | null>(null);
  const recordRowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  const totalValue = assets.reduce((sum, asset) => sum + asset.convertedValue, 0);
  const visibleAssetsForStats = hideZeroValueAssets
    ? assets.filter((asset) => Math.abs(asset.convertedValue) >= 0.005)
    : assets;
  const rootAssets = assets.filter((asset) => !asset.folderId);
  const folderSections = folders
    .map((folder) => ({
      folder,
      assets: assets.filter((asset) => asset.folderId === folder.id),
    }));
  const orderedSections = useMemo(
    () =>
      [
        { key: ROOT_SECTION_ID, title: "默认", folder: null, assets: rootAssets, sortOrder: rootFolderSortOrder },
        ...folderSections.map((section) => ({
          key: section.folder.id,
          title: section.folder.name,
          folder: section.folder,
          assets: section.assets,
          sortOrder: section.folder.sortOrder,
        })),
      ].sort((left, right) => left.sortOrder - right.sortOrder || left.title.localeCompare(right.title, "zh-CN")),
    [folderSections, rootAssets, rootFolderSortOrder],
  );
  const collapsedFolderIdSet = useMemo(() => new Set(collapsedFolderIds), [collapsedFolderIds]);

  useEffect(() => {
    setSelectedRecordDate(null);
  }, [selectedAssetId]);

  useEffect(() => {
    const storedValue = window.localStorage.getItem(HIDE_ZERO_VALUE_ASSETS_STORAGE_KEY);
    setHideZeroValueAssets(storedValue === "true");
    setHasLoadedHideZeroValuePreference(true);
  }, []);

  useEffect(() => {
    const storedValue = window.localStorage.getItem(COLLAPSED_FOLDERS_STORAGE_KEY);
    if (!storedValue) {
      setHasLoadedCollapsedFoldersPreference(true);
      return;
    }

    try {
      const parsed = JSON.parse(storedValue) as unknown;
      if (Array.isArray(parsed)) {
        const validFolderIds = new Set([...folders.map((folder) => folder.id), ROOT_SECTION_ID]);
        setCollapsedFolderIds(
          parsed.filter((item): item is string => typeof item === "string" && validFolderIds.has(item)),
        );
      }
    } catch {
      setCollapsedFolderIds([]);
    } finally {
      setHasLoadedCollapsedFoldersPreference(true);
    }
  }, [folders]);

  useEffect(() => {
    if (!hasLoadedHideZeroValuePreference) {
      return;
    }

    window.localStorage.setItem(HIDE_ZERO_VALUE_ASSETS_STORAGE_KEY, String(hideZeroValueAssets));
  }, [hasLoadedHideZeroValuePreference, hideZeroValueAssets]);

  useEffect(() => {
    if (!hasLoadedCollapsedFoldersPreference) {
      return;
    }

    window.localStorage.setItem(COLLAPSED_FOLDERS_STORAGE_KEY, JSON.stringify(collapsedFolderIds));
  }, [collapsedFolderIds, hasLoadedCollapsedFoldersPreference]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (chartCardRef.current?.contains(target) || detailTableRef.current?.contains(target)) {
        return;
      }

      setSelectedRecordDate(null);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  useEffect(() => {
    if (!selectedRecordDate) {
      return;
    }

    const row = recordRowRefs.current[selectedRecordDate];
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedRecordDate]);

  async function handleDeleteAsset(asset: AssetSummary) {
    if (!window.confirm(`确认删除资产“${asset.name}”以及其全部历史记录吗？`)) {
      return;
    }

    setDeletingAssetId(asset.id);
    try {
      await requestJson(`/api/assets/${asset.id}`, { method: "DELETE" });
      router.push(buildAssetHrefWithDates(undefined, rangePreset, startDate, endDate));
      router.refresh();
    } finally {
      setDeletingAssetId(null);
    }
  }

  async function handleDeleteRecord(assetId: string, recordId: string) {
    if (!window.confirm("确认删除这条时间记录吗？")) {
      return;
    }

    setDeletingRecordId(recordId);
    try {
      await requestJson(`/api/assets/${assetId}/records/${recordId}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setDeletingRecordId(null);
    }
  }

  async function handleDeleteFolder(folder: AssetFolder) {
    if (!window.confirm(`确认删除文件夹“${folder.name}”吗？其中资产会回到默认分组。`)) {
      return;
    }

    await requestJson(`/api/folders/${folder.id}`, { method: "DELETE" });
    router.refresh();
  }

  async function handleAssetDrop(payload: DragPayload, folderId?: string | null, beforeAssetId?: string | null) {
    if (payload.type !== "asset") {
      return;
    }

    await requestJson("/api/assets/reorder", {
      method: "POST",
      body: JSON.stringify({
        assetId: payload.id,
        folderId: folderId ?? null,
        beforeAssetId: beforeAssetId ?? null,
      }),
    });
    setDragTargetKey(null);
    router.refresh();
  }

  async function handleFolderDrop(payload: DragPayload, beforeFolderId?: string | null) {
    if (payload.type !== "folder") {
      return;
    }

    await requestJson("/api/folders/reorder", {
      method: "POST",
      body: JSON.stringify({
        folderId: payload.id,
        beforeFolderId: beforeFolderId ?? null,
      }),
    });
    setDragTargetKey(null);
    router.refresh();
  }

  function resetDragState() {
    if (dragCleanupTimerRef.current) {
      window.clearTimeout(dragCleanupTimerRef.current);
      dragCleanupTimerRef.current = null;
    }
    dragPayloadRef.current = null;
    setDragTargetKey(null);
  }

  function scheduleDragCleanup() {
    if (dragCleanupTimerRef.current) {
      window.clearTimeout(dragCleanupTimerRef.current);
    }

    dragCleanupTimerRef.current = window.setTimeout(() => {
      dragPayloadRef.current = null;
      setDragTargetKey(null);
      dragCleanupTimerRef.current = null;
    }, 60);
  }

  function readActiveDragPayload(raw?: string) {
    return dragPayloadRef.current ?? (raw ? decodeDragPayload(raw) : null);
  }

  function toggleFolder(folderId: string) {
    setCollapsedFolderIds((current) =>
      current.includes(folderId) ? current.filter((id) => id !== folderId) : [...current, folderId],
    );
  }

  return (
    <>
      <div className="grid gap-6">
        <div ref={chartCardRef}>
          <AssetTimelineChart
            detail={detail}
            rangePreset={rangePreset}
            selectedAssetId={selectedAssetId}
            startDate={startDate}
            endDate={endDate}
            selectedRecordDate={selectedRecordDate}
            onSelectedRecordDateChange={setSelectedRecordDate}
          />
        </div>

        <section className="grid gap-6 xl:grid-cols-[minmax(19rem,0.78fr)_minmax(0,1.22fr)] xl:items-stretch">
          <div className="af-card flex min-h-[31rem] flex-col rounded-[32px] p-4 sm:p-6 xl:h-[43.5rem]">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div className="flex items-center gap-3">
                <p className="text-2xl font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>资产列表</p>
                <button
                  type="button"
                  onClick={() => setHideZeroValueAssets((current) => !current)}
                  className="af-button-info inline-flex h-9 w-9 items-center justify-center rounded-full p-0"
                  aria-label={hideZeroValueAssets ? "显示零值资产" : "隐藏零值资产"}
                  title={hideZeroValueAssets ? "显示零值资产" : "隐藏零值资产"}
                >
                  <ZeroVisibilityIcon hidden={hideZeroValueAssets} />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFolderModalState({ mode: "create" })}
                  className="af-button-success inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
                >
                  <span className="text-lg leading-none">+</span>
                  <span>新增文件夹</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAssetModalState({ mode: "create" })}
                  className="af-button-success inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
                >
                  <span className="text-lg leading-none">+</span>
                  <span>新增资产</span>
                </button>
              </div>
            </div>

            <div
              className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-b pb-4 text-sm"
              style={{ borderColor: "var(--border-color)" }}
            >
              <p className="af-text-muted">
                资产数量 <SensitiveValue value={String(visibleAssetsForStats.length)} className="ml-1 font-semibold text-[var(--text-primary)]" />
              </p>
              <p className="af-text-muted">
                现金资产 <SensitiveValue value={String(visibleAssetsForStats.filter((asset) => asset.type === "CASH").length)} className="ml-1 font-semibold text-[var(--text-primary)]" />
              </p>
              <p className="af-text-muted">
                股票资产 <SensitiveValue value={String(visibleAssetsForStats.filter((asset) => asset.type === "SECURITIES").length)} className="ml-1 font-semibold text-[var(--text-primary)]" />
              </p>
              <p className="af-text-muted">
                总资产 <SensitiveValue value={formatCurrency(totalValue, baseCurrency)} className="ml-1 font-semibold text-[var(--text-primary)]" />
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-auto pr-1">
              <div className="space-y-5">
                {orderedSections.map((section, index) => {
                  const visibleAssets = hideZeroValueAssets
                    ? section.assets.filter((asset) => Math.abs(asset.convertedValue) >= 0.005)
                    : section.assets;
                  const sectionFolderId = section.folder?.id ?? null;
                  const sectionDragId = section.folder?.id ?? ROOT_SECTION_ID;
                  const sectionDropKey = `folder-section:${section.key}`;
                  const sectionIsDropTarget = dragTargetKey === sectionDropKey;

                  return (
                  <div key={section.key}>
                    <div
                      className="mb-1.5 rounded-[20px] border border-transparent px-2 py-2 transition-[background-color,border-color,box-shadow]"
                      onDragOver={(event) => {
                        const payload = readActiveDragPayload(event.dataTransfer.getData("application/json"));
                        if (!payload) return;
                        if (
                          payload.type === "asset" ||
                          (payload.type === "folder" && payload.id !== sectionDragId)
                        ) {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                          setDragTargetKey(sectionDropKey);
                        }
                      }}
                      onDrop={async (event) => {
                        event.preventDefault();
                        const payload = readActiveDragPayload(event.dataTransfer.getData("application/json"));
                        if (!payload) return;
                        if (payload.type === "asset") {
                          await handleAssetDrop(payload, sectionFolderId, null);
                        } else if (payload.type === "folder") {
                          await handleFolderDrop(payload, sectionDragId);
                        }
                        resetDragState();
                      }}
                      style={{
                        background: sectionIsDropTarget ? "var(--card-soft-bg)" : "transparent",
                        borderColor: sectionIsDropTarget
                          ? "color-mix(in srgb, var(--text-primary) 10%, var(--border-color))"
                          : "transparent",
                        boxShadow: sectionIsDropTarget
                          ? "inset 0 0 0 1px color-mix(in srgb, var(--text-primary) 6%, transparent)"
                          : "none",
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div
                            className="relative flex items-center"
                            draggable
                            onDragStart={(event) => {
                              const payload: DragPayload = {
                                type: "folder",
                                id: sectionDragId,
                              };
                              dragPayloadRef.current = payload;
                              event.dataTransfer.setData("application/json", encodeDragPayload(payload));
                              event.dataTransfer.effectAllowed = "move";
                            }}
                            onDragEnd={scheduleDragCleanup}
                            onDoubleClick={() => {
                              toggleFolder(sectionDragId);
                            }}
                            title="双击展开或收起文件夹"
                          >
                            <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                              {section.title}
                            </p>
                          </div>
                          <span className="af-text-muted text-xs">
                            <SensitiveValue value={`${visibleAssets.length} 项`} />
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => toggleFolder(sectionDragId)}
                            className="bg-transparent p-0 text-base font-semibold leading-none transition-colors"
                            style={{ color: "var(--text-secondary)" }}
                            aria-label={collapsedFolderIdSet.has(sectionDragId) ? "展开文件夹" : "收起文件夹"}
                            title={collapsedFolderIdSet.has(sectionDragId) ? "展开文件夹" : "收起文件夹"}
                          >
                            {collapsedFolderIdSet.has(sectionDragId) ? "+" : "−"}
                          </button>
                          {section.folder ? (
                            <button
                              type="button"
                              onClick={() => handleDeleteFolder(section.folder)}
                              className="bg-transparent p-0 text-base leading-none transition-colors"
                              style={{ color: "var(--text-secondary)" }}
                              aria-label={`删除文件夹 ${section.folder.name}`}
                              title={`删除文件夹 ${section.folder.name}`}
                            >
                              ×
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div
                      className={`grid ${hasLoadedCollapsedFoldersPreference ? "transition-[grid-template-rows,opacity] duration-300 ease-out" : ""}`}
                      style={{
                        gridTemplateRows: collapsedFolderIdSet.has(sectionDragId) ? "0fr" : "1fr",
                        opacity: collapsedFolderIdSet.has(sectionDragId) ? 0.55 : 1,
                      }}
                    >
                      <div className="overflow-hidden">
                    {visibleAssets.length ? (
                      <table className="w-full table-fixed text-left text-sm">
                        <colgroup>
                          <col />
                          <col className="w-[5rem]" />
                          <col className="w-[8em]" />
                          <col className="w-[8rem]" />
                          <col className="w-[3.75rem]" />
                        </colgroup>
                        <thead className="af-text-muted">
                          <tr>
                            <th className="pb-4 pr-4 pl-3">名称</th>
                            <th className="pb-4 pr-4 text-center">类型</th>
                            <th className="pb-4 pr-4">当前价值</th>
                            <th className="pb-4 pr-4">最近记录</th>
                            <th className="pb-4 pr-4">记录数</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleAssets.map((asset) => {
                          const selected = asset.id === selectedAssetId;
                          const isDormant = Math.abs(asset.convertedValue) < 0.005;

                          return (
                            <tr
                              key={asset.id}
                              draggable
                              onDragStart={(event) => {
                                const payload: DragPayload = {
                                  type: "asset",
                                  id: asset.id,
                                  folderId: asset.folderId ?? null,
                                };
                                dragPayloadRef.current = payload;
                                event.dataTransfer.setData("application/json", encodeDragPayload(payload));
                                event.dataTransfer.effectAllowed = "move";
                              }}
                              onDragEnd={scheduleDragCleanup}
                              onDragOver={(event) => {
                                const payload = readActiveDragPayload(event.dataTransfer.getData("application/json"));
                                if (!payload || payload.type !== "asset" || payload.id === asset.id) {
                                  return;
                                }
                                event.preventDefault();
                                event.dataTransfer.dropEffect = "move";
                                setDragTargetKey(`asset:${asset.id}`);
                              }}
                              onDragLeave={() => {
                                setDragTargetKey((current) => (current === `asset:${asset.id}` ? null : current));
                              }}
                              onDrop={async (event) => {
                                event.preventDefault();
                                const payload = readActiveDragPayload(event.dataTransfer.getData("application/json"));
                                if (!payload || payload.type !== "asset" || payload.id === asset.id) {
                                  return;
                                }
                                await handleAssetDrop(payload, asset.folderId ?? null, asset.id);
                                resetDragState();
                              }}
                              onClick={() => router.push(buildAssetHrefWithDates(asset.id, rangePreset, startDate, endDate), { scroll: false })}
                              className="cursor-pointer"
                              style={{
                                borderTop: "1px solid var(--border-color)",
                                background:
                                  dragTargetKey === `asset:${asset.id}`
                                    ? "var(--card-soft-bg)"
                                    : selected
                                      ? "color-mix(in srgb, var(--surface-bg) 72%, #9ca3af 28%)"
                                      : "transparent",
                                boxShadow: selected
                                  ? "inset 3px 0 0 color-mix(in srgb, var(--text-primary) 82%, transparent)"
                                  : "none",
                                opacity: isDormant && !selected ? 0.58 : 1,
                              }}
                            >
                                <td className="py-4 pr-4 pl-3">
                                  <p
                                    className="font-semibold"
                                    style={{ color: isDormant ? "var(--text-muted)" : "var(--text-primary)" }}
                                  >
                                    {asset.name}
                                  </p>
                                  <p className="af-text-muted mt-1 text-xs">
                                    {asset.currency}
                                    {asset.symbol ? ` · ${asset.symbol}` : ""}
                                  </p>
                                </td>
                                <td className="py-4 pr-4 text-center">
                                  <span className="af-card-soft inline-flex w-fit whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium">
                                    {typeLabel(asset.type)}
                                  </span>
                                </td>
                                <td className="py-4 pr-4">
                                  <SensitiveValue
                                    value={formatCurrency(asset.convertedValue, asset.convertedCurrency)}
                                    className={isDormant ? "af-text-muted font-semibold" : "font-semibold"}
                                  />
                                  <SensitiveValue
                                    value={formatCurrency(asset.nativeValue, asset.currency)}
                                    className="af-text-muted mt-1 block text-xs"
                                  />
                                </td>
                                <td className="py-4 pr-4">
                                  {asset.latestRecordDate ? (
                                    <SensitiveValue
                                      value={formatStoredCalendarDateLabel(asset.latestRecordDate)}
                                      className="af-text-muted"
                                    />
                                  ) : (
                                    <p className="af-text-muted">暂无</p>
                                  )}
                                </td>
                                <td className="py-4 pr-4">
                                  <SensitiveValue value={String(asset.recordCount)} className="font-medium" />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    ) : (
                      <div
                        className="af-text-muted rounded-[20px] border border-dashed px-4 py-3 text-sm"
                        style={{ borderColor: "var(--border-color)" }}
                      >
                        该文件夹下还没有资产
                      </div>
                    )}
                      </div>
                    </div>
                    {index < orderedSections.length - 1 ? (
                      <div
                        aria-hidden="true"
                        className="mt-2 border-t"
                        style={{ borderColor: "color-mix(in srgb, var(--border-color) 88%, transparent)" }}
                      />
                    ) : null}
                  </div>
                );
                })}
              </div>
            </div>
          </div>

          <div className="xl:h-[43.5rem]">
            <div className="af-card flex min-h-[31rem] h-full flex-col rounded-[32px] p-4 sm:p-6 xl:min-h-0">
              {detail ? (
                <>
                  <div className="flex flex-col gap-5">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-3">
                          <h2 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
                            {detail.asset.name}
                          </h2>
                          <span className="af-card-soft inline-flex w-fit whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium">
                            {typeLabel(detail.asset.type)}
                          </span>
                        </div>
                        {detail.asset.type === "SECURITIES" ? (
                          <p className="af-text-muted mt-3 text-sm">
                            <SensitiveValue
                              value={`${formatShareQuantity(detail.asset.quantity)} 股`}
                            />{" "}
                            · 现价{" "}
                            <SensitiveValue
                              value={formatCurrency(detail.asset.unitPrice ?? 0, detail.asset.currency)}
                              mask={false}
                            />
                            {detail.asset.averageCost != null && detail.asset.averageCost > 0 ? (
                              <>
                                {" "}· 成本{" "}
                                <SensitiveValue
                                  value={formatCurrency(detail.asset.averageCost, detail.asset.currency)}
                                  mask={false}
                                />
                              </>
                            ) : null}
                            {" "}· 总价{" "}
                            <SensitiveValue
                              value={formatCurrency(detail.asset.nativeValue, detail.asset.currency)}
                            />
                            {detail.asset.profitLossPct != null && detail.asset.averageCost != null && detail.asset.averageCost > 0 ? (
                              <>
                                {" "}·{" "}
                                <SensitiveValue
                                  value={formatPercent(detail.asset.profitLossPct)}
                                  className={detail.asset.profitLossPct >= 0 ? "af-text-up" : "af-text-down"}
                                />
                              </>
                            ) : null}
                          </p>
                        ) : (
                          <p className="af-text-muted mt-3 text-sm">
                            当前价值{" "}
                            <SensitiveValue
                              value={formatCurrency(detail.asset.convertedValue, detail.asset.convertedCurrency)}
                            />{" "}
                            · 原币{" "}
                            <SensitiveValue value={formatCurrency(detail.asset.nativeValue, detail.asset.currency)} />
                          </p>
                        )}
                        {detail.asset.notes || detail.asset.type === "SECURITIES" ? (
                          <p className="af-text-muted mt-2 text-sm">
                            {folderLabel(detail.asset.folderId, folders)} ·{" "}
                            {detail.asset.notes || "无备注"}
                            {detail.asset.type === "SECURITIES" && securitySyncStatusLabel(detail) ? (
                              <>
                                {" "}
                                ·{" "}
                                <SensitiveValue
                                  value={securitySyncStatusLabel(detail) ?? "暂无历史价格"}
                                  className="font-medium"
                                />
                              </>
                            ) : null}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex shrink-0 flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setAssetModalState({ mode: "edit", asset: detail.asset })}
                          className="af-button-success whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium"
                        >
                          编辑资产
                        </button>
                        <button
                          type="button"
                          onClick={() => setRecordModalState({ mode: "create", asset: detail.asset })}
                          className="af-button-success whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium"
                        >
                          新增记录
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteAsset(detail.asset)}
                          disabled={deletingAssetId === detail.asset.id}
                          className="af-button-success whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium disabled:opacity-60"
                        >
                          {deletingAssetId === detail.asset.id ? "删除中..." : "删除资产"}
                        </button>
                      </div>
                    </div>

                  </div>

                  <div ref={detailTableRef} className="mt-6 min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
                  <table className="w-full table-fixed text-left text-sm">
                    <colgroup>
                      <col className="w-[7.5rem]" />
                      <col className="w-[8rem]" />
                      <col />
                      <col />
                      <col className="w-[9rem]" />
                      <col className="w-[6.5rem]" />
                    </colgroup>
                    <thead className="af-text-muted">
                      <tr>
                        <th className="pb-4 pr-4 pl-3">记录类型</th>
                        <th className="pb-4 pr-4">日期</th>
                        <th className="pb-4 pr-4">数据</th>
                        <th className="pb-4 pr-4">记录后状态</th>
                        <th className="pb-4 pr-4">备注</th>
                        <th className="pb-4 text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.records.map((record) => {
                        const recordDateKey = record.recordDate.slice(0, 10);
                        const recordSelected = selectedRecordDate === recordDateKey;

                        return (
                        <tr
                          key={record.id}
                          ref={(element) => {
                            if (!recordRowRefs.current[recordDateKey]) {
                              recordRowRefs.current[recordDateKey] = element;
                              return;
                            }

                            if (!element && recordRowRefs.current[recordDateKey] === element) {
                              recordRowRefs.current[recordDateKey] = null;
                            }
                          }}
                          onClick={() => setSelectedRecordDate(recordDateKey)}
                          className="cursor-pointer"
                          style={{
                            borderTop: "1px solid var(--border-color)",
                            background: recordSelected
                              ? "color-mix(in srgb, var(--surface-bg) 72%, #9ca3af 28%)"
                              : "transparent",
                            boxShadow: recordSelected
                              ? "inset 3px 0 0 color-mix(in srgb, var(--text-primary) 82%, transparent)"
                              : "none",
                          }}
                        >
                          <td className="py-4 pr-4 pl-3 align-middle">
                            <span className="af-card-soft inline-flex w-fit whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium">
                              {recordTypeLabel(record.recordType)}
                            </span>
                          </td>
                          <td className="py-4 pr-4 align-middle">
                            <SensitiveValue
                              value={formatStoredCalendarDateLabel(record.recordDate)}
                              className="af-text-muted whitespace-nowrap"
                            />
                          </td>
                          <td className="py-4 pr-4 align-middle">
                            {record.recordType === "VALUE_SNAPSHOT" ? (
                              <SensitiveValue
                                value={formatCurrency(record.amount ?? 0, detail.asset.currency)}
                                className="font-medium"
                              />
                            ) : (
                              <div className="space-y-1">
                                <SensitiveValue
                                  value={
                                    record.recordType === "STOCK_TRADE"
                                      ? `${record.side === "BUY" ? "买入" : "卖出"} ${formatShareQuantity(record.quantity)} 股`
                                      : `持仓 ${formatShareQuantity(record.quantity)} 股`
                                  }
                                  className="af-text-muted whitespace-nowrap tabular-nums"
                                />
                                <p className="af-text-muted whitespace-nowrap tabular-nums">
                                  单价{" "}
                                  <SensitiveValue
                                    value={formatCurrency(record.unitPrice ?? 0, detail.asset.currency)}
                                    mask={false}
                                  />
                                </p>
                              </div>
                            )}
                          </td>
                          <td className="py-4 pr-4 align-middle">
                            {detail.asset.type === "SECURITIES" ? (
                              <div className="space-y-1">
                                <p>
                                  <SensitiveValue
                                    value={`持股 ${formatShareQuantity(record.resultingQuantity)} 股`}
                                    className="af-text-muted whitespace-nowrap tabular-nums"
                                  />
                                </p>
                                <p>
                                  <SensitiveValue
                                    value={formatCurrency(record.resultingConvertedValue, detail.baseCurrency)}
                                    className="af-text-muted whitespace-nowrap tabular-nums"
                                  />
                                </p>
                              </div>
                            ) : (
                              <SensitiveValue
                                value={formatCurrency(record.resultingConvertedValue, detail.baseCurrency)}
                                className="af-text-muted whitespace-nowrap tabular-nums"
                              />
                            )}
                          </td>
                          <td className="py-4 pr-4 align-middle">
                            <p
                              className="af-text-muted overflow-hidden break-words"
                              title={record.notes || "无备注"}
                              style={{
                                display: "-webkit-box",
                                WebkitBoxOrient: "vertical",
                                WebkitLineClamp: 2,
                              }}
                            >
                              {record.notes || "无备注"}
                            </p>
                          </td>
                          <td className="py-4 text-right align-middle">
                            <div className="ml-auto inline-flex w-fit flex-nowrap justify-end gap-2">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setRecordModalState({ mode: "edit", asset: detail.asset, record });
                                }}
                                aria-label="修改记录"
                                title="修改记录"
                                className="af-button-info h-9 w-9 rounded-full p-0"
                              >
                                <PencilIcon />
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleDeleteRecord(detail.asset.id, record.id);
                                }}
                                disabled={deletingRecordId === record.id}
                                aria-label={deletingRecordId === record.id ? "删除中" : "删除记录"}
                                title={deletingRecordId === record.id ? "删除中" : "删除记录"}
                                className="af-button-info h-9 w-9 rounded-full p-0 disabled:opacity-60"
                              >
                                {deletingRecordId === record.id ? (
                                  <span className="text-[10px] font-semibold">...</span>
                                ) : (
                                  <CloseIcon />
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );})}
                    </tbody>
                  </table>
                  </div>
                </>
              ) : (
                <div className="flex min-h-[340px] items-center justify-center rounded-[28px] border border-dashed" style={{ borderColor: "var(--border-color)" }}>
                  <div className="text-center">
                    <p className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>还没有可查看的资产</p>
                    <p className="af-text-muted mt-2 text-sm">先创建一个资产，系统会自动打开它的时间记录面板。</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

        {assetModalState ? (
          <AssetModal
            state={assetModalState}
            folders={folders}
            onClose={() => setAssetModalState(null)}
            onSaved={(assetId) => {
            setAssetModalState(null);
            router.push(buildAssetHrefWithDates(assetId, rangePreset, startDate, endDate));
            router.refresh();
          }}
        />
      ) : null}

      {folderModalState ? (
        <FolderModal
          onClose={() => setFolderModalState(null)}
          onSaved={() => {
            setFolderModalState(null);
            router.refresh();
          }}
        />
      ) : null}

      {recordModalState ? (
        <RecordModal
          state={recordModalState}
          onClose={() => setRecordModalState(null)}
          onSaved={() => {
            setRecordModalState(null);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
