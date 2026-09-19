import { createFileRoute } from "@tanstack/react-router";
import { Moon, Sun, Download, Trash2, Bell, Send, Brain, Smartphone, CreditCard, Check, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/Stat";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { usePush } from "@/hooks/use-push";
import { sendTestNotification } from "@/lib/push.functions";
import { RemindersSection } from "@/components/RemindersSection";
import { ReminderDebugSection } from "@/components/ReminderDebugSection";
import { MobileNavSettings } from "@/components/MobileNavSettings";
import { NutritionColsSettings } from "@/components/NutritionColsSettings";
import { FinanceLockSettings } from "@/components/FinanceLockSettings";
import { BleDeviceManager } from "@/components/BleDeviceManager";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { PrivacyDataSection } from "@/components/PrivacyDataSection";
import { WallpaperSettings } from "@/components/WallpaperSettings";
import { AiSettings } from "@/components/AiSettings";
import { AiLocalModeSettings } from "@/components/AiLocalModeSettings";
import { HealthSourcesSection } from "@/components/HealthSourcesSection";
import { DailyPrioritySettings } from "@/components/DailyPrioritySettings";
import { VisualThemeToggle } from "@/components/VisualThemeToggle";

const NATIVE_ANDROID_APK_URL = "https://github.com/ok-krp/pace0s/releases/download/android-application-latest/app-debug.apk";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Paramètres — Pace" }, { name: "description", content: "Personnalisez Pace, la confidentialité et les assistants IA." }, { property: "og:title", content: "Paramètres — Pace" }, { property: "og:description", content: "Personnalisez Pace, la confidentialité et les assistants IA." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: SettingsPage,
});

function setThemeColor(dark: boolean, signal = false) {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", signal ? "#07100b" : dark ? "#1f242c" : "#f8fafc");
}

