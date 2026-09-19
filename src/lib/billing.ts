export const PLAN_CATALOG = {
  plus: { name: "Plus", monthly: 4.99, annual: 49, description: "Le quotidien complet de Pace.", features: ["Tous les modules essentiels", "Synchronisation cloud", "IA locale quand disponible", "IA Pace Cloud : 60 actions/mois", "Historique illimité", "Automatisations avancées"] },
  pro: { name: "Pro", monthly: 19.99, annual: 199, description: "Pour un usage intensif et les analyses avancées.", features: ["Tout Plus", "IA Pace Cloud : 250 actions/mois", "Analyse nutrition avancée", "Priorité sur les nouvelles fonctions"] },
  coach: { name: "Coach", monthly: 39.99, annual: 399, description: "Pour les usages avancés, partagés et familiaux.", features: ["Tout Pro", "IA Pace Cloud : 750 actions/mois", "Espaces et programmes partagés", "Fonctions coach / famille"] },
} as const;
export type PlanId = keyof typeof PLAN_CATALOG;
export type EntitlementPlan = "trial" | PlanId | "expired";
export const PLAN_PRICE_ENV: Record<PlanId, { monthly: string; annual: string }> = {
  plus: { monthly: "STRIPE_PRICE_PLUS_MONTHLY", annual: "STRIPE_PRICE_PLUS_ANNUAL" },
  pro: { monthly: "STRIPE_PRICE_PRO_MONTHLY", annual: "STRIPE_PRICE_PRO_ANNUAL" },
  coach: { monthly: "STRIPE_PRICE_COACH_MONTHLY", annual: "STRIPE_PRICE_COACH_ANNUAL" },
};
export const PLAN_AI_LIMITS: Record<EntitlementPlan, number> = { trial: 20, plus: 60, pro: 250, coach: 750, expired: 0 };
export function planFromPriceId(priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null;
  for (const [plan, ids] of Object.entries(PLAN_PRICE_ENV)) if (process.env[ids.monthly] === priceId || process.env[ids.annual] === priceId) return plan as PlanId;
  return null;
}
export function isPaidPlan(plan: EntitlementPlan): plan is PlanId { return plan === "plus" || plan === "pro" || plan === "coach"; }
