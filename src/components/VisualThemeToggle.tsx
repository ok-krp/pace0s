import { useEffect, useState } from "react";
import { Activity, Sparkles, Layers3 } from "lucide-react";

const VISUAL_THEME_KEY = "pace.visual-theme";
const DARK_MODE_KEY = "pace.dark";

type VisualTheme = "default" | "signal" | "glass";
function getVisualTheme(): VisualTheme {
  if (typeof document === "undefined") return "default";
  const value = document.documentElement.dataset.visualTheme;
  return value === "signal" || value === "glass" ? value : "default";
}

function applyVisualTheme(theme: VisualTheme) {
  const root = document.documentElement;
  if (theme === "default") delete root.dataset.visualTheme;
  else root.dataset.visualTheme = theme;
  root.classList.toggle("dark", theme !== "default" || localStorage.getItem(DARK_MODE_KEY) === "1");
  localStorage.setItem(VISUAL_THEME_KEY, theme);
  const themeColor = document.querySelector('meta[name="theme-color"]');
  themeColor?.setAttribute("content", theme === "glass" ? "#070b12" : theme === "signal" ? "#07100b" : root.classList.contains("dark") ? "#1f242c" : "#f8fafc");
  window.dispatchEvent(new CustomEvent("pace.visual-theme.change", { detail: { theme, signal: theme === "signal" } }));
}

export function VisualThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<VisualTheme>("default");

  useEffect(() => {
    setTheme(getVisualTheme());
  }, []);

  const toggle = () => {
    const current = getVisualTheme();
    const next: VisualTheme = current === "default" ? "signal" : current === "signal" ? "glass" : "default";
    applyVisualTheme(next);
    setTheme(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Thème actuel : ${theme === "default" ? "Pace" : theme === "signal" ? "Signal" : "Glass"}. Cliquer pour changer`}
      aria-pressed={theme !== "default"}
      title={`Thème : ${theme === "default" ? "Pace" : theme === "signal" ? "Signal" : "Glass"}`}
      className={[
        "signal-theme-control inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium transition-[background,border-color,color,box-shadow] duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
        compact ? "size-9 justify-center px-0" : "",
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        className={[
          "grid size-5 shrink-0 place-items-center rounded-md border border-current/15",
          theme !== "default" ? "signal-theme-dot text-primary" : "text-muted-foreground",
        ].join(" ")}
      >
        {theme === "signal" ? <Activity className="size-3.5" /> : theme === "glass" ? <Layers3 className="size-3.5" /> : <Sparkles className="size-3.5" />}
      </span>
      {!compact && <span>{theme === "signal" ? "Signal" : theme === "glass" ? "Glass" : "Style"}</span>}
    </button>
  );
}
