"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type ToastTone = "success" | "error" | "info";

type Toast = {
  id: string;
  message: string;
  tone: ToastTone;
  leaving: boolean;
};

type ShowToastOptions = {
  tone?: ToastTone;
  durationMs?: number;
};

type ToastContextValue = {
  showToast: (message: string, options?: ShowToastOptions) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const VISIBLE_MS_DEFAULT = 3200;
const LEAVE_ANIMATION_MS = 260;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const clearTimer = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const remove = useCallback(
    (id: string) => {
      clearTimer(id);
      setToasts((current) => current.filter((toast) => toast.id !== id));
    },
    [clearTimer],
  );

  const dismiss = useCallback(
    (id: string) => {
      clearTimer(id);
      setToasts((current) =>
        current.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)),
      );
      const removeTimer = setTimeout(() => remove(id), LEAVE_ANIMATION_MS);
      timersRef.current.set(id, removeTimer);
    },
    [clearTimer, remove],
  );

  const showToast = useCallback<ToastContextValue["showToast"]>(
    (message, options) => {
      const tone = options?.tone ?? "info";
      const visibleMs = options?.durationMs ?? VISIBLE_MS_DEFAULT;
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      setToasts((current) => [...current, { id, message, tone, leaving: false }]);
      const leaveTimer = setTimeout(() => dismiss(id), visibleMs);
      timersRef.current.set(id, leaveTimer);
    },
    [dismiss],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed inset-x-0 bottom-6 z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-8"
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const palette = toneStyles(toast.tone);

  return (
    <div
      role="status"
      onClick={onDismiss}
      className="pointer-events-auto cursor-pointer rounded-2xl border px-4 py-2.5 text-sm font-medium shadow-lg backdrop-blur"
      style={{
        ...palette,
        animation: toast.leaving
          ? `af-toast-out ${LEAVE_ANIMATION_MS}ms ease-in forwards`
          : "af-toast-in 220ms ease-out",
        maxWidth: "min(28rem, calc(100vw - 2rem))",
      }}
    >
      <div className="flex items-center gap-2.5">
        <ToneGlyph tone={toast.tone} />
        <span className="leading-snug">{toast.message}</span>
      </div>
    </div>
  );
}

function ToneGlyph({ tone }: { tone: ToastTone }) {
  if (tone === "success") {
    return (
      <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2">
        <path d="m4.5 10.5 3.5 3.5L16 6.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (tone === "error") {
    return (
      <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2">
        <circle cx="10" cy="10" r="7.5" />
        <path d="M10 6.5v4.5M10 13.5v.01" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2">
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 9v4.5M10 6.5v.01" strokeLinecap="round" />
    </svg>
  );
}

function toneStyles(tone: ToastTone): React.CSSProperties {
  if (tone === "success") {
    return {
      background: "color-mix(in srgb, #10b981 16%, var(--surface-bg) 84%)",
      borderColor: "color-mix(in srgb, #10b981 45%, transparent)",
      color: "color-mix(in srgb, #047857 80%, var(--text-primary) 20%)",
    };
  }
  if (tone === "error") {
    return {
      background: "color-mix(in srgb, #ef4444 14%, var(--surface-bg) 86%)",
      borderColor: "color-mix(in srgb, #ef4444 45%, transparent)",
      color: "color-mix(in srgb, #b91c1c 80%, var(--text-primary) 20%)",
    };
  }
  return {
    background: "color-mix(in srgb, var(--text-primary) 8%, var(--surface-bg) 92%)",
    borderColor: "var(--border-color)",
    color: "var(--text-primary)",
  };
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}
