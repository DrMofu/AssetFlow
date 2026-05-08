"use client";

import { useEffect, useState } from "react";

import { SensitiveValue, useAppPreferences } from "@/components/app-preferences";
import { useToast } from "@/components/toast";
import { ASSET_MILESTONE_TARGET_LIMIT } from "@/lib/constants";
import type { CurrencyCode } from "@/lib/types";
import { formatCalendarDateLabel, formatCompactCurrency, formatCurrency } from "@/lib/utils";

export type AssetMilestoneItem = {
  target: number;
  reachedDate?: string;
  elapsedDays?: number;
  stageDays?: number;
  remaining: number;
  progressPct: number;
  isNext: boolean;
};

type DurationDisplayMode = "calendar" | "days";

function formatElapsedDays(days: number, mode: DurationDisplayMode) {
  if (mode === "days") {
    return `${Math.max(0, days)} 天`;
  }
  if (days <= 0) {
    return "0 天";
  }
  if (days < 365) {
    return `${days} 天`;
  }

  const years = Math.floor(days / 365);
  const remainingDays = days % 365;
  if (remainingDays < 30) {
    return `${years} 年`;
  }

  return `${years} 年 ${Math.floor(remainingDays / 30)} 个月`;
}

function normalizeTargets(targets: number[]) {
  return [...new Set(
    targets
      .map((target) => Math.round(Number(target) * 100) / 100)
      .filter((target) => Number.isFinite(target) && target > 0),
  )]
    .sort((left, right) => left - right)
    .slice(0, ASSET_MILESTONE_TARGET_LIMIT);
}

