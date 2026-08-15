export type DeferredPwaInstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

declare global {
  interface Window {
    __pacePwaInstallPrompt?: DeferredPwaInstallPrompt | null;
  }
}

let initialized = false;

export function initPwaInstallPrompt() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    window.__pacePwaInstallPrompt = event as DeferredPwaInstallPrompt;
    window.dispatchEvent(new Event("pace:pwa-install-available"));
  });

  window.addEventListener("appinstalled", () => {
    window.__pacePwaInstallPrompt = null;
    window.dispatchEvent(new Event("pace:pwa-installed"));
  });
}

export function getPwaInstallPrompt() {
  return typeof window !== "undefined" ? window.__pacePwaInstallPrompt ?? null : null;
}
