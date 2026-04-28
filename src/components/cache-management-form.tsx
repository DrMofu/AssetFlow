"use client";

import { useState } from "react";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "无缓存";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function CacheManagementForm({
  initialStats,
}: {
  initialStats: { sizeBytes: number; computedAt: string | null };
}) {
  const [stats, setStats] = useState(initialStats);
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRebuild() {
    setRebuilding(true);
    setError(null);
    try {
      const res = await fetch("/api/cache/rebuild", { method: "POST", cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "重建失败");
      }
      const body = (await res.json()) as { sizeBytes: number; computedAt: string | null };
      setStats({ sizeBytes: body.sizeBytes, computedAt: body.computedAt });
    } catch (err) {
      setError(err instanceof Error ? err.message : "重建失败");
    } finally {
      setRebuilding(false);
    }
  }

  return (
    <div className="af-card grid gap-5 rounded-[32px] p-6 md:p-7">
      <p className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
        计算缓存
      </p>

      <p className="af-text-muted text-sm">
        缓存存储每日各资产的折算估值，加速首页折线图、月度收益网格、日历分析等组件的渲染。
        每次修改数据或同步行情后缓存会自动失效，下次加载页面时重建。
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div className="af-card-soft rounded-[18px] px-4 py-3">
          <p className="af-text-muted text-[11px] font-semibold uppercase tracking-[0.18em]">缓存大小</p>
          <p className="mt-1 text-base font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
            {formatBytes(stats.sizeBytes)}
          </p>
        </div>
        <div className="af-card-soft rounded-[18px] px-4 py-3">
          <p className="af-text-muted text-[11px] font-semibold uppercase tracking-[0.18em]">最后重建</p>
          <p className="mt-1 text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            {stats.computedAt ?? "—"}
          </p>
        </div>
      </div>

      {error ? (
        <p className="af-text-down text-sm">{error}</p>
      ) : null}

      <button
        type="button"
        disabled={rebuilding}
        onClick={() => void handleRebuild()}
        className="af-button-primary rounded-[14px] px-5 py-2.5 text-sm font-semibold disabled:opacity-50"
      >
        {rebuilding ? "重建中…" : "立即重建缓存"}
      </button>
    </div>
  );
}
