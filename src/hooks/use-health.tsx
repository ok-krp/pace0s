import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listHealthToday } from "@/lib/health.functions";
import { useAuth } from "@/hooks/use-auth";

export type HealthToday = {
  steps: number;
  kcalActive: number;
  distanceM: number;
  sleepMin: number;
  lastSource: string | null;
  lastTs: string | null;
  count: number;
};

const EMPTY: HealthToday = { steps: 0, kcalActive: 0, distanceM: 0, sleepMin: 0, lastSource: null, lastTs: null, count: 0 };

export function useHealthToday() {
  const { user } = useAuth();
  const fetchToday = useServerFn(listHealthToday);
  const [data, setData] = useState<HealthToday>(EMPTY);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) { setData(EMPTY); return; }
    setLoading(true);
    try {
      const res = await fetchToday();
      setData(res);
    } catch (e) {
      console.error("health refresh", e);
    } finally { setLoading(false); }
  }, [user, fetchToday]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const handler = () => void refresh();
    window.addEventListener("lt.health.changed", handler);
    return () => window.removeEventListener("lt.health.changed", handler);
  }, [refresh]);

  return { data, loading, refresh };
}
