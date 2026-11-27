import { useEffect } from "react";
import { applyWallpaper, purgeWallpaperCacheForOwner, readWallpaperChoice, WALLPAPERS } from "@/hooks/use-wallpaper";
import { createPrivateRealtimeChannel, supabase } from "@/integrations/supabase/client";
import { isLegalCategoryAllowed } from "@/lib/legal";
import { readLocalPreference } from "@/lib/storage";

export type SharedAppearance = {
  ownerUserId: string;
  visualTheme: unknown;
  dark: unknown;
  wallpaper: unknown;
  updatedAt: string | null;
};

type AppearanceRpcResponse = {
  data: unknown;
  error: { message: string } | null;
};
type AppearanceRpcClient = {
  rpc(name: string, args?: Record<string, unknown>): Promise<AppearanceRpcResponse>;
};
type WallpaperRenderChoice = Parameters<typeof applyWallpaper>[0];

const rpc = supabase as unknown as AppearanceRpcClient;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let activeUserId: string | null = null;
let activeAppearance: SharedAppearance | null = null;
let lastAppliedSharedOwnerId: string | null = null;

function unwrapPreference(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 8; depth++) {
    if (!current || typeof current !== "object" || Array.isArray(current)) break;
    const record = current as Record<string, unknown>;
    if (record.version !== 1 || !("value" in record)) break;
    current = record.value;
  }
  return current;
}

function normalizeAppearance(value: unknown): SharedAppearance | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.ownerUserId !== "string" || !UUID_PATTERN.test(record.ownerUserId)) return null;
  return {
    ownerUserId: record.ownerUserId,
    visualTheme: record.visualTheme,
    dark: record.dark,
    wallpaper: record.wallpaper,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
  };
}

function normalizedTheme(value: unknown): "default" | "signal" | "glass" {
  const theme = unwrapPreference(value);
  return theme === "signal" || theme === "glass" ? theme : "default";
}

function normalizedDark(value: unknown): boolean {
  const dark = unwrapPreference(value);
  return dark === true || dark === 1 || dark === "1" || dark === "true";
}

function sharedWallpaperChoice(appearance: SharedAppearance): WallpaperRenderChoice {
  const raw = unwrapPreference(appearance.wallpaper);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { id: "graphite" } as WallpaperRenderChoice;
  }

  const record = raw as Record<string, unknown>;
  if (record.kind === "custom" && typeof record.storagePath === "string") {
    const prefix = appearance.ownerUserId + "/";
    const filename = record.storagePath.startsWith(prefix)
      ? record.storagePath.slice(prefix.length)
      : "";
    if (/^[A-Za-z0-9._-]+\.(jpg|png|webp)$/i.test(filename)) {
      return { kind: "custom", storagePath: record.storagePath } as WallpaperRenderChoice;
    }
  }

  if (typeof record.id === "string" && WALLPAPERS.some((preset) => preset.id === record.id)) {
    return { id: record.id } as WallpaperRenderChoice;
  }
  return { id: "graphite" } as WallpaperRenderChoice;
}

function emitSharedAppearanceChange(theme?: string, dark?: boolean) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("pace.shared-appearance.change", {
    detail: { active: activeAppearance !== null, appearance: activeAppearance },
  }));
  if (theme !== undefined && dark !== undefined) {
    window.dispatchEvent(new CustomEvent("pace.visual-theme.change", {
      detail: { theme, signal: theme === "signal", shared: activeAppearance !== null, dark },
    }));
  }
}

function setSharedAppearance(userId: string, appearance: SharedAppearance | null) {
  activeUserId = userId;
  activeAppearance = appearance;
  emitSharedAppearanceChange();
}

export function getCurrentSharedAppearance(userId?: string): SharedAppearance | null {
  if (!userId) return activeAppearance;
  return activeUserId === userId ? activeAppearance : null;
}

export function isFollowingSharedAppearance(userId?: string): boolean {
  return getCurrentSharedAppearance(userId) !== null;
}

export function getEffectiveWallpaperChoice(userId?: string): WallpaperRenderChoice {
  const shared = getCurrentSharedAppearance(userId);
  return shared ? sharedWallpaperChoice(shared) : readWallpaperChoice(userId);
}

