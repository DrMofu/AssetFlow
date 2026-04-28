"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";

import { AppPreferencesProvider, useAppPreferences } from "@/components/app-preferences";
import { ToastProvider } from "@/components/toast";
import type { UserSettings } from "@/lib/types";
import devInfo from "@/dev-info.json";

const navItems = [
  { href: "/", label: "总览" },
  { href: "/assets", label: "资产" },
  { href: "/settings", label: "设置" },
];

function EyeIcon({ closed }: { closed: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M2 12s3.8-6 10-6 10 6 10 6-3.8 6-10 6S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3.2" />
      {closed ? <path d="M4 4l16 16" /> : null}
    </svg>
  );
}

function CurrencyIcon({ currency }: { currency: "USD" | "CNY" }) {
  return <span className="text-base font-semibold leading-none">{currency === "USD" ? "$" : "¥"}</span>;
}

function ThemeIcon({ dark }: { dark: boolean }) {
  return dark ? (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5M12 19.5V22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2 12h2.5M19.5 12H22M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
    </svg>
  );
}

function QuickActions() {
  const {
    settings,
    privacyMode,
    isUpdating,
    togglePrivacyMode,
    toggleDisplayCurrency,
    toggleThemePreference,
  } = useAppPreferences();
  const themeButtonClass =
    settings.themePreference === "dark"
      ? "af-toolbar-button-theme-dark"
      : "af-toolbar-button-theme-light";

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={togglePrivacyMode}
        className={clsx("af-toolbar-button", themeButtonClass)}
        aria-label={privacyMode ? "关闭隐私遮罩" : "开启隐私遮罩"}
        title={privacyMode ? "关闭隐私遮罩" : "开启隐私遮罩"}
      >
        <EyeIcon closed={privacyMode} />
      </button>
      <button
        type="button"
        onClick={toggleDisplayCurrency}
        disabled={isUpdating}
        className={clsx("af-toolbar-button", themeButtonClass)}
        aria-label="切换显示币种"
        title="切换显示币种"
      >
        <CurrencyIcon currency={settings.displayCurrency} />
      </button>
      <button
        type="button"
        onClick={toggleThemePreference}
        disabled={isUpdating}
        className={clsx("af-toolbar-button", themeButtonClass)}
        aria-label="切换主题"
        title="切换主题"
      >
        <ThemeIcon dark={settings.themePreference === "dark"} />
      </button>
    </div>
  );
}

function AppShellFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen text-[var(--text-primary)]" style={{ background: "var(--page-bg)" }}>
      <header
        className="sticky top-0 z-40 border-b"
        style={{
          borderColor: "var(--border-color)",
          background: "color-mix(in srgb, var(--page-bg) 94%, transparent)",
          backdropFilter: "blur(18px)",
        }}
      >
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex items-center gap-6">
            <h1 className="text-xl font-semibold tracking-tight">
              AssetFlow
              <span className="ml-2 text-xs font-normal opacity-40">v{devInfo.version}</span>
            </h1>
            <nav className="flex flex-wrap gap-2">
              {navItems.map((item) => {
                const isActive =
                  item.href === "/" ? pathname === item.href : pathname.startsWith(item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={clsx(
                      "px-4 py-2 text-sm font-medium transition",
                      isActive
                        ? "af-nav-item-active"
                        : "af-nav-item hover:opacity-90",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <QuickActions />
        </div>
      </header>

      <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col px-4 pb-6 pt-5 sm:px-6 lg:px-8">
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}

export function AppShell({
  children,
  settings,
}: {
  children: React.ReactNode;
  settings: UserSettings;
}) {
  return (
    <AppPreferencesProvider initialSettings={settings}>
      <ToastProvider>
        <AppShellFrame>{children}</AppShellFrame>
      </ToastProvider>
    </AppPreferencesProvider>
  );
}