function SettingsPage() {
  const [dark, setDark] = useState(false);
  const push = usePush();
  const [sending, setSending] = useState(false);
  const sendTest = useServerFn(sendTestNotification);
  const handleTogglePush = async (v: boolean) => { try { if (v) await push.enable(); else await push.disable(); } catch (e) { console.error(e); toast.error((e as Error).message || "Impossible de modifier les notifications"); } };
  const handleSendTest = async () => { setSending(true); try { const res = await sendTest({ data: { title: "Test Pace", message: "Notification reçue avec succès 🎉" } }); if (res.ok) toast.success(`Notification envoyée (${res.recipients} appareil${res.recipients === 1 ? "" : "s"})`); else toast.error(`Échec : ${res.error}`); } catch (e) { toast.error((e as Error).message); } finally { setSending(false); } };
  useEffect(() => {
    const signal = localStorage.getItem("pace.visual-theme") === "signal";
    const stored = localStorage.getItem("pace.dark") === "1";
    setDark(signal || stored);
    if (signal) {
      document.documentElement.dataset.visualTheme = "signal";
      document.documentElement.classList.add("dark");
    } else {
      delete document.documentElement.dataset.visualTheme;
      document.documentElement.classList.toggle("dark", stored);
    }
    setThemeColor(signal || stored, signal);
  }, []);
  const downloadNativeAndroidApp = () => { window.open(NATIVE_ANDROID_APK_URL, "_blank", "noopener,noreferrer"); toast.success("Téléchargement de l'application Android Pace lancé."); };
  const toggleDark = (v: boolean) => {
    setDark(v);
    document.documentElement.classList.toggle("dark", v);
    localStorage.setItem("pace.dark", v ? "1" : "0");
    setThemeColor(v, localStorage.getItem("pace.visual-theme") === "signal");
  };
  const exportData = () => { const data: Record<string, unknown> = {}; Object.keys(localStorage).filter((k) => k.startsWith("pace.")).forEach((k) => { try { data[k] = JSON.parse(localStorage.getItem(k) ?? "null"); } catch {} }); const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `lifetracker-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url); toast.success("Export téléchargé"); };
  const reset = () => { if (!confirm("Réinitialiser TOUTES vos données ?")) return; Object.keys(localStorage).filter((k) => k.startsWith("pace.")).forEach((k) => localStorage.removeItem(k)); toast.success("Données effacées"); setTimeout(() => location.reload(), 600); };

  return (
    <div className="settings-page">
      <PageHeader title="Paramètres" subtitle="Réglages, IA et compte réunis dans une interface stable." />
      <style>{`\n        .settings-panel { overflow: hidden; }\n        .settings-accordion > [data-slot=accordion-item] { border-bottom: 1px solid color-mix(in oklab, var(--foreground) 8%, transparent); }\n        .settings-accordion > [data-slot=accordion-item]:last-child { border-bottom: 0; }\n        .settings-accordion [data-slot=accordion-trigger] { min-height: 56px; padding: 10px 8px; font-size: 14px; font-weight: 600; }\n        .settings-accordion [data-slot=accordion-content] > div { padding: 4px 8px 16px; }\n        .settings-row { min-height: 52px; border-radius: 12px; }\n        .settings-row:hover { background: color-mix(in oklab, var(--foreground) 4%, transparent); }\n        .settings-panel .glass-card, .settings-panel .glass-thin { background: transparent !important; box-shadow: none !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; border-color: color-mix(in oklab, var(--foreground) 8%, transparent) !important; }\n        .settings-panel .glass-card::before, .settings-panel .glass-card::after, .settings-panel .glass-thin::before, .settings-panel .glass-thin::after { display: none !important; }\n        .settings-subsection { padding-top: 14px; }\n        .settings-subsection + .settings-subsection { margin-top: 14px; border-top: 1px solid color-mix(in oklab, var(--foreground) 8%, transparent); }\n        .settings-subtitle { margin-bottom: 10px; font-size: 12px; font-weight: 600; color: var(--muted-foreground); }\n      `}</style>
      <Tabs defaultValue="settings" className="space-y-4">
        <TabsList>
          <TabsTrigger value="settings">Paramètres</TabsTrigger>
          <TabsTrigger value="subscription"><CreditCard className="size-3.5 mr-1.5" />Abonnement</TabsTrigger>
        </TabsList>

        <TabsContent value="settings">
          <div className="glass-card rounded-3xl p-3 sm:p-5 settings-panel">
            <Accordion type="multiple" className="settings-accordion">
              <AccordionItem value="appearance">
                <AccordionTrigger>Apparence & appareil</AccordionTrigger>
                <AccordionContent>
                  <Row icon={<Sparkles className="size-4" />} label="Style visuel" desc="Bascule toute l'interface vers le style Signal inspiré du dashboard sommeil">
                    <VisualThemeToggle compact={false} />
                  </Row>
                  <Row icon={dark ? <Moon className="size-4" /> : <Sun className="size-4" />} label="Mode sombre" desc="Économie de batterie et lecture nocturne"><Switch checked={dark} onCheckedChange={toggleDark} disabled={localStorage.getItem("pace.visual-theme") === "signal"} /></Row>
                  <Row icon={<Smartphone className="size-4" />} label="Application Android" desc="Télécharger la version native de PaceOS"><Button variant="secondary" size="sm" onClick={downloadNativeAndroidApp} className="rounded-xl">Télécharger</Button></Row>
                  <WallpaperSettings />
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="health">
                <AccordionTrigger>Santé & appareils</AccordionTrigger>
                <AccordionContent><BleDeviceManager /><HealthSourcesSection /></AccordionContent>
              </AccordionItem>
              <AccordionItem value="notifications">
                <AccordionTrigger>Notifications</AccordionTrigger>
                <AccordionContent>
                  <Row icon={<Bell className="size-4" />} label="Notifications push" desc={push.error ? push.error : push.permission === "denied" ? "Bloquées dans le navigateur — autorisez-les depuis l'icône à gauche de l'URL, puis rechargez la page" : push.permission === "unsupported" ? "Non supporté sur ce navigateur" : !push.ready ? "Initialisation…" : "Rappels hydratation, routine, sommeil"}><Switch checked={push.subscribed} onCheckedChange={handleTogglePush} disabled={!!push.error || !push.ready || push.permission === "denied" || push.permission === "unsupported"} /></Row>
                  <Row icon={<Send className="size-4" />} label="Notification de test" desc="Vérifiez que les notifications fonctionnent sur cet appareil"><Button variant="secondary" size="sm" onClick={handleSendTest} disabled={sending || !push.subscribed} className="rounded-xl">{sending ? "Envoi…" : "Tester"}</Button></Row>
                  <div className="settings-subsection"><div className="settings-subtitle">Rappels & automatisations</div><RemindersSection /><ReminderDebugSection /></div>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="personalization">
                <AccordionTrigger>Personnalisation</AccordionTrigger>
                <AccordionContent>
                  <div className="settings-subsection"><div className="settings-subtitle">Priorités quotidiennes</div><DailyPrioritySettings /></div>
                  <div className="settings-subsection"><div className="settings-subtitle">Navigation mobile</div><MobileNavSettings /></div>
                  <div className="settings-subsection"><div className="settings-subtitle">Colonnes Nutrition</div><NutritionColsSettings /></div>
                  <div className="settings-subsection"><div className="settings-subtitle">Verrou Finance</div><FinanceLockSettings /></div>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="ai">
                <AccordionTrigger><span className="flex items-center gap-2"><Brain className="size-4 text-primary" /> Intelligence artificielle</span></AccordionTrigger>
                <AccordionContent><div className="space-y-5"><AiSettings /><AiLocalModeSettings /></div></AccordionContent>
              </AccordionItem>
              <AccordionItem value="privacy">
                <AccordionTrigger>Données & confidentialité</AccordionTrigger>
                <AccordionContent>
                  <PrivacyDataSection />
                  <Row icon={<Download className="size-4" />} label="Exporter les préférences locales" desc="JSON des préférences stockées sur cet appareil"><Button variant="secondary" size="sm" onClick={exportData} className="rounded-xl">Exporter</Button></Row>
                  <Row icon={<Trash2 className="size-4" />} label="Réinitialiser cet appareil" desc="Efface uniquement les données locales"><Button variant="destructive" size="sm" onClick={reset} className="rounded-xl">Effacer</Button></Row>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </TabsContent>

        <TabsContent value="subscription">
          <div className="glass-card rounded-3xl p-5 sm:p-7">
            <div className="max-w-2xl">
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Abonnement</div>
              <h2 className="mt-2 text-2xl font-display font-semibold">Choisissez votre niveau Pace</h2>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">L'interface est prête en onglets pour l'instant. Aucun paiement ni abonnement n'est activé dans cette version.</p>
            </div>
            <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
              <PlanCard name="Free" price="0 €" features={["Modules essentiels", "IA locale WebGPU", "Synchronisation cloud"]} />
              <PlanCard name="Pro" price="Bientôt" highlighted features={["IA cloud avancée", "Automatisations", "Planification croisée", "Historique étendu"]} />
              <PlanCard name="Family / Coach" price="Bientôt" features={["Espaces partagés", "Membres multiples", "Programmes et listes partagés", "Fonctions équipe"]} />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PlanCard({ name, price, features, highlighted = false }: { name: string; price: string; features: string[]; highlighted?: boolean }) {
  return <section className={`rounded-2xl border p-5 ${highlighted ? "border-primary/40 bg-primary/[0.04]" : "border-border/70"}`}>
    <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">{name}</h3>{highlighted && <span className="text-[10px] uppercase tracking-wider text-primary">Cible</span>}</div>
    <div className="mt-3 text-2xl font-display font-bold">{price}</div>
    <ul className="mt-4 space-y-2">{features.map((feature) => <li key={feature} className="flex items-start gap-2 text-xs text-muted-foreground"><Check className="size-3.5 mt-0.5 text-primary shrink-0" />{feature}</li>)}</ul>
  </section>;
}

function Row({ icon, label, desc, children }: { icon: React.ReactNode; label: string; desc: string; children: React.ReactNode }) {
  return <div className="settings-row flex items-center gap-3 px-2 py-3"><div className="size-8 shrink-0 grid place-items-center text-muted-foreground">{icon}</div><div className="flex-1 min-w-0"><div className="font-medium text-sm">{label}</div><div className="text-xs text-muted-foreground leading-relaxed">{desc}</div></div>{children}</div>;
}
