import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { getOneSignalConfig } from "@/lib/push.functions";
import { registerPushSubscription, unregisterPushSubscription } from "@/lib/push-subscriptions.functions";
import { isLegalCategoryAllowed } from "@/lib/legal";

let initPromise: Promise<void> | null = null;

async function initOneSignal(appId: string) {
  if (typeof window === "undefined") return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const mod = await import("react-onesignal");
    await mod.default.init({
      appId,
      allowLocalhostAsSecureOrigin: true,
      serviceWorkerParam: { scope: "/onesignal/" },
      serviceWorkerPath: "onesignal/OneSignalSDKWorker.js",
    });
  })();
  return initPromise;
}

function readPermission(): NotificationPermission | "default" | "unsupported" {
  if (typeof window === "undefined" || typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export function usePush() {
  const { user } = useAuth();
  const fetchConfig = useServerFn(getOneSignalConfig);
  const saveSubscription = useServerFn(registerPushSubscription);
  const removeSubscription = useServerFn(unregisterPushSubscription);
  const [ready, setReady] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "default" | "unsupported">(readPermission);
  const [error, setError] = useState<string | null>(null);
  const [consentAllowed, setConsentAllowed] = useState(() => isLegalCategoryAllowed("notifications"));

  useEffect(() => {
    const refresh = () => setConsentAllowed(isLegalCategoryAllowed("notifications"));
    window.addEventListener("pace.legal.changed", refresh);
    return () => window.removeEventListener("pace.legal.changed", refresh);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!consentAllowed) {
      setReady(false);
      setSubscribed(false);
      setError("Consentement notifications requis.");
      return;
    }
    let permStatus: PermissionStatus | null = null;
    let cancelled = false;
    const refresh = () => setPermission(readPermission());
    (async () => {
      try {
        if (navigator.permissions?.query) {
          permStatus = await navigator.permissions.query({ name: "notifications" as PermissionName });
          if (cancelled) return;
          refresh();
          permStatus.addEventListener("change", refresh);
        }
      } catch { /* ignore */ }
    })();
    const onVisible = () => refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      permStatus?.removeEventListener("change", refresh);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [consentAllowed]);

  useEffect(() => {
    let cancelled = false;
    if (typeof window === "undefined" || !user?.id || !consentAllowed) return;
    (async () => {
      try {
        setError(null);
        const cfg = await fetchConfig();
        if (!cfg.appId) { setError("Notifications non configurées"); return; }
        await initOneSignal(cfg.appId);
        if (cancelled) return;
        const OneSignal = (await import("react-onesignal")).default;
        setReady(true);
        setSubscribed(OneSignal.User.PushSubscription.optedIn ?? false);
        setPermission(readPermission());

        const registerCurrentSubscription = async () => {
          const subscriptionId = OneSignal.User.PushSubscription.id;
          const optedIn = OneSignal.User.PushSubscription.optedIn ?? false;
          setSubscribed(optedIn);
          if (subscriptionId && optedIn) {
            try {
              await saveSubscription({ data: { subscriptionId, platform: "web" } });
            } catch (e) {
              console.error("Push subscription registration failed", e);
              if (!cancelled) setError("Impossible d'enregistrer cet appareil pour les notifications.");
            }
          }
        };

        OneSignal.User.PushSubscription.addEventListener("change", () => {
          void registerCurrentSubscription();
        });
        await registerCurrentSubscription();
      } catch (e) {
        console.error("OneSignal init failed", e);
        if (!cancelled) setError("Initialisation des notifications impossible.");
      }
    })();
    return () => { cancelled = true; };
  }, [consentAllowed, fetchConfig, saveSubscription, user?.id]);

  const enable = useCallback(async () => {
    if (!isLegalCategoryAllowed("notifications")) {
      throw new Error("Activez d'abord le consentement Notifications dans la fenêtre confidentialité.");
    }
    const OneSignal = (await import("react-onesignal")).default;
    try { await OneSignal.Notifications.requestPermission(); } catch (e) { console.error("requestPermission failed", e); }
    const perm = readPermission();
    setPermission(perm);
    if (perm === "granted") {
      await OneSignal.User.PushSubscription.optIn();
      setSubscribed(true);
      const subscriptionId = OneSignal.User.PushSubscription.id;
      if (subscriptionId) await saveSubscription({ data: { subscriptionId, platform: "web" } });
    } else {
      throw new Error(
        perm === "denied"
          ? "Notifications bloquées dans le navigateur. Autorisez-les via l'icône à gauche de l'URL puis réessayez."
          : "Permission refusée.",
      );
    }
  }, [saveSubscription]);

  const disable = useCallback(async () => {
    const OneSignal = (await import("react-onesignal")).default;
    const subscriptionId = OneSignal.User.PushSubscription.id;
    await OneSignal.User.PushSubscription.optOut();
    if (subscriptionId) await removeSubscription({ data: { subscriptionId } });
    setSubscribed(false);
  }, [removeSubscription]);

  return { ready, subscribed, permission, error, enable, disable };
}
