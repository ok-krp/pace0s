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
import { createBillingCheckout, createBillingPortal, getBillingStatus } from "@/lib/billing.functions";
import { PLAN_CATALOG, type PlanId, type EntitlementPlan } from "@/lib/billing";

const NATIVE_ANDROID_APK_URL = "https://github.com/ok-krp/pace0s/releases/download/android-application-latest/app-debug.apk";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Paramètres — Pace" }, { name: "description", content: "Personnalisez Pace, la confidentialité et les assistants IA." }, { property: "og:title", content: "Paramètres — Pace" }, { property: "og:description", content: "Personnalisez Pace, la confidentialité et les assistants IA." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: SettingsPage,
});

function setThemeColor(dark: boolean, signal = false, glass = false) {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", glass ? "#070b12" : signal ? "#07100b" : dark ? "#1f242c" : "#f8fafc");
}

function SettingsPage() {
  const [dark, setDark] = useState(false);
  const [signal, setSignal] = useState(false);
  const [glass, setGlass] = useState(false);
  const push = usePush();
  const [sending, setSending] = useState(false);
  const [billing, setBilling] = useState<{ plan: EntitlementPlan; status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; stripeConfigured: boolean; trialEndsAt: string | null; trialActive: boolean } | null>(null);
  const [billingLoading, setBillingLoading] = useState(true);
  const [billingInterval, setBillingInterval] = useState<"monthly" | "annual">("monthly");
  const getBilling = useServerFn(getBillingStatus);
  const startCheckout = useServerFn(createBillingCheckout);
  const openPortal = useServerFn(createBillingPortal);
  const sendTest = useServerFn(sendTestNotification);
  const handleTogglePush = async (v: boolean) => { try { if (v) await push.enable(); else await push.disable(); } catch (e) { console.error(e); toast.error((e as Error).message || "Impossible de modifier les notifications"); } };
  const handleSendTest = async () => { setSending(true); try { const res = await sendTest({ data: { title: "Test Pace", message: "Notification reçue avec succès 🎉" } }); if (res.ok) toast.success(`Notification envoyée (${res.recipients} appareil${res.recipients === 1 ? "" : "s"})`); else toast.error(`Échec : ${res.error}`); } catch (e) { toast.error((e as Error).message); } finally { setSending(false); } };
  useEffect(() => { let deviceId = localStorage.getItem("pace.billing.device_id"); if (!deviceId) { deviceId = crypto.randomUUID() + "-" + crypto.randomUUID(); localStorage.setItem("pace.billing.device_id", deviceId); } getBilling({ data: { deviceId } }).then(setBilling).catch((error) => console.error("billing status failed", error)).finally(() => setBillingLoading(false)); }, [getBilling]);
  useEffect(() => {
    const activeSignal = localStorage.getItem("pace.visual-theme") === "signal";
    const activeGlass = localStorage.getItem("pace.visual-theme") === "glass";
    const stored = localStorage.getItem("pace.dark") === "1";
    setSignal(activeSignal);
    setGlass(activeGlass);
    setDark(activeSignal || activeGlass || stored);
    if (activeSignal || activeGlass) {
      document.documentElement.dataset.visualTheme = activeSignal ? "signal" : "glass";
      document.documentElement.classList.add("dark");
    } else {
      delete document.documentElement.dataset.visualTheme;
      document.documentElement.classList.toggle("dark", stored);
    }
    setThemeColor(activeSignal || activeGlass || stored, activeSignal, activeGlass);

    const handleVisualThemeChange = (event: Event) => {
      const theme = (event as CustomEvent<{ theme?: string; signal?: boolean }>).detail?.theme;
      const nextSignal = theme === "signal" || (!theme && (event as CustomEvent<{ signal?: boolean }>).detail?.signal === true);
      const nextGlass = theme === "glass";
      setSignal(nextSignal);
      setGlass(nextGlass);
      setDark(nextSignal || nextGlass || localStorage.getItem("pace.dark") === "1");
    };
    window.addEventListener("pace.visual-theme.change", handleVisualThemeChange);
    return () => window.removeEventListener("pace.visual-theme.change", handleVisualThemeChange);
  }, []);
  const downloadNativeAndroidApp = () => { window.open(NATIVE_ANDROID_APK_URL, "_blank", "noopener,noreferrer"); toast.success("Téléchargement de l'application Android Pace lancé."); };
  const toggleDark = (v: boolean) => {
    setDark(v);
    document.documentElement.classList.toggle("dark", v);
    localStorage.setItem("pace.dark", v ? "1" : "0");
    setThemeColor(v, localStorage.getItem("pace.visual-theme") === "signal", localStorage.getItem("pace.visual-theme") === "glass");
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
          <div className="glass-card rounded-3xl border border-white/20 bg-white/5 backdrop-blur-3xl shadow-[0_12px_40px_0_rgba(0,0,0,0.15)] p-3 sm:p-5 settings-panel">
            <Accordion type="multiple" className="settings-accordion">
              <AccordionItem value="appearance">
                <AccordionTrigger>Apparence & appareil</AccordionTrigger>
                <AccordionContent>
                  <Row icon={<Sparkles className="size-4" />} label="Style visuel" desc="Cycle entre les styles Pace, Signal et Premium Glass">
                    <VisualThemeToggle compact={false} />
                  </Row>
                  <Row icon={dark ? <Moon className="size-4" /> : <Sun className="size-4" />} label="Mode sombre" desc="Économie de batterie et lecture nocturne"><Switch checked={dark} onCheckedChange={toggleDark} disabled={signal || glass} /></Row>
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
          {/* Legacy subscription grid preserved in comments for visual rollback.
          <div className="glass-card rounded-3xl border border-white/20 bg-white/5 backdrop-blur-3xl shadow-[0_12px_40px_0_rgba(0,0,0,0.15)] p-5 sm:p-7">
            <div className="max-w-3xl">
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Abonnement</div>
              <h2 className="mt-2 text-2xl font-display font-semibold text-white drop-shadow-sm">Pace, sans limites artificielles</h2>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">Pace fonctionne désormais sur abonnement payant. Choisis Essential, Pro ou Ultimate pour activer les fonctionnalités correspondantes. Les droits sont synchronisés côté serveur après confirmation Stripe.</p>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded-full border px-3 py-1">
                  Plan actuel :{" "}
                  <strong className="text-foreground">
                    {billingLoading ? "…" : billing?.plan && billing.plan !== "trial" && billing.plan !== "expired" && billing.plan in PLAN_CATALOG ? PLAN_CATALOG[billing.plan as PlanId].name : "Abonnement requis"}
                  </strong>
                </span>
                {billing?.cancelAtPeriodEnd && (
                  <span className="rounded-full border border-amber-500/30 px-3 py-1 text-amber-600">Annulation en fin de période</span>
                )}
                {billing?.plan !== "trial" && billing?.plan !== "expired" && (
                  <Button variant="secondary" size="sm" className="rounded-full" onClick={async () => {
                    try {
                      const res = await openPortal({});
                      window.location.href = res.url;
                    } catch (error) {
                      toast.error((error as Error).message);
                    }
                  }}>Gérer mon abonnement</Button>
                )}
              </div>
            </div>
            Ancienne offre d’essai conservée en commentaire : la grille est désormais 100 % payante.<div className="flex items-center gap-2 mb-4"><Button size="sm" variant={billingInterval === "monthly" ? "default" : "outline"} onClick={() => setBillingInterval("monthly")}>Mensuel</Button><Button size="sm" variant={billingInterval === "annual" ? "default" : "outline"} onClick={() => setBillingInterval("annual")}>Annuel</Button></div><div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {(Object.entries(PLAN_CATALOG) as Array<[PlanId, typeof PLAN_CATALOG[PlanId]]>).map(([plan, details]) => (
                <PlanCard
                  key={plan}
                  plan={plan}
                  name={details.name}
                  price={billingInterval === "monthly" ? `${details.monthly.toFixed(2).replace(".", ",")} € / mois` : `${details.annual.toFixed(0)} € / an`}
                  annual={billingInterval === "monthly" ? "Résiliable à tout moment" : "99 / 199 / 299 € par an selon le plan"}
                  features={[...details.features]}
                  highlighted={plan === "pro"}
                  current={billing?.plan === plan}
                  disabled={!billing?.stripeConfigured}
                  onSelect={async () => {
                    try {
                      const res = await startCheckout({ data: { plan: plan as "plus" | "pro" | "coach", interval: billingInterval } });
                      window.location.href = res.url;
                    } catch (error) {
                      toast.error((error as Error).message);
                    }
                  }}
                />
              ))}
            </div>
            <p className="mt-4 text-[11px] text-muted-foreground">Prix affichés hors TVA éventuelle. Aucun plan gratuit ni essai gratuit n’est proposé.</p>
          </div>
          */}

          <section className="min-h-[calc(100vh-13rem)] bg-[#050507] text-white rounded-[28px] border border-white/10 p-4 sm:p-8 overflow-hidden">
            <div className="mx-auto max-w-6xl">
              <div className="flex items-center justify-between gap-4 rounded-full border border-white/10 bg-[#121215]/80 px-4 py-2.5 backdrop-blur-xl">
                <div className="flex items-center gap-3 min-w-0">
                  <CreditCard className="size-4 shrink-0 text-white/70" />
                  <span className="text-sm font-medium tracking-tight truncate">PaceOS</span>
                </div>
                {billing?.cancelAtPeriodEnd && <span className="rounded-full border border-amber-400/20 px-3 py-1 text-[10px] uppercase tracking-wider text-amber-200/70">Annulation en fin de période</span>}
              </div>

              <div className="relative py-14 sm:py-20 text-center">
                <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none">
                  <span className="text-[clamp(5rem,18vw,13rem)] font-black tracking-[-0.08em] leading-none text-white/[0.06] select-none">PRICING</span>
                </div>
                <div className="relative">
                  <div className="text-[11px] uppercase tracking-[0.3em] text-white/45">Abonnement PaceOS</div>
                  <h2 className="mt-3 text-4xl sm:text-5xl font-display font-semibold tracking-tight text-white">Choisis ton plan PaceOS</h2>
                  <p className="mx-auto mt-4 max-w-2xl text-sm sm:text-base leading-relaxed text-white/60">Accès payant sans essai gratuit. Les droits sont synchronisés côté serveur après confirmation Stripe.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                {(Object.entries(PLAN_CATALOG) as Array<[PlanId, typeof PLAN_CATALOG[PlanId]]>).map(([plan, details]) => {
                  const isPro = plan === "pro";
                  const current = billing?.plan === plan;
                  const disabled = !billing?.stripeConfigured || current;
                  const price = billingInterval === "monthly" ? details.monthly.toFixed(2).replace(".", ",") : details.annual.toFixed(0);
                  const period = billingInterval === "monthly" ? "/ mois" : "/ an";
                  return (
                    <section key={plan} className={`flex min-h-[390px] flex-col rounded-3xl border p-7 backdrop-blur-xl bg-white/5 border-white/10 ${isPro ? "border-white/30 bg-white/10" : ""}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.2em] text-white/45">{isPro ? "Pro" : plan === "plus" ? "Essential" : "Ultimate"}</div>
                          <h3 className="mt-2 text-xl font-medium text-white">{details.name}</h3>
                        </div>
                        {current && <span className="rounded-full border border-white/20 px-3 py-1 text-[10px] uppercase tracking-wider text-white/70">Actuel</span>}
                      </div>
                      <div className="mt-8 flex items-end gap-2">
                        <span className="text-4xl font-display font-semibold tracking-tight text-white">{price} €</span>
                        <span className="pb-1 text-sm text-white/45">{period}</span>
                      </div>
                      <p className="mt-3 min-h-10 text-sm leading-relaxed text-white/55">{details.description}</p>
                      <ul className="mt-6 flex-1 space-y-3">
                        {details.features.map((feature) => <li key={feature} className="flex items-start gap-3 text-sm text-white/70"><Check className="mt-0.5 size-4 shrink-0 text-white" />{feature}</li>)}
                      </ul>
                      <Button className={`mt-7 w-full rounded-2xl border border-white/20 ${isPro ? "bg-white text-[#050507]" : "bg-white/5 text-white"}`} disabled={disabled} onClick={async () => {
                        try {
                          const res = await startCheckout({ data: { plan: plan as "plus" | "pro" | "coach", interval: billingInterval } });
                          window.location.href = res.url;
                        } catch (error) {
                          toast.error((error as Error).message);
                        }
                      }}>{current ? "Plan actuel" : !billing?.stripeConfigured ? "Paiement à configurer" : "S’abonner"}</Button>
                    </section>
                  );
                })}
              </div>

              <div className="mt-8 flex flex-col items-center gap-3">
                <div className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1 backdrop-blur-xl">
                  <button type="button" aria-pressed={billingInterval === "monthly"} onClick={() => setBillingInterval("monthly")} className={`rounded-full px-4 py-2 text-xs font-medium ${billingInterval === "monthly" ? "bg-white text-[#050507]" : "text-white/55"}`}>Mensuel</button>
                  <button type="button" aria-pressed={billingInterval === "annual"} onClick={() => setBillingInterval("annual")} className={`rounded-full px-4 py-2 text-xs font-medium ${billingInterval === "annual" ? "bg-white text-[#050507]" : "text-white/55"}`}>Annuel</button>
                </div>
                <div className="text-xs text-white/45">Facturation annuelle — Essential 99 €, Pro 199 €, Ultimate 299 € / an</div>
                <div className="text-[11px] text-white/35">Prix affichés hors TVA éventuelle. Aucun plan gratuit ni essai gratuit n’est proposé.</div>
              </div>
            </div>
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* Legacy PlanCard implementation preserved for rollback/reference.

function PlanCard({ plan, name, price, annual, features, highlighted = false, current = false, disabled = false, onSelect }: { plan: PlanId; name: string; price: string; annual: string; features: string[]; highlighted?: boolean; current?: boolean; disabled?: boolean; onSelect?: () => void }) {
  return <section className={`rounded-2xl border p-5 flex flex-col ${highlighted ? "border-primary/40 bg-primary/[0.04]" : "border-border/70"}`}>
    <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">{name}</h3>{current ? <span className="text-[10px] uppercase tracking-wider text-primary">Actuel</span> : highlighted && <span className="text-[10px] uppercase tracking-wider text-primary">Recommandé</span>}</div>
    <div className="mt-3 text-2xl font-display font-bold">{price}</div>
    <div className="text-xs text-muted-foreground">{annual}</div>
    <ul className="mt-4 space-y-2 flex-1">{features.map((feature) => <li key={feature} className="flex items-start gap-2 text-xs text-muted-foreground"><Check className="size-3.5 mt-0.5 text-primary shrink-0" />{feature}</li>)}</ul>
    <Button className="mt-5 w-full rounded-xl" disabled={disabled || current} onClick={onSelect}>{current ? "Plan actuel" : disabled ? "Paiement à configurer" : "Choisir ce plan"}</Button>
  </section>;
}

*/

function Row({ icon, label, desc, children }: { icon: React.ReactNode; label: string; desc: string; children: React.ReactNode }) {
  return <div className="settings-row flex items-center gap-3 px-2 py-3"><div className="size-8 shrink-0 grid place-items-center text-muted-foreground">{icon}</div><div className="flex-1 min-w-0"><div className="font-medium text-sm text-white drop-shadow-sm">{label}</div><div className="text-xs text-muted-foreground leading-relaxed">{desc}</div></div>{children}</div>;
}
