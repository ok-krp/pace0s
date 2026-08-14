import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useLocalState } from "@/lib/storage";
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
  ChefHat,
  StickyNote,
} from "lucide-react";

type Entry = { icon: React.ReactNode; label: string; action: () => void; keywords?: string };

/**
 * Palette de commandes globale (Ctrl+K / Cmd+K) — navigation instantanée vers
 * n'importe quelle page, et actions rapides directement depuis le dashboard.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const [recipes] = useLocalState<{ id: string; name: string }[]>("pace.recipes.custom", []);
  const [habits] = useLocalState<{ id: string; name: string }[]>("pace.routine.list", []);

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
  const quickAdd = (kind: "water" | "kcal" | "sleep" | "weight" | "workout") => () => {
    setOpen(false);
    navigate({ to: "/", search: (prev: Record<string, unknown>) => ({ ...prev, quickAdd: kind }) });
  };

  const actions: Entry[] = [
    { icon: <Droplet className="size-4" />, label: "Ajouter de l'eau", action: quickAdd("water"), keywords: "eau hydratation boire" },
    { icon: <Utensils className="size-4" />, label: "Ajouter un repas", action: quickAdd("kcal"), keywords: "repas manger nutrition calories protéines glucides lipides" },
    { icon: <Moon className="size-4" />, label: "Enregistrer le sommeil", action: quickAdd("sleep"), keywords: "sommeil nuit dormir" },
    { icon: <Scale className="size-4" />, label: "Ajouter une pesée", action: quickAdd("weight"), keywords: "poids pesée balance" },
    { icon: <Dumbbell className="size-4" />, label: "Ajouter une séance", action: quickAdd("workout"), keywords: "sport entraînement musculation exercice séries répétitions charge durée" },
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
    { icon: <StickyNote className="size-4" />, label: "Notes", action: go("/notes") },
    { icon: <ScanLine className="size-4" />, label: "Scanner", action: go("/scan") },
    { icon: <Bell className="size-4" />, label: "Rappels produits", action: go("/recalls") },
    { icon: <Wrench className="size-4" />, label: "Développement", action: go("/development") },
    { icon: <User className="size-4" />, label: "Profil", action: go("/profile") },
    { icon: <Settings className="size-4" />, label: "Réglages", action: go("/settings") },
  ];

  const recipeEntries: Entry[] = useMemo(
    () => recipes.map((r) => ({ icon: <ChefHat className="size-4" />, label: r.name, action: go("/nutrition") })),
    [recipes],
  );
  const habitEntries: Entry[] = useMemo(
    () => habits.map((h) => ({ icon: <ListChecks className="size-4" />, label: h.name, action: go("/routine") })),
    [habits],
  );

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
          {recipeEntries.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Recettes">
                {recipeEntries.map((r) => (
                  <CommandItem key={`recipe-${r.label}`} value={`recette ${r.label}`} onSelect={r.action}>
                    {r.icon}
                    <span className="ml-2">{r.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
          {habitEntries.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Habitudes">
                {habitEntries.map((h) => (
                  <CommandItem key={`habit-${h.label}`} value={`habitude ${h.label}`} onSelect={h.action}>
                    {h.icon}
                    <span className="ml-2">{h.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
