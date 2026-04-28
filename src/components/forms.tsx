"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useAppPreferences } from "@/components/app-preferences";
import { useToast } from "@/components/toast";
import type { ArchiveOverview, ColorScheme, DataSyncOverview, SyncStatusSnapshot } from "@/lib/types";
import { formatCalendarDateLabel, formatDateTimeLabel } from "@/lib/utils";

async function postJson(url: string, payload: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(result.error ?? "Request failed");
  }

  return response.json();
}

export function MarketDataKeyForm({ initialApiKey }: { initialApiKey: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [apiKey, setApiKey] = useState(initialApiKey);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);

    try {
      await postJson("/api/system/env/alpha-vantage", {
        apiKey,
      });
      showToast(
        apiKey.trim() ? "Alpha Vantage API key 已保存到本地 .env" : "已清空 Alpha Vantage API key",
        { tone: "success" },
      );
      router.refresh();
    } catch (submitError) {
      showToast(submitError instanceof Error ? submitError.message : "保存失败", { tone: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="af-card grid gap-5 rounded-[32px] p-6 md:p-7"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
    >
      <p className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
        API Key 设置
      </p>

      <label className="grid gap-2 text-sm af-text-muted">
        股票价格抓取 Alpha Vantage API key
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="输入 key；留空可清除"
            autoComplete="off"
            spellCheck={false}
            className="af-input min-w-0 flex-1 rounded-2xl px-4 py-3"
          />
          <button
            type="submit"
            disabled={submitting}
            className="af-button-primary w-full rounded-full px-5 py-3 text-sm font-semibold disabled:opacity-60 sm:w-fit sm:shrink-0"
          >
            {submitting ? "保存中..." : "保存 key"}
          </button>
        </div>
      </label>
    </form>
  );
}

function formatCoverageDate(value: string | undefined, timeZone: string) {
  if (!value) return "暂无";
  return formatCalendarDateLabel(value, timeZone);
}

function taskStateLabel(state: SyncStatusSnapshot["tasks"][number]["state"]) {
  if (state === "queued") return "排队中";
  if (state === "running") return "同步中";
  if (state === "retrying") return "等待重试";
  if (state === "succeeded") return "已完成";
  return "出错";
}

function DataSyncOverviewCards({
  overview,
  timeZone,
}: {
  overview: DataSyncOverview;
  timeZone: string;
}) {
  return (
    <div className="grid gap-4">
      <div className="af-card-soft rounded-[24px] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              股票历史价格
            </p>
            <p className="af-text-muted mt-1 text-xs">
              {overview.securities.source ?? "Alpha Vantage"} · 已启用 {overview.securities.autoEnabledCount} / {overview.securities.trackedCount}
            </p>
          </div>
          <span className="af-button-secondary rounded-full px-3 py-1 text-xs font-medium">
            已同步 {overview.securities.syncedCount} 项
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="af-text-muted text-xs">最新覆盖日期</p>
            <p className="mt-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {formatCoverageDate(overview.securities.latestCoverageEnd, timeZone)}
            </p>
          </div>
          <div>
            <p className="af-text-muted text-xs">未启用自动行情</p>
            <p className="mt-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {overview.securities.trackedCount - overview.securities.autoEnabledCount} 项
            </p>
          </div>
        </div>
      </div>

      <div className="af-card-soft rounded-[24px] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              美元 / 人民币汇率
            </p>
            <p className="af-text-muted mt-1 text-xs">
              {overview.fx.source ?? "FRED DEXCHUS"}
            </p>
          </div>
          <span className="af-button-secondary rounded-full px-3 py-1 text-xs font-medium">
            {overview.fx.state === "synced" ? "已同步" : "待同步"}
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="af-text-muted text-xs">覆盖区间起点</p>
            <p className="mt-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {formatCoverageDate(overview.fx.coverageStart, timeZone)}
            </p>
          </div>
          <div>
            <p className="af-text-muted text-xs">已同步到</p>
            <p className="mt-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {formatCoverageDate(overview.fx.syncedThrough, timeZone)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DataSyncStatusForm({
  overview: initialOverview,
  initialQueue,
}: {
  overview: DataSyncOverview;
  initialQueue: SyncStatusSnapshot;
}) {
  const { settings } = useAppPreferences();
  const timeZone = settings.timeZone;
  const [overview, setOverview] = useState(initialOverview);
  const [queue, setQueue] = useState(initialQueue);
  const [pollError, setPollError] = useState<string | null>(null);

  useEffect(() => {
    setOverview(initialOverview);
  }, [initialOverview]);

  useEffect(() => {
    setQueue(initialQueue);
  }, [initialQueue]);

  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const response = await fetch("/api/system/sync-status", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("无法获取同步状态");
        }

        const payload = (await response.json()) as {
          overview: DataSyncOverview;
          queue: SyncStatusSnapshot;
        };

        if (!active) return;
        setOverview(payload.overview);
        setQueue(payload.queue);
        setPollError(null);
      } catch (error) {
        if (!active) return;
        setPollError(error instanceof Error ? error.message : "无法获取同步状态");
      }
    }

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, 3000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const activeTasks = queue.tasks.filter((task) => task.state !== "succeeded");

  return (
    <div className="af-card grid gap-4 rounded-[32px] p-6 md:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
          数据同步状态
        </p>
        <span className="af-button-secondary rounded-full px-3 py-1 text-xs font-medium">
          排队 {queue.queueLength} · 运行中 {queue.runningCount}
        </span>
      </div>

      <DataSyncOverviewCards overview={overview} timeZone={timeZone} />

      <div className="af-card-soft rounded-[24px] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            队列任务
          </p>
          <span className="af-button-secondary rounded-full px-3 py-1 text-xs font-medium">
            {queue.updatedAt ? `更新于 ${formatDateTimeLabel(queue.updatedAt, timeZone)}` : "等待中"}
          </span>
        </div>

        {pollError ? <p className="mt-4 text-sm text-rose-600">{pollError}</p> : null}
        {!pollError && queue.lastError ? <p className="mt-4 text-sm text-rose-600">{queue.lastError}</p> : null}

        <div className="mt-4 max-h-[460px] space-y-3 overflow-y-auto pr-1">
          {activeTasks.length ? (
            activeTasks.map((task) => (
              <div key={task.key} className="rounded-[18px] border px-4 py-3" style={{ borderColor: "var(--border-color)" }}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      {task.label}
                    </p>
                    <p className="af-text-muted mt-1 text-xs">
                      第 {task.attempts} 次尝试 · {taskStateLabel(task.state)}
                    </p>
                  </div>
                  {task.nextRetryAt ? (
                    <span className="af-text-muted text-xs">重试时间 {formatDateTimeLabel(task.nextRetryAt, timeZone)}</span>
                  ) : null}
                </div>
                {task.errorMessage ? (
                  <p className="mt-2 text-xs text-rose-600">{task.errorMessage}</p>
                ) : null}
              </div>
            ))
          ) : (
            <p className="af-text-muted text-sm">当前没有正在排队或运行中的同步任务。</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function StorageActionsForm() {
  const router = useRouter();
  const { settings } = useAppPreferences();
  const { showToast } = useToast();
  const timeZone = settings.timeZone;
  const [submitting, setSubmitting] = useState<"create-empty" | "create-duplicate" | string | null>(null);
  const [archiveName, setArchiveName] = useState("");
  const [archives, setArchives] = useState<ArchiveOverview["archives"]>([]);
  const [activeArchiveId, setActiveArchiveId] = useState("");

  useEffect(() => {
    let active = true;

    async function loadArchives() {
      try {
        const response = await fetch("/api/storage/archives", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("无法获取存档列表");
        }
        const payload = (await response.json()) as ArchiveOverview;
        if (!active) return;
        setArchives(payload.archives);
        setActiveArchiveId(payload.activeArchiveId);
      } catch (loadError) {
        if (!active) return;
        showToast(loadError instanceof Error ? loadError.message : "无法获取存档列表", { tone: "error" });
      }
    }

    void loadArchives();
    return () => {
      active = false;
    };
  }, [showToast]);

  async function refreshArchives() {
    const response = await fetch("/api/storage/archives", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("无法获取存档列表");
    }
    const payload = (await response.json()) as ArchiveOverview;
    setArchives(payload.archives);
    setActiveArchiveId(payload.activeArchiveId);
  }

  async function handleCreate(mode: "empty" | "duplicate") {
    setSubmitting(mode === "empty" ? "create-empty" : "create-duplicate");

    try {
      await postJson("/api/storage/archives", {
        name: archiveName.trim() || undefined,
        mode,
      });
      setArchiveName("");
      showToast(mode === "empty" ? "空白存档已创建" : "已复制当前存档", { tone: "success" });
      await refreshArchives();
      router.refresh();
    } catch (submitError) {
      showToast(submitError instanceof Error ? submitError.message : "创建失败", { tone: "error" });
    } finally {
      setSubmitting(null);
    }
  }

  async function handleSwitch(archiveId: string) {
    setSubmitting(`switch:${archiveId}`);

    try {
      await postJson(`/api/storage/archives/${archiveId}/switch`, {});
      showToast("已切换到所选存档", { tone: "success" });
      await refreshArchives();
      router.refresh();
    } catch (submitError) {
      showToast(submitError instanceof Error ? submitError.message : "切换失败", { tone: "error" });
    } finally {
      setSubmitting(null);
    }
  }

  async function handleDelete(archiveId: string) {
    setSubmitting(`delete:${archiveId}`);

    try {
      const response = await fetch(`/api/storage/archives/${archiveId}`, { method: "DELETE" });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(result.error ?? "删除失败");
      }
      showToast("存档已删除", { tone: "success" });
      await refreshArchives();
      router.refresh();
    } catch (submitError) {
      showToast(submitError instanceof Error ? submitError.message : "删除失败", { tone: "error" });
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="af-card grid gap-4 rounded-[32px] p-6 md:p-7 xl:sticky xl:top-24">
      <p className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
        存档管理
      </p>
      <div className="grid gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="text"
            value={archiveName}
            onChange={(event) => setArchiveName(event.target.value)}
            placeholder="新存档名称（可选）"
            className="af-input min-w-0 flex-1 rounded-2xl px-4 py-3"
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handleCreate("empty")}
            disabled={submitting !== null}
            className="af-button-primary rounded-full px-5 py-3 text-sm font-semibold disabled:opacity-60"
          >
            {submitting === "create-empty" ? "创建中..." : "从零新建存档"}
          </button>
          <button
            type="button"
            onClick={() => void handleCreate("duplicate")}
            disabled={submitting !== null}
            className="af-button-secondary rounded-full px-5 py-3 text-sm font-semibold disabled:opacity-60"
          >
            {submitting === "create-duplicate" ? "复制中..." : "复制当前存档"}
          </button>
        </div>

        <div className="grid gap-3">
          {archives.map((archive) => {
            const isActive = archive.id === activeArchiveId;
            const isOnlyArchive = archives.length === 1;
            return (
              <div
                key={archive.id}
                className="af-card-soft flex flex-col gap-3 rounded-[24px] p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      {archive.name}
                    </p>
                    <p className="af-text-muted mt-1 text-xs">
                      创建于 {formatDateTimeLabel(archive.createdAt, timeZone)}
                    </p>
                  </div>
                  {isActive ? (
                    <span className="af-button-secondary rounded-full px-3 py-1 text-xs font-medium">
                      当前存档
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-3">
                  {!isActive ? (
                    <button
                      type="button"
                      onClick={() => void handleSwitch(archive.id)}
                      disabled={submitting !== null}
                      className="af-button-primary rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-60"
                    >
                      {submitting === `switch:${archive.id}` ? "切换中..." : "切换到此存档"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void handleDelete(archive.id)}
                    disabled={submitting !== null || isOnlyArchive}
                    className="af-button-secondary rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-60"
                  >
                    {submitting === `delete:${archive.id}` ? "删除中..." : "删除存档"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const COMMON_TIME_ZONES = [
  "UTC",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Asia/Kolkata",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Australia/Sydney",
  "Pacific/Auckland",
] as const;

function describeSystemTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

export function PreferencesForm() {
  const { settings, updatePreferences, isUpdating } = useAppPreferences();
  const { showToast } = useToast();
  const [timeZone, setTimeZone] = useState(settings.timeZone);
  const [colorScheme, setColorScheme] = useState<ColorScheme>(settings.colorScheme);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setTimeZone(settings.timeZone);
    setColorScheme(settings.colorScheme);
  }, [settings.timeZone, settings.colorScheme]);

  const systemTimeZone = useMemo(() => describeSystemTimeZone(), []);

  // 自定义时区不在常用列表里时单独列出，避免被静默丢弃
  const customExtraTimeZone = useMemo(() => {
    if (!timeZone) return null;
    if ((COMMON_TIME_ZONES as readonly string[]).includes(timeZone)) return null;
    return timeZone;
  }, [timeZone]);

  async function handleSubmit() {
    setSubmitting(true);

    try {
      await updatePreferences({ timeZone, colorScheme });
      showToast("自定义设置已保存", { tone: "success" });
    } catch (submitError) {
      showToast(submitError instanceof Error ? submitError.message : "保存失败", { tone: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  const isDirty = timeZone !== settings.timeZone || colorScheme !== settings.colorScheme;

  return (
    <form
      className="af-card grid gap-5 rounded-[32px] p-6 md:p-7"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
    >
      <p className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
        自定义设置
      </p>

      <label className="grid gap-2 text-sm af-text-muted">
        时区
        <select
          value={timeZone}
          onChange={(event) => setTimeZone(event.target.value)}
          className="af-input rounded-2xl px-4 py-3"
        >
          <option value="">跟随系统（{systemTimeZone}）</option>
          {customExtraTimeZone ? (
            <option value={customExtraTimeZone}>{customExtraTimeZone}</option>
          ) : null}
          {COMMON_TIME_ZONES.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
        <span className="text-xs af-text-muted">
          影响日期与时间的显示格式。留"跟随系统"会按当前设备的时区显示。
        </span>
      </label>

      <fieldset className="grid gap-2 text-sm af-text-muted">
        <legend className="mb-1">涨跌颜色</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label
            className="af-card-soft flex cursor-pointer items-start gap-3 rounded-[20px] px-4 py-3"
            style={{
              boxShadow:
                colorScheme === "green-up"
                  ? "0 0 0 2px color-mix(in srgb, var(--up-text) 70%, transparent)"
                  : undefined,
            }}
          >
            <input
              type="radio"
              name="colorScheme"
              value="green-up"
              checked={colorScheme === "green-up"}
              onChange={() => setColorScheme("green-up")}
              className="mt-1"
            />
            <span className="grid gap-1">
              <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                绿涨红跌
              </span>
              <span className="text-xs">
                <span
                  className="rounded-full px-2 py-0.5 font-semibold"
                  style={{ background: "#e8f9ee", color: "#008d35" }}
                >
                  +1.23%
                </span>
                <span
                  className="ml-2 rounded-full px-2 py-0.5 font-semibold"
                  style={{ background: "#fff1f2", color: "#be123c" }}
                >
                  -1.23%
                </span>
              </span>
            </span>
          </label>
          <label
            className="af-card-soft flex cursor-pointer items-start gap-3 rounded-[20px] px-4 py-3"
            style={{
              boxShadow:
                colorScheme === "red-up"
                  ? "0 0 0 2px color-mix(in srgb, var(--up-text) 70%, transparent)"
                  : undefined,
            }}
          >
            <input
              type="radio"
              name="colorScheme"
              value="red-up"
              checked={colorScheme === "red-up"}
              onChange={() => setColorScheme("red-up")}
              className="mt-1"
            />
            <span className="grid gap-1">
              <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                红涨绿跌
              </span>
              <span className="text-xs">
                <span
                  className="rounded-full px-2 py-0.5 font-semibold"
                  style={{ background: "#fff1f2", color: "#be123c" }}
                >
                  +1.23%
                </span>
                <span
                  className="ml-2 rounded-full px-2 py-0.5 font-semibold"
                  style={{ background: "#e8f9ee", color: "#008d35" }}
                >
                  -1.23%
                </span>
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      <div className="flex items-center justify-end gap-3">
        <button
          type="submit"
          disabled={submitting || isUpdating || !isDirty}
          className="af-button-primary w-fit rounded-full px-5 py-3 text-sm font-semibold disabled:opacity-60"
        >
          {submitting ? "保存中..." : "保存设置"}
        </button>
      </div>
    </form>
  );
}