export function AssetMilestones({
  milestones,
  targets,
  defaultTargets,
  currency,
}: {
  milestones: AssetMilestoneItem[];
  targets: number[];
  defaultTargets: number[];
  currency: CurrencyCode;
}) {
  const { settings, updatePreferences, isUpdating } = useAppPreferences();
  const { showToast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [draftAmount, setDraftAmount] = useState("");
  const [localTargets, setLocalTargets] = useState(targets);
  const [saving, setSaving] = useState(false);
  const [durationDisplayMode, setDurationDisplayMode] = useState<DurationDisplayMode>("calendar");

  useEffect(() => {
    setLocalTargets(targets);
  }, [targets]);

  async function saveTargets(nextTargets: number[], message: string) {
    const normalized = normalizeTargets(nextTargets);
    if (!normalized.length) {
      return;
    }

    setLocalTargets(normalized);
    setSaving(true);

    try {
      await updatePreferences({
        assetMilestoneTargets: {
          ...settings.assetMilestoneTargets,
          [currency]: normalized,
        },
      });
      showToast(message, { tone: "success" });
    } catch (error) {
      setLocalTargets(targets);
      showToast(error instanceof Error ? error.message : "保存失败", { tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function handleAdd() {
    const nextTarget = Number(draftAmount);
    if (!Number.isFinite(nextTarget) || nextTarget <= 0) {
      showToast("请输入大于 0 的金额", { tone: "error" });
      return;
    }
    if (localTargets.length >= ASSET_MILESTONE_TARGET_LIMIT) {
      showToast(`最多显示 ${ASSET_MILESTONE_TARGET_LIMIT} 个里程碑`, { tone: "error" });
      return;
    }

    setDraftAmount("");
    await saveTargets([...localTargets, nextTarget], "里程碑金额已添加");
  }

  async function handleRemove(target: number) {
    if (localTargets.length <= 1) {
      showToast("至少保留一个里程碑金额", { tone: "error" });
      return;
    }

    await saveTargets(localTargets.filter((item) => item !== target), "里程碑金额已删除");
  }

  async function handleRestoreDefaults() {
    await saveTargets(defaultTargets, "已恢复默认里程碑");
  }

  const busy = saving || isUpdating;
  const durationModeLabel = durationDisplayMode === "calendar" ? "按天数显示" : "按年月显示";

  return (
    <section className="af-card rounded-[34px] p-6">
      <header className="mb-5 flex items-start justify-between gap-4 border-b pb-5" style={{ borderColor: "color-mix(in srgb, var(--border-color) 55%, transparent)" }}>
        <div>
          <p className="af-text-muted text-[11px] font-semibold uppercase tracking-[0.28em]">资产里程碑</p>
          <h3 className="mt-2 text-2xl font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
            首次达到目标
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setDurationDisplayMode((current) => (current === "calendar" ? "days" : "calendar"))}
            className="af-button-secondary inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold tabular-nums"
            aria-label={durationModeLabel}
            title={durationModeLabel}
          >
            {durationDisplayMode === "calendar" ? "天" : "年"}
          </button>
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="af-button-secondary rounded-full px-4 py-2 text-sm font-semibold"
          >
            {expanded ? "收起" : "修改里程碑"}
          </button>
        </div>
      </header>

      {milestones.length ? (
        <div className="grid gap-2">
          {milestones.map((milestone) => (
            <div
              key={milestone.target}
              className="af-card-soft grid grid-cols-[minmax(7rem,0.8fr)_minmax(0,1fr)] items-center gap-4 rounded-[20px] px-4 py-3"
              style={{
                boxShadow: milestone.isNext
                  ? "0 0 0 2px color-mix(in srgb, var(--text-primary) 16%, transparent)"
                  : undefined,
              }}
            >
              <div className="min-w-0">
                <SensitiveValue
                  value={formatCompactCurrency(milestone.target, currency)}
                  className="block text-lg font-semibold tabular-nums"
                />
                <p className="af-text-muted mt-0.5 text-xs">
                  {milestone.reachedDate ? "已达成" : milestone.isNext ? "下一个目标" : "未达成"}
                </p>
              </div>

              <div className="min-w-0 text-right">
                {milestone.reachedDate ? (
                  <>
                    <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      {formatCalendarDateLabel(
                        milestone.reachedDate,
                        settings.timeZone,
                        settings.dateFormatPreference,
                      )}
                    </p>
                    <p className="af-text-muted mt-0.5 text-xs">
                      总用时 {formatElapsedDays(milestone.elapsedDays ?? 0, durationDisplayMode)}
                    </p>
                    <p className="af-text-muted mt-0.5 text-xs">
                      阶段 {formatElapsedDays(milestone.stageDays ?? 0, durationDisplayMode)}
                    </p>
                  </>
                ) : (
                  <>
                    <SensitiveValue
                      value={`还差 ${formatCompactCurrency(milestone.remaining, currency)}`}
                      className="block text-sm font-semibold tabular-nums"
                    />
                    <p className="af-text-muted mt-0.5 text-xs">{milestone.progressPct.toFixed(0)}%</p>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="af-card-soft rounded-[20px] px-4 py-4">
          <p className="af-text-muted text-sm">当前还没有可计算的资产历史。</p>
        </div>
      )}

      {expanded ? (
        <div className="mt-4 grid gap-3 rounded-[22px] border p-4" style={{ borderColor: "var(--border-color)" }}>
          <div className="flex flex-wrap gap-2">
            {localTargets.map((target) => (
              <button
                key={target}
                type="button"
                onClick={() => void handleRemove(target)}
                disabled={busy}
                className="af-button-secondary rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
                title="点击删除"
              >
                {formatCurrency(target, currency)} ×
              </button>
            ))}
          </div>

          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              void handleAdd();
            }}
          >
            <input
              type="number"
              min={1}
              step={1}
              value={draftAmount}
              onChange={(event) => setDraftAmount(event.target.value)}
              placeholder="添加金额"
              className="af-input min-w-0 flex-1 rounded-2xl px-4 py-2.5 text-sm"
            />
            <button
              type="submit"
              disabled={busy}
              className="af-button-primary rounded-full px-5 py-2.5 text-sm font-semibold disabled:opacity-60"
            >
              添加
            </button>
            <button
              type="button"
              onClick={() => void handleRestoreDefaults()}
              disabled={busy}
              className="af-button-secondary rounded-full px-5 py-2.5 text-sm font-semibold disabled:opacity-60"
            >
              恢复默认
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
