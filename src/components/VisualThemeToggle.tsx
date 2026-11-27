import { useEffect, useState } from "react";
import { Activity, Sparkles, Layers3 } from "lucide-react";
import { persistLocalPreference, readLocalPreference } from "@/lib/storage";
import { isFollowingSharedAppearance } from "@/hooks/use-shared-appearance";

const VISUAL_THEME_KEY = "pace.visual-theme";
const DARK_MODE_KEY = "pace.dark";

type VisualTheme = "default" | "signal" | "glass";
function getVisualTheme(): VisualTheme {
  if (typeof document === "undefined") return "default";
  const value = document.documentElement.dataset.visualTheme;
  return value === "signal" || value === "glass" ? value : "default";
}

function applyVisualTheme(theme: VisualTheme, persist = true) {
  const root = document.documentElement;
  if (theme === "default") delete root.dataset.visualTheme;
  else root.dataset.visualTheme = theme;
  // Signal et Liquid suivent le mode sombre choisi par l'utilisateur.
  const dark = theme === "glass" || readLocalPreference<string>(DARK_MODE_KEY, "0") === "1";
  root.classList.toggle("dark", dark);
  if (persist) persistLocalPreference(VISUAL_THEME_KEY, theme);
  const themeColor = document.querySelector('meta[name="theme-color"]');
  themeColor?.setAttribute("content", theme === "glass" ? (dark ? "#070a14" : "#e9e7ee") : theme === "signal" ? dark ? "#000000" : "#f6f7f9" : dark ? "#1f242c" : "#f8fafc");
  window.dispatchEvent(new CustomEvent("pace.visual-theme.change", { detail: { theme, signal: theme === "signal" } }));
}

export function VisualThemeToggle({ compact = false, disabled = false }: { compact?: boolean; disabled?: boolean }) {
  const [theme, setTheme] = useState<VisualTheme>("default");
  const [following, setFollowing] = useState(() => isFollowingSharedAppearance());

  useEffect(() => {
    setTheme(getVisualTheme());
    const onRemotePreference = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      if (key && key !== VISUAL_THEME_KEY && key !== DARK_MODE_KEY) return;
      if (isFollowingSharedAppearance()) return;
      const stored = readLocalPreference<VisualTheme>(VISUAL_THEME_KEY, "default");
      applyVisualTheme(stored, false);
      setTheme(stored === "signal" || stored === "glass" ? stored : "default");
    };
    const onEffectiveTheme = (event: Event) => {
      const value = (event as CustomEvent<{ theme?: string }>).detail?.theme;
      setTheme(value === "signal" || value === "glass" ? value : "default");
    };
    const onSharedAppearance = (event: Event) => {
      setFollowing((event as CustomEvent<{ active?: boolean }>).detail?.active === true);
    };
    window.addEventListener("pace.remote.write", onRemotePreference);
    window.addEventListener("pace.visual-theme.change", onEffectiveTheme);
    window.addEventListener("pace.shared-appearance.change", onSharedAppearance);
    return () => {
      window.removeEventListener("pace.remote.write", onRemotePreference);
      window.removeEventListener("pace.visual-theme.change", onEffectiveTheme);
      window.removeEventListener("pace.shared-appearance.change", onSharedAppearance);
    };
  }, []);

  const toggle = () => {
    if (disabled || following) return;
    const current = getVisualTheme();
    const next: VisualTheme = current === "default" ? "signal" : current === "signal" ? "glass" : "default";
    applyVisualTheme(next);
    setTheme(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled || following}
      aria-label={`Thème actuel : ${theme === "default" ? "Pace" : theme === "signal" ? "Signal" : "Liquid"}. Cliquer pour changer`}
      aria-pressed={theme !== "default"}
      title={following ? "Apparence suivie depuis un autre compte" : `Thème : ${theme === "default" ? "Pace" : theme === "signal" ? "Signal" : "Liquid"}`}
      className={[
        "signal-theme-control inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium transition-[background,border-color,color,box-shadow] duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
        compact ? "size-9 justify-center px-0" : "",
        disabled || following ? "cursor-not-allowed opacity-60" : "",
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
      {!compact && <span>{theme === "signal" ? "Signal" : theme === "glass" ? "Liquid" : "Style"}</span>}
    </button>
  );
}
