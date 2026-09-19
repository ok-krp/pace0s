/*
Legacy paid catalog kept here for reference during the pricing migration.
export const PLAN_CATALOG_LEGACY = {
  plus: { name: "Plus", monthly: 4.99, annual: 49 },
  pro: { name: "Pro", monthly: 19.99, annual: 199 },
  coach: { name: "Coach", monthly: 39.99, annual: 399 },
} as const;
*/
export const PLAN_CATALOG = {
  plus: { name: "Pace Essential", monthly: 9.99, annual: 99, description: "L’OS quotidien complet.", features: ["Accès complet aux 8 modules", "Synchro automatique Bluetooth & Apple Health / Google Fit", "Historique et sauvegardes illimités"] },
  pro: { name: "Pace Pro", monthly: 19.99, annual: 199, description: "Performance & IA intégrée.", features: ["Tout le plan Essential", "Coach Pace IA en temps réel", "Corrélation croisée Sommeil × Sport × Finances", "Recommandations personnalisées automatiques"] },
  coach: { name: "Pace Ultimate", monthly: 29.99, annual: 299, description: "Haute performance & accès anticipé.", features: ["Tout le plan Pro", "Accès prioritaire aux modèles IA de dernière génération", "Intégrations bancaires et agendas poussées", "Support prioritaire direct"] },
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
