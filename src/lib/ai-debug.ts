export type AiDebugEntry = {
  id: string;
  at: number;
  phase: "envoi" | "réception" | "erreur";
  message: string;
  durationMs?: number;
  detail?: string;
};

const KEY = "pace.ai.debug";
const PENDING_PREFIX = "pace.ai.pending:";
const MAX_ENTRIES = 100;

let entries: AiDebugEntry[] = [];
const listeners = new Set<() => void>();

export function isDebugEnabled() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(KEY) === "1";
}

export function setDebugEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, enabled ? "1" : "0");
  emit();
}

export function logAiDebug(entry: Omit<AiDebugEntry, "id" | "at">) {
  entries = [{ ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, at: Date.now() }, ...entries].slice(0, MAX_ENTRIES);
  if (isDebugEnabled()) console.info(`[ai-chat:${entry.phase}]`, entry.message, entry.detail ?? "");
  emit();
}

export function clearAiDebug() {
  entries = [];
  emit();
}

export function getAiDebugEntries() {
  return entries;
}

export function subscribeAiDebug(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  listeners.forEach((listener) => listener());
}

/** Message en attente conservé localement en cas de coupure réseau. */
export function savePendingMessage(conversationId: string, text: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PENDING_PREFIX + conversationId, text);
}

export function readPendingMessage(conversationId: string) {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(PENDING_PREFIX + conversationId);
}

export function clearPendingMessage(conversationId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PENDING_PREFIX + conversationId);
}

/** Traduit toute erreur technique en explication claire pour l'utilisateur. */
export function describeChatError(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const message = raw.trim();
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "Vous êtes hors ligne : votre message est conservé et sera renvoyé automatiquement.";
  if (!message || /^an error occurred/i.test(message)) return "Le serveur IA n’a pas répondu correctement. Votre message est conservé, réessayez.";
  if (/abort|timeout/i.test(message)) return "La réponse a mis trop de temps à arriver. Votre message est conservé, réessayez.";
  if (/failed to fetch|networkerror|load failed/i.test(message)) return "Erreur réseau : impossible de joindre le serveur. Votre message est conservé.";
  if (/401|session|authenti/i.test(message)) return "Authentification expirée : reconnectez-vous puis renvoyez votre message.";
  if (/429|trop de requêtes/i.test(message)) return "Trop de requêtes vers l’IA : patientez quelques secondes puis réessayez.";
  if (/402|crédit/i.test(message)) return "Crédits IA épuisés : rechargez votre espace pour continuer.";
  if (/5\d\d|server|indisponible/i.test(message)) return `Serveur indisponible : ${message}`;
  return message;
}
