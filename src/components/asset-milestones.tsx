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

function formatElapsedCalendarDays(days: number) {
  if (days <= 0) {
    return "0 天";
  }

  const years = Math.floor(days / 365);
  const remainingDays = days % 365;
  const months = Math.floor(remainingDays / 30);
  const calendarDays = remainingDays % 30;
  const parts: string[] = [];

  if (years > 0) {
    parts.push(`${years} 年`);
    if (months > 0) {
      parts.push(`${months} 个月`);
    }

    return parts.join(" ");
  }
  if (months > 0) {
    parts.push(`${months} 个月`);
  }
  if (calendarDays > 0 || !parts.length) {
    parts.push(`${calendarDays} 天`);
  }

  return parts.join(" ");
}

function formatElapsedDayCount(days: number) {
  return `${Math.max(0, days)} 天`;
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

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

function milestoneStatusLabel(milestone: AssetMilestoneItem) {
  if (milestone.reachedDate) return "已达成";
  if (milestone.isNext) return "下一个目标";
  return "未达成";
}

function calculateSegmentProgress(current: number, start: number, end: number) {
  const range = end - start;
  if (range <= 0) {
    return current >= end ? 100 : 0;
  }

  return clampPercent(((current - start) / range) * 100);
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
  const reachedCount = milestones.filter((milestone) => milestone.reachedDate).length;
  const nextMilestone = milestones.find((milestone) => milestone.isNext);
  const currentAssetValue = nextMilestone
    ? Math.max(0, nextMilestone.target - nextMilestone.remaining)
    : undefined;
  const nextMilestoneIndex = nextMilestone ? milestones.indexOf(nextMilestone) : -1;
  const previousTarget = nextMilestoneIndex > 0 ? milestones[nextMilestoneIndex - 1]?.target ?? 0 : 0;
  const segmentProgressPct = nextMilestone && currentAssetValue !== undefined
    ? calculateSegmentProgress(currentAssetValue, previousTarget, nextMilestone.target)
    : 100;

  return (
    <section className="af-card overflow-hidden rounded-[34px] p-6">
      <header
        className="mb-6 border-b pb-6"
        style={{ borderColor: "color-mix(in srgb, var(--border-color) 55%, transparent)" }}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="af-text-muted text-[11px] font-semibold uppercase tracking-[0.28em]">资产里程碑</p>
            <h3 className="mt-2 text-2xl font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
              首次达到目标
            </h3>
          </div>
          <div className="flex shrink-0 items-center">
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className="af-button-secondary rounded-full px-4 py-2 text-sm font-semibold"
            >
              {expanded ? "收起" : "修改里程碑"}
            </button>
          </div>
        </div>

        {milestones.length ? (
          <div className="mt-6 max-w-xl">
            <p className="af-text-muted text-xs font-semibold">当前进度</p>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-xl font-semibold tabular-nums tracking-tight" style={{ color: "var(--text-primary)" }}>
                {reachedCount} / {milestones.length}
              </span>
              <span className="text-xl font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
                已达成
              </span>
            </div>
            <p className="af-text-muted mt-2 text-xs">
              {nextMilestone ? (
                <>
                  下一目标{" "}
                  <SensitiveValue
                    value={formatCompactCurrency(nextMilestone.target, currency)}
                    className="inline tabular-nums"
                  />{" "}
                  · 还差{" "}
                  <SensitiveValue
                    value={formatCompactCurrency(nextMilestone.remaining, currency)}
                    className="inline tabular-nums"
                  />
                </>
              ) : (
                "全部目标已达成"
              )}
            </p>
          </div>
        ) : null}
      </header>

      {milestones.length ? (
        <div className="relative">
          <div
            className="absolute bottom-5 left-4 top-5 w-px sm:left-5"
            style={{ background: "color-mix(in srgb, var(--border-color) 75%, transparent)" }}
          />
          {milestones.map((milestone) => {
            const reached = Boolean(milestone.reachedDate);
            const statusLabel = milestoneStatusLabel(milestone);
            const reachedNodeColor = "color-mix(in srgb, var(--text-secondary) 42%, white)";
            const nodeColor = reached
              ? reachedNodeColor
              : milestone.isNext
                ? "var(--text-secondary)"
                : "var(--border-color)";

            return (
              <div
                key={milestone.target}
                className="relative grid gap-3 border-b py-5 pl-12 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,0.42fr)] sm:items-start sm:gap-5 sm:pl-16"
                style={{ borderColor: "color-mix(in srgb, var(--border-color) 45%, transparent)" }}
              >
                <div
                  className="absolute left-[0.38rem] top-6 z-10 flex h-6 w-6 items-center justify-center rounded-full sm:left-2"
                  style={{
                    border: `2px solid ${nodeColor}`,
                    background: reached ? reachedNodeColor : "var(--surface-bg)",
                    boxShadow: reached || milestone.isNext
                      ? "0 0 0 6px color-mix(in srgb, var(--text-secondary) 10%, transparent), 0 10px 24px color-mix(in srgb, var(--text-secondary) 13%, transparent)"
                      : undefined,
                  }}
                >
                  {reached ? (
                    <span className="text-xs font-black leading-none" style={{ color: "var(--surface-bg)" }}>
                      ✓
                    </span>
                  ) : null}
                </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <SensitiveValue
                      value={formatCompactCurrency(milestone.target, currency)}
                      className={`block text-base font-semibold tracking-tight tabular-nums sm:text-lg ${reached || milestone.isNext ? "" : "af-text-muted"}`}
                    />
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                      style={{
                        background: reached
                          ? "color-mix(in srgb, var(--up-text) 14%, transparent)"
                          : "var(--surface-bg-muted)",
                        color: reached ? "var(--up-text)" : "var(--text-secondary)",
                      }}
                    >
                      {statusLabel}
                    </span>
                  </div>

                  {reached ? (
                    <p className="af-text-muted mt-2 text-[11px] sm:text-xs">
                      总用时 {formatElapsedCalendarDays(milestone.elapsedDays ?? 0)}
                      <span className="mx-2">·</span>
                      阶段 {formatElapsedDayCount(milestone.stageDays ?? 0)}
                    </p>
                  ) : null}
                </div>

                <div className="min-w-0 sm:text-right">
                  {milestone.reachedDate ? (
                    <p className="text-xs font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                      {formatCalendarDateLabel(
                        milestone.reachedDate,
                        settings.timeZone,
                        settings.dateFormatPreference,
                      )}
                    </p>
                  ) : (
                    <SensitiveValue
                      value={
                        milestone.isNext && currentAssetValue !== undefined
                          ? `${formatCurrency(currentAssetValue, currency)} (${milestone.progressPct.toFixed(0)}%)`
                          : `还差 ${formatCompactCurrency(milestone.remaining, currency)}`
                      }
                      className={`block text-xs font-semibold tabular-nums ${milestone.isNext ? "text-[var(--text-primary)]" : "af-text-muted"}`}
                    />
                  )}
                </div>

                {milestone.isNext && currentAssetValue !== undefined ? (
                  <div className="sm:col-span-2">
                    <div className="h-2.5 overflow-hidden rounded-full" style={{ background: "var(--surface-bg-muted)" }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${segmentProgressPct}%`,
                          background: "var(--up-text)",
                          boxShadow: "12px 0 24px color-mix(in srgb, var(--up-text) 24%, transparent)",
                        }}
                      />
                    </div>
                    <div className="af-text-muted mt-3 flex items-center justify-between text-[11px] tabular-nums">
                      <SensitiveValue value={formatCompactCurrency(previousTarget, currency)} />
                      <SensitiveValue value={formatCompactCurrency(milestone.target, currency)} />
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
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
