import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { getOneSignalConfig } from "@/lib/push.functions";
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
  const [ready, setReady] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "default" | "unsupported">(readPermission);
  const [error, setError] = useState<string | null>(null);
  const [consentAllowed, setConsentAllowed] = useState(() => isLegalCategoryAllowed("notifications"));

  useEffect(() => {
    const refresh = () => setConsentAllowed(isLegalCategoryAllowed("notifications"));
    window.addEventListener("lt.legal.changed", refresh);
    return () => window.removeEventListener("lt.legal.changed", refresh);
  }, []);

  // Keep permission state in sync (user may change it in browser settings without reload)
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
      } catch {
        /* ignore */
      }
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
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (typeof window === "undefined") return;
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
        OneSignal.User.PushSubscription.addEventListener("change", (e: { current: { optedIn: boolean } }) => {
          setSubscribed(e.current.optedIn);
        });
        if (user?.id) {
          try { await OneSignal.login(user.id); } catch (e) { console.error(e); }
        }
      } catch (e) {
        console.error("OneSignal init failed", e);
        if (!cancelled) {
          const message = e instanceof Error ? e.message : String(e);
          setError(
            message.includes("AppID") || message.includes("app")
              ? "Configuration OneSignal invalide : l'App ID ne correspond à aucune app Web Push active."
              : `Initialisation OneSignal impossible : ${message}`,
          );
        }
      }
    })();
    return () => { cancelled = true; };
  }, [consentAllowed, fetchConfig, user?.id]);

  const enable = useCallback(async () => {
    if (!isLegalCategoryAllowed("notifications")) {
      throw new Error("Activez d'abord le consentement Notifications dans la fenêtre confidentialité.");
    }
    const OneSignal = (await import("react-onesignal")).default;
    try {
      await OneSignal.Notifications.requestPermission();
    } catch (e) {
      console.error("requestPermission failed", e);
    }
    const perm = readPermission();
    setPermission(perm);
    if (perm === "granted") {
      await OneSignal.User.PushSubscription.optIn();
      setSubscribed(true);
    } else {
      throw new Error(
        perm === "denied"
          ? "Notifications bloquées dans le navigateur. Autorisez-les via l'icône à gauche de l'URL puis réessayez."
          : "Permission refusée.",
      );
    }
  }, []);

  const disable = useCallback(async () => {
    const OneSignal = (await import("react-onesignal")).default;
    await OneSignal.User.PushSubscription.optOut();
    setSubscribed(false);
  }, []);

  return { ready, subscribed, permission, error, enable, disable };
}
