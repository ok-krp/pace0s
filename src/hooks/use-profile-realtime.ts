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
    const channelName = `pace-profile-${user.id}`;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    let cancelled = false;

    const dispatchRemote = (payload: { new: unknown }) => {
      const row = payload.new as RemoteProfile;
      if (row.updated_by === deviceId) return;
      window.dispatchEvent(new CustomEvent(PROFILE_REMOTE_EVENT, { detail: row }));
    };

    const scheduleReconnect = () => {
      if (cancelled || reconnectTimer) return;
      const delay = Math.min(30_000, 1_000 * 2 ** reconnectAttempt);
      reconnectAttempt = Math.min(reconnectAttempt + 1, 5);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void subscribe();
      }, delay);
    };

    const subscribe = async () => {
      const existing = supabase.getChannels().find((candidate) => candidate.topic === `realtime:${channelName}`);
      if (existing) await supabase.removeChannel(existing);
      if (cancelled) return;

      channel = supabase
        .channel(channelName)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "profiles", filter: `user_id=eq.${user.id}` },
          dispatchRemote,
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "profiles", filter: `user_id=eq.${user.id}` },
          dispatchRemote,
        );

      void channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          reconnectAttempt = 0;
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          scheduleReconnect();
        }
      });
    };

    void subscribe();

    return () => {
      cancelled = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (channel) void supabase.removeChannel(channel);
    };
  }, [user]);
}

export { PROFILE_REMOTE_EVENT };
