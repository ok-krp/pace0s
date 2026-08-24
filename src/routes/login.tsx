import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Sparkles, Mail, Lock, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Connexion — Pace" }, { name: "description", content: "Connecte-toi à Pace pour retrouver ton suivi santé, sport, nutrition et finances." }, { property: "og:title", content: "Connexion — Pace" }] }),
  validateSearch: (s: Record<string, unknown>) => ({ next: typeof s.next === "string" ? s.next : "" }),
  component: LoginPage,
});

function safeNext(next: string): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

function LoginPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { next } = Route.useSearch();
  const target = safeNext(next);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      if (target.startsWith("/") && target !== "/login") window.location.href = target;
      else navigate({ to: "/", search: {} });
    }
  }, [user, loading, navigate, target]);

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin + target,
            data: { full_name: name },
          },
        });
        if (error) throw error;
        toast.success("Compte créé. Vérifiez vos emails pour confirmer.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Bienvenue !");
        if (target !== "/") window.location.href = target;
        else navigate({ to: "/", search: {} });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur d'authentification");
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}${target === "/" ? "/" : target}`,
          queryParams: {
            prompt: "select_account",
          },
        },
      });
      if (error) throw error;
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      toast.error(
        message.includes("Unsupported provider") || message.includes("provider is not enabled")
          ? "La connexion Google n’est pas encore activée dans Supabase. Activez le fournisseur Google pour continuer."
          : message || "Impossible de se connecter avec Google.",
      );
      setBusy(false);
    }
  };

  return (<div className="min-h-screen grid place-items-center px-4 bg-background"><motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md"><div className="text-center mb-8"><div className="size-14 mx-auto rounded-2xl stat-grad grid place-items-center text-primary-foreground shadow-[var(--shadow-glow)] mb-4"><Sparkles className="size-6" /></div><h1 className="font-display text-3xl font-semibold tracking-tight"><span className="sr-only">Connexion — </span>Pace</h1><p className="text-sm text-muted-foreground mt-1">Votre centre de contrôle de vie</p></div><div className="rounded-2xl glass-card p-6"><div className="flex gap-1 p-1 glass-thin rounded-2xl mb-5">{(["login", "signup"] as const).map((m) => <button key={m} onClick={() => setMode(m)} className={`flex-1 py-2 text-sm rounded-lg transition-all ${mode === m ? "bg-[oklch(1_0_0_/_0.6)] dark:bg-[oklch(1_0_0_/_0.16)] font-medium" : "text-muted-foreground"}`}>{m === "login" ? "Connexion" : "Créer un compte"}</button>)}</div><Button type="button" variant="outline" onClick={handleGoogle} disabled={busy} className="w-full rounded-xl mb-4 h-11"><svg className="size-4 mr-2" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A10.99 10.99 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18A10.99 10.99 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.83z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.07.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38z"/></svg>Continuer avec Google</Button><div className="relative my-4"><div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div><div className="relative flex justify-center text-xs"><span className="bg-card px-2 text-muted-foreground">ou par email</span></div></div><form onSubmit={handleEmail} className="space-y-3">{mode === "signup" && <Input placeholder="Nom" value={name} onChange={(e) => setName(e.target.value)} className="h-11 rounded-xl" />}<div className="relative"><Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" /><Input type="email" required placeholder="email@exemple.com" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 rounded-xl pl-10" /></div><div className="relative"><Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" /><Input type="password" required minLength={6} placeholder="Mot de passe (min 6)" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11 rounded-xl pl-10" /></div><Button type="submit" disabled={busy} className="w-full h-11 rounded-xl">{busy ? <Loader2 className="size-4 animate-spin" /> : mode === "login" ? "Se connecter" : "Créer mon compte"}</Button></form></div><p className="text-center text-xs text-muted-foreground mt-6">Vos données sont chiffrées et synchronisées en temps réel.</p></motion.div></div>);
}
