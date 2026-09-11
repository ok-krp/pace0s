import { createFileRoute } from "@tanstack/react-router";
import { Moon, Sun, Download, Trash2, Bell, Send, Brain, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/Stat";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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

const NATIVE_ANDROID_APK_URL = "https://github.com/ok-krp/pace0s/releases/download/android-application-latest/app-debug.apk";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Paramètres — Pace" }, { name: "description", content: "Personnalisez Pace, la confidentialité et les assistants IA." }, { property: "og:title", content: "Paramètres — Pace" }, { property: "og:description", content: "Personnalisez Pace, la confidentialité et les assistants IA." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: SettingsPage,
});

function setThemeColor(dark: boolean) { document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#111722" : "#f8fafc"); }

function SettingsPage() {
  const [dark, setDark] = useState(false);
  const push = usePush();
  const [sending, setSending] = useState(false);
  const sendTest = useServerFn(sendTestNotification);
  const handleTogglePush = async (v: boolean) => { try { if (v) await push.enable(); else await push.disable(); } catch (e) { console.error(e); toast.error((e as Error).message || "Impossible de modifier les notifications"); } };
  const handleSendTest = async () => { setSending(true); try { const res = await sendTest({ data: { title: "Test Pace", message: "Notification reçue avec succès 🎉" } }); if (res.ok) toast.success(`Notification envoyée (${res.recipients} appareil${res.recipients === 1 ? "" : "s"})`); else toast.error(`Échec : ${res.error}`); } catch (e) { toast.error((e as Error).message); } finally { setSending(false); } };
  useEffect(() => { const stored = localStorage.getItem("pace.dark") === "1"; setDark(stored); document.documentElement.classList.toggle("dark", stored); setThemeColor(stored); }, []);
  const downloadNativeAndroidApp = () => { window.open(NATIVE_ANDROID_APK_URL, "_blank", "noopener,noreferrer"); toast.success("Téléchargement de l'application Android Pace lancé."); };
  const toggleDark = (v: boolean) => { setDark(v); document.documentElement.classList.toggle("dark", v); localStorage.setItem("pace.dark", v ? "1" : "0"); setThemeColor(v); };
  const exportData = () => { const data: Record<string, unknown> = {}; Object.keys(localStorage).filter((k) => k.startsWith("pace.")).forEach((k) => { try { data[k] = JSON.parse(localStorage.getItem(k) ?? "null"); } catch {} }); const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `lifetracker-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url); toast.success("Export téléchargé"); };
  const reset = () => { if (!confirm("Réinitialiser TOUTES vos données ?")) return; Object.keys(localStorage).filter((k) => k.startsWith("pace.")).forEach((k) => localStorage.removeItem(k)); toast.success("Données effacées"); setTimeout(() => location.reload(), 600); };

  return (
    <div className="settings-page">
      <PageHeader title="Paramètres" subtitle="Tout au même endroit, sans empiler les cartes." />
      <div className="glass-card rounded-3xl p-3 sm:p-5 settings-panel">
        <section className="settings-group">
          <div className="settings-group-title">Apparence & appareil</div>
          <Row icon={dark ? <Moon className="size-4" /> : <Sun className="size-4" />} label="Mode sombre" desc="Économie de batterie et lecture nocturne"><Switch checked={dark} onCheckedChange={toggleDark} /></Row>
          <Row icon={<Smartphone className="size-4" />} label="Application Android" desc="Télécharger la version native de PaceOS"><Button variant="secondary" size="sm" onClick={downloadNativeAndroidApp} className="rounded-xl">Télécharger</Button></Row>
          <WallpaperSettings />
        </section>

        <section className="settings-group">
          <div className="settings-group-title">Santé & appareils</div>
          <BleDeviceManager />
          <HealthSourcesSection />
        </section>

        <section className="settings-group">
          <div className="settings-group-title">Notifications</div>
          <Row icon={<Bell className="size-4" />} label="Notifications push" desc={push.error ? push.error : push.permission === "denied" ? "Bloquées dans le navigateur — autorisez-les depuis l'icône à gauche de l'URL, puis rechargez la page" : push.permission === "unsupported" ? "Non supporté sur ce navigateur" : !push.ready ? "Initialisation…" : "Rappels hydratation, routine, sommeil"}><Switch checked={push.subscribed} onCheckedChange={handleTogglePush} disabled={!!push.error || !push.ready || push.permission === "denied" || push.permission === "unsupported"} /></Row>
          <Row icon={<Send className="size-4" />} label="Notification de test" desc="Vérifiez que les notifications fonctionnent sur cet appareil"><Button variant="secondary" size="sm" onClick={handleSendTest} disabled={sending || !push.subscribed} className="rounded-xl">{sending ? "Envoi…" : "Tester"}</Button></Row>
          <Accordion type="multiple" className="settings-accordion">
            <AccordionItem value="reminders"><AccordionTrigger>Rappels & automatisations</AccordionTrigger><AccordionContent className="pt-2 space-y-3"><RemindersSection /><ReminderDebugSection /></AccordionContent></AccordionItem>
          </Accordion>
        </section>

        <section className="settings-group">
          <div className="settings-group-title">Personnalisation</div>
          <Accordion type="multiple" className="settings-accordion">
            <AccordionItem value="daily-priorities"><AccordionTrigger>Priorités quotidiennes</AccordionTrigger><AccordionContent className="pt-2"><DailyPrioritySettings /></AccordionContent></AccordionItem>
            <AccordionItem value="mobilenav"><AccordionTrigger>Navigation mobile</AccordionTrigger><AccordionContent className="pt-2"><MobileNavSettings /></AccordionContent></AccordionItem>
            <AccordionItem value="nutcols"><AccordionTrigger>Colonnes Nutrition</AccordionTrigger><AccordionContent className="pt-2"><NutritionColsSettings /></AccordionContent></AccordionItem>
            <AccordionItem value="finlock"><AccordionTrigger>Verrou Finance</AccordionTrigger><AccordionContent className="pt-2"><FinanceLockSettings /></AccordionContent></AccordionItem>
          </Accordion>
        </section>

        <section className="settings-group">
          <div className="settings-group-title flex items-center gap-2"><Brain className="size-4 text-primary" /> Intelligence artificielle</div>
          <div className="settings-inline"><AiSettings /></div>
          <div className="settings-inline"><AiLocalModeSettings /></div>
        </section>

        <section className="settings-group">
          <div className="settings-group-title">Données & confidentialité</div>
          <Accordion type="multiple" className="settings-accordion">
            <AccordionItem value="privacy"><AccordionTrigger>Confidentialité & données du compte</AccordionTrigger><AccordionContent className="pt-2"><PrivacyDataSection /></AccordionContent></AccordionItem>
          </Accordion>
          <Row icon={<Download className="size-4" />} label="Exporter les préférences locales" desc="JSON des préférences stockées sur cet appareil"><Button variant="secondary" size="sm" onClick={exportData} className="rounded-xl">Exporter</Button></Row>
          <Row icon={<Trash2 className="size-4" />} label="Réinitialiser cet appareil" desc="Efface uniquement les données locales"><Button variant="destructive" size="sm" onClick={reset} className="rounded-xl">Effacer</Button></Row>
        </section>
      </div>
    </div>
  );
}

function Row({ icon, label, desc, children }: { icon: React.ReactNode; label: string; desc: string; children: React.ReactNode }) {
  return <div className="settings-row flex items-center gap-3 px-2 py-3"><div className="size-8 shrink-0 grid place-items-center text-muted-foreground">{icon}</div><div className="flex-1 min-w-0"><div className="font-medium text-sm">{label}</div><div className="text-xs text-muted-foreground leading-relaxed">{desc}</div></div>{children}</div>;
}
