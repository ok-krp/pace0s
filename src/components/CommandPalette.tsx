import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Home,
  Dumbbell,
  Apple,
  Moon,
  ListChecks,
  Wallet,
  Briefcase,
  CalendarDays,
  Scale,
  ScanLine,
  Bell,
  User,
  Settings,
  Sparkles,
  Wrench,
  Droplet,
  Utensils,
} from "lucide-react";

type Entry = { icon: React.ReactNode; label: string; action: () => void; keywords?: string };

/**
 * Palette de commandes globale (Ctrl+K / Cmd+K) — navigation instantanée vers
 * n'importe quelle page, et actions rapides (ajouter poids/eau/repas/sommeil)
 * sans passer par le menu. Monté une seule fois à la racine de l'app.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpenRequest = () => setOpen(true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pace.command-palette.open", onOpenRequest);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pace.command-palette.open", onOpenRequest);
    };
  }, []);

  const go = (to: string) => () => { setOpen(false); navigate({ to }); };
  const quickAdd = (kind: "water" | "kcal" | "sleep" | "weight") => () => {
    setOpen(false);
    navigate({ to: "/", search: (prev: Record<string, unknown>) => ({ ...prev, quickAdd: kind }) });
  };

  const actions: Entry[] = [
    { icon: <Droplet className="size-4" />, label: "Ajouter de l'eau", action: quickAdd("water"), keywords: "eau hydratation boire" },
    { icon: <Utensils className="size-4" />, label: "Ajouter un repas", action: quickAdd("kcal"), keywords: "repas manger nutrition calories" },
    { icon: <Moon className="size-4" />, label: "Enregistrer le sommeil", action: quickAdd("sleep"), keywords: "sommeil nuit dormir" },
    { icon: <Scale className="size-4" />, label: "Ajouter une pesée", action: quickAdd("weight"), keywords: "poids pesée balance" },
    { icon: <Dumbbell className="size-4" />, label: "Démarrer une séance", action: go("/sport"), keywords: "sport entraînement musculation" },
    { icon: <Sparkles className="size-4" />, label: "Demander à Coach IA", action: go("/assistant"), keywords: "ia coach chat assistant" },
  ];

  const pages: Entry[] = [
    { icon: <Home className="size-4" />, label: "Accueil", action: go("/") },
    { icon: <Dumbbell className="size-4" />, label: "Sport", action: go("/sport") },
    { icon: <Apple className="size-4" />, label: "Nutrition", action: go("/nutrition") },
    { icon: <Moon className="size-4" />, label: "Sommeil", action: go("/sleep") },
    { icon: <ListChecks className="size-4" />, label: "Routine", action: go("/routine"), keywords: "habitudes" },
    { icon: <Scale className="size-4" />, label: "Corps & poids", action: go("/body") },
    { icon: <Wallet className="size-4" />, label: "Finance", action: go("/finance") },
    { icon: <Briefcase className="size-4" />, label: "Travail", action: go("/work") },
    { icon: <CalendarDays className="size-4" />, label: "Calendrier", action: go("/calendar") },
    { icon: <ScanLine className="size-4" />, label: "Scanner", action: go("/scan") },
    { icon: <Bell className="size-4" />, label: "Rappels produits", action: go("/recalls") },
    { icon: <Wrench className="size-4" />, label: "Développement", action: go("/development") },
    { icon: <User className="size-4" />, label: "Profil", action: go("/profile") },
    { icon: <Settings className="size-4" />, label: "Réglages", action: go("/settings") },
  ];

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <Command>
        <CommandInput placeholder="Rechercher une action ou une page…" />
        <CommandList>
          <CommandEmpty>Aucun résultat.</CommandEmpty>
          <CommandGroup heading="Actions rapides">
            {actions.map((a) => (
              <CommandItem key={a.label} value={`${a.label} ${a.keywords ?? ""}`} onSelect={a.action}>
                {a.icon}
                <span className="ml-2">{a.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Aller à">
            {pages.map((p) => (
              <CommandItem key={p.label} value={`${p.label} ${p.keywords ?? ""}`} onSelect={p.action}>
                {p.icon}
                <span className="ml-2">{p.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
