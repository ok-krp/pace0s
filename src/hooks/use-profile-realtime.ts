import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

const DEVICE_KEY = "pace.__sync_device_id";
const PROFILE_REMOTE_EVENT = "pace.profile.remote";

function getDeviceId() {
  if (typeof window === "undefined") return "server";
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return `${Date.now()}-${Math.random()}`;
  }
}

export type RemoteProfile = Record<string, unknown> & {
  user_id?: string;
  updated_at?: string;
  updated_by?: string | null;
};

export function useProfileRealtime() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    const deviceId = getDeviceId();
    const channel = supabase
      .channel(`pace-profile-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "profiles", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const row = payload.new as RemoteProfile;
          if (row.updated_by === deviceId) return;
          window.dispatchEvent(new CustomEvent(PROFILE_REMOTE_EVENT, { detail: row }));
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const row = payload.new as RemoteProfile;
          if (row.updated_by === deviceId) return;
          window.dispatchEvent(new CustomEvent(PROFILE_REMOTE_EVENT, { detail: row }));
        },
      );

    void channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user]);
}

export { PROFILE_REMOTE_EVENT };
