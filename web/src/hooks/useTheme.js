import { useCallback, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "theme";
const THEME_LIGHT = "light";
const THEME_DARK = "dark";
const THEME_SYSTEM = "system";

function getSystemTheme() {
  if (typeof window === "undefined") return THEME_DARK;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? THEME_LIGHT : THEME_DARK;
}

function readStoredTheme() {
  if (typeof window === "undefined") return THEME_SYSTEM;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === THEME_LIGHT || stored === THEME_DARK) return stored;
  return THEME_SYSTEM;
}

export default function useTheme() {
  const [sourceTheme, setSourceTheme] = useState(() => readStoredTheme());
  const resolvedTheme = useMemo(() => {
    if (sourceTheme === THEME_SYSTEM) return getSystemTheme();
    return sourceTheme;
  }, [sourceTheme]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    document.documentElement.setAttribute("data-theme", resolvedTheme);
    document.documentElement.style.colorScheme = resolvedTheme;

    if (sourceTheme === THEME_SYSTEM) {
      window.localStorage.removeItem(STORAGE_KEY);
      document.documentElement.setAttribute("data-theme-source", THEME_SYSTEM);
    } else {
      window.localStorage.setItem(STORAGE_KEY, sourceTheme);
      document.documentElement.setAttribute("data-theme-source", "manual");
    }
  }, [resolvedTheme, sourceTheme]);

  useEffect(() => {
    if (typeof window === "undefined" || sourceTheme !== THEME_SYSTEM) return undefined;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");
    const onSystemThemeChange = () => {
      setSourceTheme(THEME_SYSTEM);
    };

    mediaQuery.addEventListener("change", onSystemThemeChange);
    return () => mediaQuery.removeEventListener("change", onSystemThemeChange);
  }, [sourceTheme]);

  const toggleTheme = useCallback(() => {
    setSourceTheme((current) => {
      const currentTheme = current === THEME_SYSTEM ? getSystemTheme() : current;
      return currentTheme === THEME_LIGHT ? THEME_DARK : THEME_LIGHT;
    });
  }, []);

  return {
    sourceTheme,
    theme: resolvedTheme,
    isSystemTheme: sourceTheme === THEME_SYSTEM,
    setThemeSource: setSourceTheme,
    toggleTheme,
  };
}
