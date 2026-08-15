import { createFileRoute } from "@tanstack/react-router";
import { Moon, Sun, Download, Trash2, Bell, Send, Brain } from "lucide-react";
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
import { CloudSyncSettings } from "@/components/CloudSyncSettings";
import { BleDeviceManager } from "@/components/BleDeviceManager";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { PrivacyDataSection } from "@/components/PrivacyDataSection";
import { WallpaperSettings } from "@/components/WallpaperSettings";
import { AiSettings } from "@/components/AiSettings";
import { HealthSourcesSection } from "@/components/HealthSourcesSection";
import { getPwaInstallPrompt, initPwaInstallPrompt } from "@/lib/pwa-install";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Paramètres — Pace" }, { name: "description", content: "Personnalisez Pace, la confidentialité et les assistants IA." }, { property: "og:title", content: "Paramètres — Pace" }, { property: "og:description", content: "Personnalisez Pace, la confidentialité et les assistants IA." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const [dark, setDark] = useState(false);
  const push = usePush();
  const [sending, setSending] = useState(false);
  const [installAvailable, setInstallAvailable] = useState(false);
  const [installed, setInstalled] = useState(false);
  const sendTest = useServerFn(sendTestNotification);

  const handleTogglePush = async (v: boolean) => {
    try { if (v) await push.enable(); else await push.disable(); }
    catch (e) { console.error(e); toast.error((e as Error).message || "Impossible de modifier les notifications"); }
  };

  const handleSendTest = async () => {
    setSending(true);
    try {
      const res = await sendTest({ data: { title: "Test Pace", message: "Notification reçue avec succès 🎉" } });
      if (res.ok) toast.success(`Notification envoyée (${res.recipients} appareil${res.recipients === 1 ? "" : "s"})`);
      else toast.error(`Échec : ${res.error}`);
    } catch (e) { toast.error((e as Error).message); }
    finally { setSending(false); }
  };

  useEffect(() => {
    const stored = localStorage.getItem("pace.dark") === "1";
    setDark(stored);
    document.documentElement.classList.toggle("dark", stored);
  }, []);

  useEffect(() => {
    initPwaInstallPrompt();
    const standalone = window.matchMedia("(display-mode: standalone)");
    const updateInstalled = () => setInstalled(standalone.matches || ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone)));
    const updateAvailable = () => setInstallAvailable(Boolean(getPwaInstallPrompt()));
    updateInstalled();
    updateAvailable();
    const onAvailable = () => updateAvailable();
    const onInstalled = () => { setInstallAvailable(false); setInstalled(true); };
    window.addEventListener("pace:pwa-install-available", onAvailable);
    window.addEventListener("pace:pwa-installed", onInstalled);
    standalone.addEventListener?.("change", updateInstalled);
    return () => {
      window.removeEventListener("pace:pwa-install-available", onAvailable);
      window.removeEventListener("pace:pwa-installed", onInstalled);
      standalone.removeEventListener?.("change", updateInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (installed) {
      toast.info("Pace est déjà installé sur cet appareil.");
      return;
    }
    const installPrompt = getPwaInstallPrompt();
    if (!installPrompt) {
      toast.info("L’installation directe n’est pas disponible dans ce navigateur. Utilisez l’option « Installer Pace » du menu du navigateur si elle est proposée.");
      return;
    }
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      window.__pacePwaInstallPrompt = null;
      setInstallAvailable(false);
      if (choice.outcome === "accepted") setInstalled(true);
    } catch (e) {
      console.error(e);
      toast.error("Impossible de lancer l’installation de Pace.");
    }
  };

  const toggleDark = (v: boolean) => {
    setDark(v);
    document.documentElement.classList.toggle("dark", v);
    localStorage.setItem("pace.dark", v ? "1" : "0");
  };

  const exportData = () => {
    const data: Record<string, unknown> = {};
    Object.keys(localStorage).filter((k) => k.startsWith("pace.")).forEach((k) => { try { data[k] = JSON.parse(localStorage.getItem(k) ?? "null"); } catch {} });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `lifetracker-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url);
    toast.success("Export téléchargé");
  };

  const reset = () => {
    if (!confirm("Réinitialiser TOUTES vos données ?")) return;
    Object.keys(localStorage).filter((k) => k.startsWith("pace.")).forEach((k) => localStorage.removeItem(k));
    toast.success("Données effacées");
    setTimeout(() => location.reload(), 600);
  };

  return (
    <div>
      <PageHeader title="Paramètres" subtitle="Personnalisez votre expérience." />
      <div className="space-y-3">
        <Row icon={dark ? <Moon className="size-4" /> : <Sun className="size-4" />} label="Mode sombre" desc="Économie de batterie et lecture nocturne"><Switch checked={dark} onCheckedChange={toggleDark} /></Row>
        <Row icon={<Bell className="size-4" />} label="Notifications push" desc={push.error ? push.error : push.permission === "denied" ? "Bloquées dans le navigateur — autorisez-les depuis l'icône à gauche de l'URL, puis rechargez la page" : push.permission === "unsupported" ? "Non supporté sur ce navigateur" : !push.ready ? "Initialisation…" : "Rappels hydratation, routine, sommeil"}>
          <Switch checked={push.subscribed} onCheckedChange={handleTogglePush} disabled={!!push.error || !push.ready || push.permission === "denied" || push.permission === "unsupported"} />
        </Row>
        <Row icon={<Send className="size-4" />} label="Envoyer une notification de test" desc="Vérifiez que tout fonctionne sur cet appareil"><Button variant="secondary" size="sm" onClick={handleSendTest} disabled={sending || !push.subscribed} className="rounded-xl">{sending ? "Envoi…" : "Tester"}</Button></Row>
        <BleDeviceManager />
        <HealthSourcesSection />
        <WallpaperSettings />
        <Accordion type="multiple" className="space-y-3">
          <AccordionItem value="ai" className="rounded-2xl glass-card px-4"><AccordionTrigger className="text-sm font-medium"><span className="flex items-center gap-2"><Brain className="size-4 text-primary" />Intelligence Artificielle</span></AccordionTrigger><AccordionContent className="pt-2"><AiSettings /></AccordionContent></AccordionItem>
          <AccordionItem value="reminders" className="rounded-2xl glass-card px-4"><AccordionTrigger className="text-sm font-medium">Rappels & notifications</AccordionTrigger><AccordionContent className="pt-2 space-y-3"><RemindersSection /><ReminderDebugSection /></AccordionContent></AccordionItem>
          <AccordionItem value="mobilenav" className="rounded-2xl glass-card px-4"><AccordionTrigger className="text-sm font-medium">Navigation mobile</AccordionTrigger><AccordionContent className="pt-2"><MobileNavSettings /></AccordionContent></AccordionItem>
          <AccordionItem value="nutcols" className="rounded-2xl glass-card px-4"><AccordionTrigger className="text-sm font-medium">Colonnes Nutrition</AccordionTrigger><AccordionContent className="pt-2"><NutritionColsSettings /></AccordionContent></AccordionItem>
          <AccordionItem value="finlock" className="rounded-2xl glass-card px-4"><AccordionTrigger className="text-sm font-medium">Verrou Finance</AccordionTrigger><AccordionContent className="pt-2"><FinanceLockSettings /></AccordionContent></AccordionItem>
          <AccordionItem value="cloud" className="rounded-2xl glass-card px-4"><AccordionTrigger className="text-sm font-medium">Synchronisation Cloud</AccordionTrigger><AccordionContent className="pt-2"><CloudSyncSettings /></AccordionContent></AccordionItem>
          <AccordionItem value="privacy" className="rounded-2xl glass-card px-4"><AccordionTrigger className="text-sm font-medium">Confidentialité & Données</AccordionTrigger><AccordionContent className="pt-2"><PrivacyDataSection /></AccordionContent></AccordionItem>
        </Accordion>
        <div className="rounded-2xl glass-card p-4 flex items-center gap-4">
          <div className="size-10 rounded-xl bg-muted grid place-items-center text-foreground"><Download className="size-4" /></div>
          <div className="flex-1 min-w-0"><div className="font-medium">Application</div><div className="text-xs text-muted-foreground">Installez Pace sur cet appareil comme application.</div></div>
          <Button variant="secondary" size="sm" onClick={handleInstall} className="rounded-xl">{installed ? "Installée" : "Télécharger l’application"}</Button>
        </div>
        <Row icon={<Download className="size-4" />} label="Exporter les données locales" desc="JSON des préférences stockées sur cet appareil"><Button variant="secondary" size="sm" onClick={exportData} className="rounded-xl">Exporter</Button></Row>
        <Row icon={<Trash2 className="size-4" />} label="Réinitialiser cet appareil" desc="Efface uniquement les données locales"><Button variant="destructive" size="sm" onClick={reset} className="rounded-xl">Effacer</Button></Row>
      </div>
    </div>
  );
}

function Row({ icon, label, desc, children }: { icon: React.ReactNode; label: string; desc: string; children: React.ReactNode }) {
  return <div className="flex items-center gap-4 rounded-2xl glass-card p-4"><div className="size-10 rounded-xl bg-muted grid place-items-center text-foreground">{icon}</div><div className="flex-1 min-w-0"><div className="font-medium">{label}</div><div className="text-xs text-muted-foreground">{desc}</div></div>{children}</div>;
}