/** Applies either the incoming shared appearance or this account's own saved preferences. */
export function applyEffectiveAppearance(userId?: string) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const shared = getCurrentSharedAppearance(userId);
  const theme = shared
    ? normalizedTheme(shared.visualTheme)
    : normalizedTheme(readLocalPreference("pace.visual-theme", "default"));
  const dark = theme === "glass" || (shared
    ? normalizedDark(shared.dark)
    : normalizedDark(readLocalPreference("pace.dark", "0")));

  if (theme === "default") delete root.dataset.visualTheme;
  else root.dataset.visualTheme = theme;
  root.classList.toggle("dark", dark);

  const themeColor = document.querySelector('meta[name="theme-color"]');
  themeColor?.setAttribute(
    "content",
    theme === "glass" ? (dark ? "#070a14" : "#e9e7ee")
      : theme === "signal" ? (dark ? "#090b0e" : "#f6f7f9")
        : dark ? "#1f242c" : "#f8fafc",
  );

  applyWallpaper(getEffectiveWallpaperChoice(userId));
  const nextSharedOwnerId = shared?.ownerUserId ?? null;
  const previousSharedOwnerId = lastAppliedSharedOwnerId;
  lastAppliedSharedOwnerId = nextSharedOwnerId;
  if (previousSharedOwnerId && previousSharedOwnerId !== nextSharedOwnerId) {
    void purgeWallpaperCacheForOwner(previousSharedOwnerId);
  }
  emitSharedAppearanceChange(theme, dark);
}

/** Watches the private recipient channel; the remote appearance never overwrites local preferences. */
export function useSharedAppearance(userId?: string) {
  useEffect(() => {
    let disposed = false;
    let requestVersion = 0;
    let channel: ReturnType<typeof createPrivateRealtimeChannel> | null = null;

    const clear = () => {
      if (disposed) return;
      setSharedAppearance(userId ?? "", null);
      applyEffectiveAppearance(userId);
    };

    const stopChannel = () => {
      if (!channel) return;
      const previous = channel;
      channel = null;
      void supabase.removeChannel(previous);
    };

    const refresh = async () => {
      if (!userId || !isLegalCategoryAllowed("sync_cloud")) {
        clear();
        return;
      }

      const version = ++requestVersion;
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (disposed || version !== requestVersion) return;
        if (
          sessionData.session?.user.id !== userId ||
          !sessionData.session.access_token
        ) {
          clear();
          return;
        }
        await supabase.realtime.setAuth(sessionData.session.access_token);
        if (disposed || version !== requestVersion) return;

        const result = await rpc.rpc("get_shared_appearance");
        if (disposed || version !== requestVersion) return;
        if (result.error) throw new Error(result.error.message);
        setSharedAppearance(userId, normalizeAppearance(result.data));
        applyEffectiveAppearance(userId);
      } catch (error) {
        // Keep the last confirmed appearance during transient network errors.
        console.warn("[appearance-sharing] refresh failed", error);
      }
    };

    const reconcile = () => {
      if (disposed) return;
      if (!userId || !isLegalCategoryAllowed("sync_cloud")) {
        requestVersion++;
        stopChannel();
        clear();
        return;
      }

      if (!channel) {
        const nextChannel = createPrivateRealtimeChannel("pace-appearance-share:" + userId);
        nextChannel.on("broadcast", { event: "shared_appearance_changed" }, () => {
          void refresh();
        });
        nextChannel.subscribe((status) => {
          if (disposed || channel !== nextChannel) return;
          if (status === "SUBSCRIBED") {
            void refresh();
            return;
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            channel = null;
            void supabase.removeChannel(nextChannel);
          }
        });
        channel = nextChannel;
      }
      void refresh();
    };

    const onRefresh = () => reconcile();
    const onVisible = () => {
      if (document.visibilityState === "visible") reconcile();
    };
    const reconcileTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") reconcile();
    }, 60_000);
    window.addEventListener("pace.legal.changed", reconcile);
    window.addEventListener("pace.shared-appearance.refresh", onRefresh);
    window.addEventListener("focus", reconcile);
    window.addEventListener("online", reconcile);
    document.addEventListener("visibilitychange", onVisible);
    reconcile();

    return () => {
      disposed = true;
      requestVersion++;
      window.clearInterval(reconcileTimer);
      stopChannel();
      window.removeEventListener("pace.legal.changed", reconcile);
      window.removeEventListener("pace.shared-appearance.refresh", onRefresh);
      window.removeEventListener("focus", reconcile);
      window.removeEventListener("online", reconcile);
      document.removeEventListener("visibilitychange", onVisible);
      if (userId && activeUserId === userId) {
        activeUserId = null;
        activeAppearance = null;
        emitSharedAppearanceChange();
        applyEffectiveAppearance(userId);
      }
    };
  }, [userId]);
}
