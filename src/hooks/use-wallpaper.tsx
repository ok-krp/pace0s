import { useEffect } from "react";
import { useLocalState } from "@/lib/storage";

/**
 * Wallpaper system — drives `--wallpaper` and adaptive `--glass-tint`
 * on <html>, so every glass surface inherits a subtle wash of the current
 * background (Apple Control Center behavior).
 */
export type WallpaperPreset = {
  id: string;
  label: string;
  /** CSS `background` value applied to `.pace-bg` via `--wallpaper` */
  css: string;
  cssDark?: string;
  /** rgb triplet for adaptive glass tint (light mode) */
  tint: string;
  tintDark?: string;
  /** subtle preview swatch */
  swatch: string;
};

export const WALLPAPERS: WallpaperPreset[] = [
  {
    id: "aurora",
    label: "Aurora",
    css: `
      radial-gradient(1200px 700px at -10% -10%, oklch(0.96 0.06 60 / 0.55), transparent 60%),
      radial-gradient(1000px 700px at 110% 10%, oklch(0.94 0.05 240 / 0.5), transparent 60%),
      radial-gradient(900px 800px at 50% 120%, oklch(0.95 0.04 200 / 0.4), transparent 60%),
      linear-gradient(135deg, oklch(0.985 0.012 60) 0%, oklch(0.99 0.005 247) 50%, oklch(0.97 0.02 240) 100%)`,
    cssDark: `
      radial-gradient(1200px 700px at -10% -10%, oklch(0.28 0.08 250 / 0.6), transparent 60%),
      radial-gradient(1000px 700px at 110% 10%, oklch(0.22 0.09 260 / 0.55), transparent 60%),
      radial-gradient(900px 800px at 50% 120%, oklch(0.2 0.06 240 / 0.5), transparent 60%),
      linear-gradient(135deg, oklch(0.13 0.02 260) 0%, oklch(0.14 0.03 255) 50%, oklch(0.16 0.05 245) 100%)`,
    tint: "255 255 255",
    tintDark: "22 26 40",
    swatch: "linear-gradient(135deg, #fef3c7, #dbeafe, #a5f3fc)",
  },
  {
    id: "ocean",
    label: "Océan",
    css: `
      radial-gradient(1200px 700px at 20% -10%, oklch(0.88 0.08 220 / 0.6), transparent 60%),
      radial-gradient(1000px 700px at 100% 40%, oklch(0.85 0.1 200 / 0.55), transparent 60%),
      linear-gradient(160deg, oklch(0.96 0.02 220) 0%, oklch(0.9 0.05 210) 100%)`,
    cssDark: `
      radial-gradient(1200px 700px at 20% -10%, oklch(0.32 0.12 220 / 0.7), transparent 60%),
      radial-gradient(1000px 700px at 100% 40%, oklch(0.26 0.1 200 / 0.6), transparent 60%),
      linear-gradient(160deg, oklch(0.11 0.03 220) 0%, oklch(0.14 0.06 210) 100%)`,
    tint: "220 234 245",
    tintDark: "18 32 48",
    swatch: "linear-gradient(135deg, #bae6fd, #7dd3fc, #0ea5e9)",
  },
  {
    id: "sunset",
    label: "Coucher",
    css: `
      radial-gradient(1000px 700px at -10% 10%, oklch(0.9 0.14 30 / 0.6), transparent 60%),
      radial-gradient(1000px 700px at 100% 100%, oklch(0.85 0.16 350 / 0.55), transparent 60%),
      linear-gradient(160deg, oklch(0.97 0.03 40) 0%, oklch(0.92 0.08 20) 100%)`,
    cssDark: `
      radial-gradient(1000px 700px at -10% 10%, oklch(0.35 0.16 30 / 0.7), transparent 60%),
      radial-gradient(1000px 700px at 100% 100%, oklch(0.3 0.16 350 / 0.6), transparent 60%),
      linear-gradient(160deg, oklch(0.14 0.04 20) 0%, oklch(0.16 0.06 350) 100%)`,
    tint: "252 232 220",
    tintDark: "40 22 32",
    swatch: "linear-gradient(135deg, #fed7aa, #fda4af, #f43f5e)",
  },
  {
    id: "forest",
    label: "Forêt",
    css: `
      radial-gradient(1200px 700px at 20% -10%, oklch(0.9 0.08 155 / 0.6), transparent 60%),
      radial-gradient(1000px 700px at 100% 60%, oklch(0.86 0.1 170 / 0.55), transparent 60%),
      linear-gradient(160deg, oklch(0.97 0.02 155) 0%, oklch(0.92 0.05 160) 100%)`,
    cssDark: `
      radial-gradient(1200px 700px at 20% -10%, oklch(0.32 0.1 155 / 0.7), transparent 60%),
      radial-gradient(1000px 700px at 100% 60%, oklch(0.26 0.09 170 / 0.6), transparent 60%),
      linear-gradient(160deg, oklch(0.12 0.03 155) 0%, oklch(0.14 0.05 165) 100%)`,
    tint: "224 240 224",
    tintDark: "18 34 26",
    swatch: "linear-gradient(135deg, #bbf7d0, #86efac, #059669)",
  },
  {
    id: "graphite",
    label: "Graphite",
    css: `
      radial-gradient(1200px 700px at 30% 0%, oklch(0.95 0.005 260 / 0.7), transparent 60%),
      linear-gradient(160deg, oklch(0.97 0.003 260) 0%, oklch(0.92 0.006 250) 100%)`,
    cssDark: `
      radial-gradient(1200px 700px at 30% 0%, oklch(0.22 0.01 260 / 0.7), transparent 60%),
      linear-gradient(160deg, oklch(0.1 0.005 260) 0%, oklch(0.13 0.008 255) 100%)`,
    tint: "244 244 246",
    tintDark: "20 22 26",
    swatch: "linear-gradient(135deg, #e5e7eb, #9ca3af, #374151)",
  },
  {
    id: "orchid",
    label: "Orchidée",
    css: `
      radial-gradient(1000px 700px at 10% 0%, oklch(0.9 0.1 300 / 0.6), transparent 60%),
      radial-gradient(1000px 700px at 90% 100%, oklch(0.88 0.12 280 / 0.55), transparent 60%),
      linear-gradient(160deg, oklch(0.97 0.03 290) 0%, oklch(0.93 0.06 295) 100%)`,
    cssDark: `
      radial-gradient(1000px 700px at 10% 0%, oklch(0.32 0.14 300 / 0.7), transparent 60%),
      radial-gradient(1000px 700px at 90% 100%, oklch(0.28 0.14 280 / 0.6), transparent 60%),
      linear-gradient(160deg, oklch(0.13 0.05 290) 0%, oklch(0.15 0.07 295) 100%)`,
    tint: "240 226 246",
    tintDark: "32 22 40",
    swatch: "linear-gradient(135deg, #f5d0fe, #d8b4fe, #a855f7)",
  },
];

