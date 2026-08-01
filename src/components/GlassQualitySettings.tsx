import { memo } from "react";
import { Gauge, Check } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useGlassQuality, type GlassQuality } from "@/hooks/use-glass-quality";

function GlassQualitySettingsImpl() {
  const { quality, set, auto, setAuto, levels } = useGlassQuality();

  return (
    <div className="rounded-2xl glass-card p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="glass-icon size-10">
          <Gauge className="size-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium">Qualité Glass</div>
          <div className="text-xs text-muted-foreground">
            Ajuste le flou, les reflets spéculaires et la lumière de Fresnel.
          </div>
        </div>
      </div>

      <div className="grid gap-2">
        {levels.map((l) => {
          const active = quality === (l.id as GlassQuality);
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => set(l.id)}
              aria-pressed={active}
              className={`flex items-center gap-3 text-left rounded-2xl px-3.5 py-3 glass-thin transition-transform active:scale-[0.985] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                active ? "ring-1 ring-primary/40" : ""
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{l.label}</div>
                <div className="text-[11px] text-muted-foreground">{l.desc}</div>
              </div>
              {active && (
                <span className="glass-icon size-6 shrink-0">
                  <Check className="size-3" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-3 pt-3 border-t border-border">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">Garde-fou 120 FPS</div>
          <div className="text-[11px] text-muted-foreground">
            Rétrograde automatiquement la qualité si des chutes d'images sont détectées.
          </div>
        </div>
        <Switch checked={auto} onCheckedChange={setAuto} />
      </div>
    </div>
  );
}

export const GlassQualitySettings = memo(GlassQualitySettingsImpl);
