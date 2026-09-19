import { useEffect, useState } from "react";
import { Activity, Sparkles } from "lucide-react";

const VISUAL_THEME_KEY = "pace.visual-theme";
const DARK_MODE_KEY = "pace.dark";

function isSignalTheme() {
  return typeof document !== "undefined" && document.documentElement.dataset.visualTheme === "signal";
}

function applyVisualTheme(signal: boolean) {
  const root = document.documentElement;

  if (signal) {
    root.dataset.visualTheme = "signal";
    root.classList.add("dark");
  } else {
    delete root.dataset.visualTheme;
    root.classList.toggle("dark", localStorage.getItem(DARK_MODE_KEY) === "1");
  }

  const themeColor = document.querySelector('meta[name="theme-color"]');
  themeColor?.setAttribute("content", signal ? "#07100b" : root.classList.contains("dark") ? "#1f242c" : "#f8fafc");
  window.dispatchEvent(new CustomEvent("pace.visual-theme.change", { detail: { signal } }));
}

export function VisualThemeToggle({ compact = false }: { compact?: boolean }) {
  const [signal, setSignal] = useState(false);

  useEffect(() => {
    setSignal(isSignalTheme());
  }, []);

  const toggle = () => {
    const next = !isSignalTheme();
    localStorage.setItem(VISUAL_THEME_KEY, next ? "signal" : "default");
    applyVisualTheme(next);
    setSignal(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={signal ? "Revenir au style Pace" : "Activer le style Signal"}
      aria-pressed={signal}
      title={signal ? "Revenir au style Pace" : "Activer le style Signal"}
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
          signal ? "signal-theme-dot text-primary" : "text-muted-foreground",
        ].join(" ")}
      >
        {signal ? <Activity className="size-3.5" /> : <Sparkles className="size-3.5" />}
      </span>
      {!compact && <span>{signal ? "Signal" : "Style"}</span>}
    </button>
  );
}