type CustomWallpaper = { kind: "custom"; dataUrl: string };
type WallpaperChoice = { id: string } | CustomWallpaper;

const KEY = "lt.wallpaper";
const DEFAULT: WallpaperChoice = { id: "aurora" };

export function useWallpaper() {
  const [choice, setChoice] = useLocalState<WallpaperChoice>(KEY, DEFAULT);

  useEffect(() => {
    applyWallpaper(choice);
  }, [choice]);

  return {
    choice,
    presets: WALLPAPERS,
    set: (id: string) => setChoice({ id }),
    setCustom: (dataUrl: string) => setChoice({ kind: "custom", dataUrl }),
    reset: () => setChoice(DEFAULT),
  };
}

/** Apply wallpaper + adaptive glass tint to <html>. Safe to call on mount. */
export function applyWallpaper(choice: WallpaperChoice) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const isDark = root.classList.contains("dark");

  if ("kind" in choice && choice.kind === "custom") {
    root.style.setProperty(
      "--wallpaper",
      `linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.15)), url("${choice.dataUrl}") center/cover no-repeat`,
    );
    // Neutral tint for custom photos + a slightly stronger floor so text stays
    // readable on busy imagery (accessibility guard).
    root.style.setProperty("--glass-tint", isDark ? "10 14 22" : "255 255 255");
    root.style.setProperty("--glass-tint-strength", isDark ? "0.34" : "0.2");
    return;
  }

  const preset = WALLPAPERS.find((w) => w.id === (choice as { id: string }).id) ?? WALLPAPERS[0];
  const css = (isDark && preset.cssDark) ? preset.cssDark : preset.css;
  const tint = (isDark && preset.tintDark) ? preset.tintDark : preset.tint;
  root.style.setProperty("--wallpaper", css.trim());
  root.style.setProperty("--glass-tint", tint);
  root.style.setProperty("--glass-tint-strength", isDark ? "0.26" : "0.13");

}

/** Read choice synchronously from storage (for early paint in root). */
export function readWallpaperChoice(): WallpaperChoice {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    return JSON.parse(raw) as WallpaperChoice;
  } catch {
    return DEFAULT;
  }
}
