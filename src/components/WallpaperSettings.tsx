import { useRef } from "react";
import { Check, Upload, RotateCcw, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWallpaper } from "@/hooks/use-wallpaper";
import { toast } from "sonner";
import { isCustomWallpaperFileAllowed } from "@/lib/wallpaper-cache";

export function WallpaperSettings() {
  const { choice, presets, set, setCustom, reset } = useWallpaper();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isCustom = "kind" in choice && choice.kind === "custom";
  const activeId = "id" in choice ? choice.id : null;

  const onFile = async (f: File | null) => {
    if (!f) return;
    if (!isCustomWallpaperFileAllowed(f)) {
      toast.error("Image invalide ou trop lourde (maximum 20 Mo).");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    try {
      await setCustom(f);
      toast.success("Fond enregistré dans le cache de cet appareil.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible d’enregistrer le fond localement.");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="rounded-2xl glass-card p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="glass-icon size-10">
          <ImageIcon className="size-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium">Fond d'écran</div>
          <div className="text-xs text-muted-foreground">Image conservée uniquement dans le cache de cet appareil (20 Mo maximum).</div>
        </div>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
        {presets.map((p) => {
          const active = activeId === p.id && !isCustom;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => { void set(p.id).catch((error) => toast.error(error instanceof Error ? error.message : "Impossible d’enregistrer ce fond.")); }}
              aria-pressed={active}
              className={`group relative aspect-square rounded-2xl overflow-hidden ring-1 ring-black/5 dark:ring-white/10 transition-transform hover:scale-[1.03] active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60`}
              style={{ background: p.swatch }}
              title={p.label}
            >
              {active && (
                <span className="absolute inset-0 grid place-items-center bg-black/25">
                  <span className="glass-icon size-7"><Check className="size-3.5" /></span>
                </span>
              )}
              <span className="absolute bottom-1 left-1.5 right-1.5 text-[10px] font-medium text-white/95 drop-shadow">
                {p.label}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 pt-3 border-t border-border">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={() => inputRef.current?.click()}
          className="rounded-xl"
        >
          <Upload className="size-3.5 mr-1.5" />
          {isCustom ? "Remplacer" : "Importer une image"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { void reset().catch((error) => toast.error(error instanceof Error ? error.message : "Impossible de réinitialiser le fond.")); }} className="rounded-xl">
          <RotateCcw className="size-3.5 mr-1.5" />
          Défaut
        </Button>
        {isCustom && (
          <span className="text-[11px] text-muted-foreground ml-auto">Fond personnalisé actif</span>
        )}
      </div>
    </div>
  );
}
