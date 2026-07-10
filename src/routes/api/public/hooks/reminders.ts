import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

type ReminderRow = {
  user_id: string;
  type: "hydration" | "sleep" | "protein" | "daily_summary" | "inactivity";
  enabled: boolean;
  time_local: string | null;
  timezone: string;
  threshold: number | null;
};

const DEFAULT_TIMES: Record<ReminderRow["type"], string | null> = {
  hydration: "14:00",
  sleep: "22:30",
  protein: "20:00",
  daily_summary: "21:00",
  inactivity: null, // checked any time
};

const ANTI_DUP_HOURS: Record<ReminderRow["type"], number> = {
  hydration: 4,
  sleep: 20,
  protein: 20,
  daily_summary: 20,
  inactivity: 24,
};

function getLocalParts(tz: string): { hh: number; mm: number; date: string } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return {
    hh: Number(parts.hour),
    mm: Number(parts.minute),
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function withinWindow(target: string | null, hh: number, mm: number): boolean {
  if (!target) return true;
  const [th, tm] = target.split(":").map(Number);
  const nowMin = hh * 60 + mm;
  const tgtMin = th * 60 + tm;
  const diff = nowMin - tgtMin;
  return diff >= 0 && diff < 15; // 15-min slot starting at target
}

async function alreadySent(userId: string, type: string, hours: number): Promise<boolean> {
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const { data } = await supabaseAdmin
    .from("notification_log")
    .select("id")
    .eq("user_id", userId)
    .eq("type", type)
    .gte("sent_at", since)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

async function logDebug(entry: {
  user_id: string;
  type: string;
  status: "sent" | "skipped" | "error";
  reason?: string;
  trigger?: string;
  target_segment?: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    await supabaseAdmin.from("reminder_debug_log").insert({
      user_id: entry.user_id,
      type: entry.type,
      status: entry.status,
      reason: entry.reason ?? null,
      trigger: entry.trigger ?? "pg_cron",
      target_segment: entry.target_segment ?? null,
      payload: (entry.payload ?? {}) as never,
    });
  } catch (e) {
    console.error("logDebug failed", e);
  }
}

async function sendPush(
  userId: string,
  type: string,
  title: string,
  message: string,
): Promise<{ ok: boolean; reason?: string; segment: string }> {
  const segment = `external_id:${userId}`;
  const appId = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey) {
    console.error("OneSignal not configured");
    return { ok: false, reason: "OneSignal non configuré", segment };
  }
  const res = await fetch("https://onesignal.com/api/v1/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Basic ${apiKey}`,
    },
    body: JSON.stringify({
      app_id: appId,
      include_aliases: { external_id: [userId] },
      target_channel: "push",
      headings: { en: title, fr: title },
      contents: { en: message, fr: message },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("OneSignal send failed", res.status, body);
    return { ok: false, reason: `OneSignal ${res.status}: ${body.slice(0, 120)}`, segment };
  }
  await supabaseAdmin
    .from("notification_log")
    .insert({ user_id: userId, type, payload: { title, message } });
  return { ok: true, segment };
}

async function buildMessage(
  row: ReminderRow,
  todayDate: string,
): Promise<{ title: string; message: string } | null> {
  switch (row.type) {
    case "hydration":
      return { title: "💧 Hydratation", message: "Pense à boire un grand verre d'eau maintenant." };
    case "sleep":
      return { title: "🌙 Sommeil", message: "C'est bientôt l'heure de te coucher — prépare ta routine du soir." };
    case "protein": {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("daily_protein_goal")
        .eq("user_id", row.user_id)
        .maybeSingle();
      const goal = profile?.daily_protein_goal ?? 140;
      const { data: meals } = await supabaseAdmin
        .from("food_log")
        .select("protein_g")
        .eq("user_id", row.user_id)
        .eq("log_date", todayDate);
      const total = (meals ?? []).reduce((s, m) => s + Number(m.protein_g || 0), 0);
      const threshold = row.threshold ?? 0.7;
      if (total >= goal * threshold) return null;
      const missing = Math.max(0, Math.round(goal - total));
      return {
        title: "🥩 Protéines",
        message: `Il te manque ~${missing}g pour atteindre ton objectif (${Math.round(total)}/${goal}g).`,
      };
    }
    case "daily_summary": {
      const { data: meals } = await supabaseAdmin
        .from("food_log")
        .select("kcal, protein_g, carbs_g, fat_g")
        .eq("user_id", row.user_id)
        .eq("log_date", todayDate);
      const totals = (meals ?? []).reduce(
        (s, m) => ({
          kcal: s.kcal + Number(m.kcal || 0),
          p: s.p + Number(m.protein_g || 0),
          c: s.c + Number(m.carbs_g || 0),
          f: s.f + Number(m.fat_g || 0),
        }),
        { kcal: 0, p: 0, c: 0, f: 0 },
      );
      return {
        title: "📊 Résumé du jour",
        message: `${Math.round(totals.kcal)} kcal · P${Math.round(totals.p)} C${Math.round(totals.c)} F${Math.round(totals.f)}`,
      };
    }
    case "inactivity": {
      const { data: last } = await supabaseAdmin
        .from("food_log")
        .select("created_at")
        .eq("user_id", row.user_id)
        .order("created_at", { ascending: false })
        .limit(1);
      const lastTs = last?.[0]?.created_at ? new Date(last[0].created_at).getTime() : 0;
      const hoursSince = (Date.now() - lastTs) / 3600_000;
      if (hoursSince < 36) return null;
      return {
        title: "😴 On t'a perdu ?",
        message: "Reviens logger un repas ou un verre d'eau pour garder ton streak.",
      };
    }
  }
}

export const Route = createFileRoute("/api/public/hooks/reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided =
          request.headers.get("x-webhook-secret") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        const expected = process.env.REMINDER_WEBHOOK_SECRET;
        if (!expected || !provided || !safeEqual(provided, expected)) {
          return new Response("Unauthorized", { status: 401 });
        }
        const trigger = request.headers.get("x-trigger") ?? "pg_cron";

        const { data: rows, error } = await supabaseAdmin
          .from("reminder_settings")
          .select("user_id, type, enabled, time_local, timezone, threshold")
          .eq("enabled", true);
        if (error) {
          console.error("read settings failed", error);
          return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
        }

        let sent = 0;
        let skipped = 0;
        for (const row of (rows ?? []) as ReminderRow[]) {
          try {
            const tz = row.timezone || "Europe/Paris";
            const { hh, mm, date } = getLocalParts(tz);
            const target = row.time_local ?? DEFAULT_TIMES[row.type];
            const segment = `external_id:${row.user_id}`;
            if (!withinWindow(target, hh, mm)) {
              skipped++;
              await logDebug({ user_id: row.user_id, type: row.type, status: "skipped", trigger, target_segment: segment, reason: `Hors fenêtre (cible ${target ?? "—"}, local ${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")})` });
              continue;
            }
            if (await alreadySent(row.user_id, row.type, ANTI_DUP_HOURS[row.type])) {
              skipped++;
              await logDebug({ user_id: row.user_id, type: row.type, status: "skipped", trigger, target_segment: segment, reason: `Anti-doublon (déjà envoyé <${ANTI_DUP_HOURS[row.type]}h)` });
              continue;
            }
            const msg = await buildMessage(row, date);
            if (!msg) {
              skipped++;
              await logDebug({ user_id: row.user_id, type: row.type, status: "skipped", trigger, target_segment: segment, reason: "Condition non remplie (objectif atteint ou pas de données)" });
              continue;
            }
            const res = await sendPush(row.user_id, row.type, msg.title, msg.message);
            if (res.ok) {
              sent++;
              await logDebug({ user_id: row.user_id, type: row.type, status: "sent", trigger, target_segment: res.segment, payload: { title: msg.title, message: msg.message } });
            } else {
              skipped++;
              await logDebug({ user_id: row.user_id, type: row.type, status: "error", trigger, target_segment: res.segment, reason: res.reason, payload: { title: msg.title, message: msg.message } });
            }
          } catch (e) {
            console.error("reminder loop error", row.user_id, row.type, e);
            await logDebug({ user_id: row.user_id, type: row.type, status: "error", trigger, reason: (e as Error).message });
          }
        }

        return Response.json({ ok: true, sent, skipped, scanned: rows?.length ?? 0, trigger });
      },
      GET: async () =>
        new Response(JSON.stringify({ error: "Method not allowed" }), {
          status: 405,
          headers: { "content-type": "application/json", Allow: "POST" },
        }),
    },
  },
});
