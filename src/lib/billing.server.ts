import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PLAN_CATALOG, PLAN_AI_LIMITS, type PlanId, planFromPriceId } from "./billing";
import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import type { supabaseAdmin } from "@/integrations/supabase/client.server";

const stripeBase = "https://api.stripe.com/v1";

function stripeKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY n'est pas configurée.");
  return key;
}

async function stripeRequest(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const body = new URLSearchParams(params);
  const response = await fetch(`${stripeBase}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${stripeKey()}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    console.error("Stripe API error", response.status, json);
    const error = json.error as { message?: unknown } | undefined;
    throw new Error(typeof error?.message === "string" ? error.message : "Stripe est temporairement indisponible.");
  }
  return json;
}

function appUrl(): string {
  const url = process.env.APP_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!url) throw new Error("APP_URL n'est pas configurée.");
  return url.startsWith("http") ? url : `https://${url}`;
}

async function ensureCustomer(
  userId: string,
  email: string | undefined,
  supabase: typeof supabaseAdmin,
) {
  const { data: existing } = await supabase.from("billing_customers").select("stripe_customer_id").eq("user_id", userId).maybeSingle();
  if (existing?.stripe_customer_id) return existing.stripe_customer_id;
  const customer = await stripeRequest("/customers", {
    email: email ?? "",
    metadata: JSON.stringify({ pace_user_id: userId }),
  });
  const customerId = String(customer.id);
  const { error } = await supabase.from("billing_customers").upsert({
    user_id: userId,
    stripe_customer_id: customerId,
    email: email ?? null,
  });
  if (error) throw new Error("Impossible d'enregistrer le client de facturation.");
  return customerId;
}

const trialSchema = z.object({ deviceId: z.string().min(16).max(200) });

function hashDeviceId(deviceId: string): string {
  const secret = process.env.PACE_BYOK_ENCRYPTION_KEY ?? process.env.SUPABASE_SECRET_KEY ?? "pace-trial-salt";
  return createHash("sha256").update(`${secret}:${deviceId}`).digest("hex");
}

export async function ensureTrial(userId: string, deviceId: string, supabase: typeof supabaseAdmin) {
  const { data: existing } = await supabase.from("billing_trials").select("trial_started_at,trial_ends_at,device_hash").eq("user_id", userId).maybeSingle();
  if (existing) return existing;
  const deviceHash = hashDeviceId(deviceId);
  const now = new Date();
  const ends = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const { data, error } = await supabase.from("billing_trials").insert({ user_id: userId, device_hash: deviceHash, trial_started_at: now.toISOString(), trial_ends_at: ends.toISOString() }).select("trial_started_at,trial_ends_at,device_hash").single();
  if (error) {
    const { data: byDevice } = await supabase.from("billing_trials").select("user_id,trial_started_at,trial_ends_at,device_hash").eq("device_hash", deviceHash).maybeSingle();
    if (byDevice && byDevice.user_id !== userId) throw new Error("Cet appareil a déjà utilisé l’essai gratuit de Pace.");
    const { data: retry } = await supabase.from("billing_trials").select("trial_started_at,trial_ends_at,device_hash").eq("user_id", userId).maybeSingle();
    if (retry) return retry;
    throw new Error("Impossible d’activer l’essai gratuit.");
  }
  return data;
}

const checkoutSchema = z.object({
  plan: z.enum(["plus", "pro", "coach"]),
  interval: z.enum(["monthly", "annual"]).default("monthly"),
});

export async function createBillingCheckoutForUser(
  userId: string,
  email: string | undefined,
  data: z.infer<typeof checkoutSchema>,
  supabase: typeof supabaseAdmin,
) {
  const prefix = data.plan === "plus" ? "STRIPE_PRICE_PLUS" : data.plan === "pro" ? "STRIPE_PRICE_PRO" : "STRIPE_PRICE_COACH";
  const priceId = process.env[`${prefix}_${data.interval === "monthly" ? "MONTHLY" : "ANNUAL"}`];
  if (!priceId) throw new Error("Ce plan n'est pas encore activé côté paiement.");
  const customerId = await ensureCustomer(userId, email, supabase);
  const { data: trial } = await supabase.from("billing_trials").select("trial_ends_at").eq("user_id", userId).maybeSingle();
  const trialEnd = trial?.trial_ends_at ? Math.floor(new Date(trial.trial_ends_at).getTime() / 1000) : null;
  const checkoutParams: Record<string, string> = {
    mode: "subscription", customer: customerId, "line_items[0][price]": priceId, "line_items[0][quantity]": "1",
    success_url: `${appUrl()}/settings?billing=success`, cancel_url: `${appUrl()}/settings?billing=cancelled`, client_reference_id: userId,
    "subscription_data[metadata][pace_user_id]": userId, "subscription_data[metadata][pace_plan]": data.plan,
    payment_method_collection: "always",
  };
  if (trialEnd && trialEnd > Math.floor(Date.now() / 1000) + 60) checkoutParams["subscription_data[trial_end]"] = String(trialEnd);
  const session = await stripeRequest("/checkout/sessions", checkoutParams);
  return { url: String(session.url) };
}

export async function createBillingPortalForUser(
  userId: string,
  email: string | undefined,
  supabase: typeof supabaseAdmin,
) {
  const customerId = await ensureCustomer(userId, email, supabase);
  const session = await stripeRequest("/billing_portal/sessions", {
    customer: customerId,
    return_url: `${appUrl()}/settings?tab=subscription`,
  });
  return { url: String(session.url) };
}

export async function applyStripeSubscription(
  supabase: typeof supabaseAdmin,
  subscription: {
    id: string;
    customer: string;
    status: string;
    cancel_at_period_end: boolean;
    current_period_end?: number | null;
    items?: { data?: Array<{ price?: { id?: string | null } }> };
    metadata?: Record<string, string>;
  },
) {
  const priceId = subscription.items?.data?.[0]?.price?.id;
  const plan = (subscription.metadata?.pace_plan as PlanId | undefined) ?? planFromPriceId(priceId);
  const safePlan: PlanId = plan && plan in PLAN_CATALOG ? plan : "plus";
  let userId = subscription.metadata?.pace_user_id;
  if (!userId) {
    const { data } = await supabase.from("billing_customers").select("user_id").eq("stripe_customer_id", subscription.customer).maybeSingle();
    userId = data?.user_id;
  }
  if (!userId) throw new Error("Stripe subscription sans utilisateur Pace.");
  await supabase.from("billing_subscriptions").upsert({
    user_id: userId,
    stripe_subscription_id: subscription.id,
    stripe_customer_id: subscription.customer,
    plan: safePlan,
    status: subscription.status,
    current_period_end: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
    cancel_at_period_end: subscription.cancel_at_period_end,
  });
}

export function verifyStripeSignature(payload: string, signature: string, secret: string): boolean {
  const parts = signature.split(",").reduce<Record<string, string[]>>((acc, part) => {
    const [key, value] = part.split("=", 2);
    if (key && value) (acc[key] ??= []).push(value);
    return acc;
  }, {});
  const timestamp = Number(parts.t?.[0] ?? 0);
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return (parts.v1 ?? []).some((candidate) => {
    const a = Buffer.from(candidate, "utf8");
    const b = Buffer.from(expected, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  });
}
