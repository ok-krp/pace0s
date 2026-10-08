const VISUAL_THEME_KEY = "pace.visual-theme";
const DARK_MODE_KEY = "pace.dark";

export type VisualTheme = "default" | "signal" | "glass";

export function readVisualTheme(): VisualTheme {
  if (typeof document === "undefined") return "default";
  const value = document.documentElement.dataset.visualTheme;
  return value === "signal" || value === "glass" ? value : "default";
}

export function readDarkMode(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

function syncThemeColor(theme: VisualTheme, dark: boolean) {
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute(
      "content",
      theme === "glass"
        ? "#070b12"
        : theme === "signal"
          ? dark
            ? "#090b0e"
            : "#f6f7f9"
          : dark
            ? "#1f242c"
            : "#f8fafc",
    );
}

/**
 * Single runtime source of truth for visual theme state.
 *
 * Signal Dark is exactly:
 *   html[data-visual-theme="signal"].dark
 */
export function applyVisualTheme(theme: VisualTheme, requestedDark?: boolean) {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  const storedDark = localStorage.getItem(DARK_MODE_KEY) === "1";
  // Signal is a dark-only visual system. Its activation must never fall back to
  // the light palette, even when the previous Pace theme was light.
  const dark = theme === "signal" || theme === "glass" ? true : requestedDark ?? storedDark;

  if (theme === "default") delete root.dataset.visualTheme;
  else root.dataset.visualTheme = theme;

  root.classList.toggle("dark", dark);
  localStorage.setItem(VISUAL_THEME_KEY, theme);
  localStorage.setItem(DARK_MODE_KEY, dark ? "1" : "0");

  const signalDark = theme === "signal" && dark;
  if (signalDark) {
    root.style.setProperty("--background", "#090b0e");
    root.style.setProperty("--wallpaper", "#090b0e");
  } else {
    root.style.removeProperty("--background");
    root.style.removeProperty("--wallpaper");
  }

  syncThemeColor(theme, dark);
  window.dispatchEvent(
    new CustomEvent("pace.visual-theme.change", {
      detail: { theme, dark, signal: theme === "signal", signalDark },
    }),
  );
}

export function setDarkMode(dark: boolean) {
  applyVisualTheme(readVisualTheme(), dark);
}
