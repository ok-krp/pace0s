import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PLAN_CATALOG, PLAN_AI_LIMITS, hasActivePaidEntitlement } from "./billing";

const deviceSchema = z.object({ deviceId: z.string().min(16).max(200) });

const checkoutSchema = z.object({
  plan: z.enum(["plus", "pro", "coach"]),
  interval: z.enum(["monthly", "annual"]).default("monthly"),
});

export const getBillingStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => deviceSchema.parse(data))
  .handler(async ({ data, context }) => {
    /*
    const { ensureTrial } = await import("./billing.server");
    const trial = await ensureTrial(context.userId, data.deviceId, context.supabase);
    */
    const { data: subscription } = await context.supabase
      .from("billing_subscriptions")
      .select("plan,status,current_period_end,cancel_at_period_end")
      .eq("user_id", context.userId)
      .maybeSingle();

    const entitledPlan = hasActivePaidEntitlement(
      subscription?.plan,
      subscription?.status,
      subscription?.current_period_end,
    ) ? subscription.plan : null;
    const trialActive = false;
    const effectivePlan = entitledPlan ?? "expired";

    return {
      plan: effectivePlan,
      status: subscription?.status ?? "expired",
      currentPeriodEnd: subscription?.current_period_end ?? null,
      cancelAtPeriodEnd: subscription?.cancel_at_period_end ?? false,
      aiMonthlyLimit: entitledPlan ? PLAN_AI_LIMITS[entitledPlan] : PLAN_AI_LIMITS.expired,
      catalog: PLAN_CATALOG,
      stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
      trialEndsAt: null,
      trialActive,
    };
  });

export const createBillingCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => checkoutSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { createBillingCheckoutForUser } = await import("./billing.server");
    const { data: authData } = await context.supabase.auth.getUser();
    return createBillingCheckoutForUser(context.userId, authData.user?.email, data, context.supabase);
  });

export const createBillingPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { createBillingPortalForUser } = await import("./billing.server");
    const { data: authData } = await context.supabase.auth.getUser();
    return createBillingPortalForUser(context.userId, authData.user?.email, context.supabase);
  });
