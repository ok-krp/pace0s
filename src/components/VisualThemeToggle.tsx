import { useEffect, useState } from "react";
import { Activity, Sparkles, Layers3 } from "lucide-react";
import { applyVisualTheme, readVisualTheme, type VisualTheme } from "@/lib/visual-theme";

function getVisualTheme(): VisualTheme {
  return readVisualTheme();
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
