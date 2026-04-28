"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useTransition,
} from "react";

import type { CurrencyCode, ThemePreference, UserSettings } from "@/lib/types";

type AppPreferencesContextValue = {
  settings: UserSettings;
  privacyMode: boolean;
  isUpdating: boolean;
  togglePrivacyMode: () => void;
  toggleDisplayCurrency: () => void;
  toggleThemePreference: () => void;
  updatePreferences: (
    patch: Partial<Pick<UserSettings, "timeZone" | "colorScheme">>,
  ) => Promise<void>;
};

const AppPreferencesContext = createContext<AppPreferencesContextValue | null>(null);

const PRIVACY_STORAGE_KEY = "assetflow:privacy-mode";

function postSettings(settings: UserSettings) {
  return fetch("/api/settings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      displayCurrency: settings.displayCurrency,
      themePreference: settings.themePreference,
      historyTopAssetCount: settings.historyTopAssetCount,
      timeZone: settings.timeZone,
      colorScheme: settings.colorScheme,
    }),
  });
}

function looksLikeDateText(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  const monthNamePattern =
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\b/i;
  const numericDatePattern =
    /^\d{4}-\d{1,2}-\d{1,2}$|^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?$|^\d{2}\/\d{1,2}\/\d{1,2}$/;
  const dateRangeParts = normalized.split(/\s+-\s+/);

  return dateRangeParts.every((part) => {
    const candidate = part.trim();
    return monthNamePattern.test(candidate) || numericDatePattern.test(candidate);
  });
}

export function maskDisplayValue(value: string) {
  if (looksLikeDateText(value)) {
    return value;
  }

  return value.replace(
    /([+\-]?\s*[$¥€£])?\s*[+\-]?\d[\d,]*(?:\.\d+)?(?:\s*[a-zA-Z%]+)?/g,
    (match, currencySymbol: string | undefined) => {
      const preservedCurrency = (currencySymbol ?? "").replace(/[+\-\s]/g, "");
      return `${preservedCurrency}***`;
    },
  );
}

export function AppPreferencesProvider({
  children,
  initialSettings,
}: {
  children: React.ReactNode;
  initialSettings: UserSettings;
}) {
  const router = useRouter();
  const [isUpdating, startTransition] = useTransition();
  const [settings, setSettings] = useState(initialSettings);
  const [privacyMode, setPrivacyMode] = useState(false);

  useEffect(() => {
    setSettings(initialSettings);
  }, [initialSettings]);

  useEffect(() => {
    const storedValue = window.localStorage.getItem(PRIVACY_STORAGE_KEY);
    setPrivacyMode(storedValue === "true");
  }, []);

  async function updateSettings(
    patch: Partial<
      Pick<
        UserSettings,
        "displayCurrency" | "themePreference" | "historyTopAssetCount" | "timeZone" | "colorScheme"
      >
    >,
  ) {
    const previousSettings = settings;
    const nextSettings = { ...settings, ...patch };

    setSettings(nextSettings);
    document.documentElement.dataset.theme = nextSettings.themePreference;
    document.documentElement.dataset.colorScheme = nextSettings.colorScheme;

    try {
      const response = await postSettings(nextSettings);
      if (!response.ok) {
        throw new Error("Failed to update settings");
      }
      startTransition(() => {
        router.refresh();
      });
    } catch {
      setSettings(previousSettings);
      document.documentElement.dataset.theme = previousSettings.themePreference;
      document.documentElement.dataset.colorScheme = previousSettings.colorScheme;
    }
  }

  function togglePrivacyMode() {
    setPrivacyMode((current) => {
      const nextValue = !current;
      window.localStorage.setItem(PRIVACY_STORAGE_KEY, String(nextValue));
      return nextValue;
    });
  }

  function toggleDisplayCurrency() {
    const nextCurrency: CurrencyCode = settings.displayCurrency === "USD" ? "CNY" : "USD";
    void updateSettings({ displayCurrency: nextCurrency });
  }

  function toggleThemePreference() {
    const nextTheme: ThemePreference = settings.themePreference === "light" ? "dark" : "light";
    void updateSettings({ themePreference: nextTheme });
  }

  async function updatePreferences(patch: Partial<Pick<UserSettings, "timeZone" | "colorScheme">>) {
    await updateSettings(patch);
  }

  const value = {
    settings,
    privacyMode,
    isUpdating,
    togglePrivacyMode,
    toggleDisplayCurrency,
    toggleThemePreference,
    updatePreferences,
  };

  return <AppPreferencesContext.Provider value={value}>{children}</AppPreferencesContext.Provider>;
}

export function useAppPreferences() {
  const context = useContext(AppPreferencesContext);

  if (!context) {
    throw new Error("useAppPreferences must be used within AppPreferencesProvider");
  }

  return context;
}

export function SensitiveValue({
  value,
  className,
  mask = true,
}: {
  value: string;
  className?: string;
  mask?: boolean;
}) {
  const { privacyMode } = useAppPreferences();

  return <span className={className}>{privacyMode && mask ? maskDisplayValue(value) : value}</span>;
}
