"use client";

import { useTheme } from "next-themes";
import { useEffect } from "react";

/**
 * Keeps <meta name="theme-color"> in step with the chosen theme. The server emits
 * one tag per prefers-color-scheme (right for "system"); an explicit Light/Dark
 * choice overrides both. The colour is read from the --bg token, not hard-coded.
 */
export function ThemeColorSync() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    if (!resolvedTheme) return;
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    if (!bg) return;
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => (m.content = bg));
  }, [resolvedTheme]);
  return null;
}
