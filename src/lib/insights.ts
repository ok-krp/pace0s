/**
 * Pace — couche d'intelligence du dashboard.
 *
 * Fonctions pures (aucun React, aucun accès au DOM) : elles transforment les
 * données brutes locales en métriques contextualisées, insights, priorités et
 * recommandations croisées. Appelées dans un `useMemo` unique côté dashboard
 * pour éviter tout recalcul pendant les interactions.
 */

export type Status = "good" | "warn" | "bad" | "neutral";
export type Period = "morning" | "afternoon" | "evening" | "night";
export type ModuleKey =
  | "sleep" | "water" | "kcal" | "routine" | "focus" | "weight" | "finance";

export type SmartMetric = {
  key: ModuleKey;
  label: string;
  value: string;
  unit?: string;
  /** progression 0..1 vers l'objectif */
  pct: number;
  /** phrase de contexte principale (comparaison à la moyenne) */
  context: string;
  status: Status;
  /** 2–3 micro-lignes : objectif, restant, série, dernière mise à jour */
  detail: string[];
  /** micro-visualisation : 7 dernières valeurs */
  spark: number[];
  /** plus grand = plus urgent (tri intelligent du dashboard) */
  priority: number;
  /** succès discret (série, objectif atteint, record) */
  badge?: string;
};

export type RhythmLine = { label: string; text: string; status: Status };

export type DashboardIntel = {
  period: Period;
  greeting: string;
  score: number;
  scoreAvg: number;
  scoreDelta: number;
  rhythmSummary: string;
  rhythmLines: RhythmLine[];
  headline: string;
  headlineStatus: Status;
  metrics: SmartMetric[];
  crossInsights: { text: string; status: Status }[];
  achievements: string[];
  goalsDonePct: number;
};

export type IntelInput = {
  days: string[];               // 7 derniers jours, aujourd'hui en dernier
  today: string;
  now: Date;
  sleep: Record<string, { hours: number } | undefined>;
  water: Record<string, number | undefined>;
  waterLog: Record<string, number[] | undefined>; // timestamps ms par jour
  nutrition: Record<string, { kcal: number } | undefined>;
  routineDone: Record<string, string[] | undefined>;
  routineTotal: number;
  work: Record<string, number | undefined>;
  weights: Record<string, { w: number } | undefined>;
  tx: Array<{ date: string; amount: number; cat?: string }>;
  goals: { kcal: number; waterMl: number; weightGoalKg: number | null };
  steps: number;
  kcalActive: number;
};

// ---------- helpers ----------

const avgOf = (xs: number[]) => {
  const v = xs.filter((x) => x > 0);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Série de jours consécutifs (aujourd'hui inclus s'il est validé). */
function streak(days: string[], ok: (d: string) => boolean) {
  let n = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (ok(days[i])) n++;
    else if (i !== days.length - 1) break;
    else continue; // aujourd'hui pas encore validé : on regarde la veille
  }
  return n;
}

function deltaText(delta: number, unit: string, digits = 0) {
  const s = delta > 0 ? "↑ +" : delta < 0 ? "↓ −" : "→ ";
  return `${s}${Math.abs(delta).toFixed(digits)}${unit}`;
}

function periodOf(now: Date): Period {
  const h = now.getHours();
  if (h < 5) return "night";
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

function ago(ms: number, now: number) {
  const m = Math.round((now - ms) / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  return `il y a ${h}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}`;
}

export function scoreFor(i: IntelInput, d: string) {
  const s = i.sleep[d]?.hours ?? 0;
  const w = i.water[d] ?? 0;
  const k = i.nutrition[d]?.kcal ?? 0;
  const r = (i.routineDone[d] ?? []).length;
  const wm = i.work[d] ?? 0;
  return Math.round(
    clamp01(s / 8) * 20 +
      clamp01(w / i.goals.waterMl) * 15 +
      clamp01(k / i.goals.kcal) * 15 +
      clamp01(r / Math.max(i.routineTotal, 1)) * 30 +
      clamp01(wm / 240) * 20,
  );
}

// ---------- moteur ----------

export function buildIntel(i: IntelInput): DashboardIntel {
  const { today, days } = i;
  const past = days.slice(0, -1);
  const period = periodOf(i.now);
  const nowMs = i.now.getTime();

  // --- valeurs du jour
  const sleepH = i.sleep[today]?.hours ?? 0;
  const waterMl = i.water[today] ?? 0;
  const kcal = i.nutrition[today]?.kcal ?? 0;
  const routineDone = (i.routineDone[today] ?? []).length;
  const routineTotal = Math.max(i.routineTotal, 1);
  const workMin = i.work[today] ?? 0;

  // --- moyennes 6 jours précédents
  const sleepAvg = avgOf(past.map((d) => i.sleep[d]?.hours ?? 0));
  const waterAvg = avgOf(past.map((d) => i.water[d] ?? 0));
  const kcalAvg = avgOf(past.map((d) => i.nutrition[d]?.kcal ?? 0));
  const workAvg = avgOf(past.map((d) => i.work[d] ?? 0));

  const score = scoreFor(i, today);
  const scoreAvg = Math.round(avgOf(past.map((d) => scoreFor(i, d))));
  const scoreDelta = scoreAvg ? score - scoreAvg : 0;

  // --- sommeil
  const sleepDeltaMin = sleepAvg ? Math.round((sleepH - sleepAvg) * 60) : 0;
  const recovery: Status =
    sleepH === 0 ? "neutral" : sleepH >= 7.5 ? "good" : sleepH >= 6.5 ? "warn" : "bad";
  const recoveryLabel =
    recovery === "good" ? "Récupération excellente"
    : recovery === "warn" ? "Récupération correcte"
    : recovery === "bad" ? "Récupération insuffisante"
    : "Nuit non renseignée";

  // --- eau
  const waterLeft = Math.max(0, i.goals.waterMl - waterMl);
  const drinks = i.waterLog[today] ?? [];
  const lastDrink = drinks.length ? drinks[drinks.length - 1] : null;
  const waterStreak = streak(days, (d) => (i.water[d] ?? 0) >= i.goals.waterMl);

  // --- nutrition
  const kcalLeft = i.goals.kcal - kcal;
  const burned = i.kcalActive;
  const kcalTarget = i.goals.kcal + (burned > 250 ? Math.round(burned * 0.6) : 0);

  // --- poids
  const wSeries = days.map((d) => i.weights[d]?.w ?? 0);
  const weightVals = Object.entries(i.weights)
    .filter(([, v]) => v?.w)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  const lastWeight = weightVals.length ? weightVals[weightVals.length - 1][1]!.w : null;
  const prevWeight = weightVals.length > 1 ? weightVals[weightVals.length - 2][1]!.w : null;
  const weightDelta = lastWeight != null && prevWeight != null ? lastWeight - prevWeight : 0;

  // --- finance
  const spendOf = (d: string) =>
    i.tx.filter((t) => t.date === d && t.amount < 0).reduce((s, t) => s + -t.amount, 0);
  const todaySpend = spendOf(today);
  const todayIncome = i.tx.filter((t) => t.date === today && t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const spendAvg = avgOf(past.map(spendOf));
  const overBudget = spendAvg > 0 && todaySpend > spendAvg * 1.25;

  // --- routine
  const routineStreak = streak(days, (d) => (i.routineDone[d] ?? []).length >= routineTotal && routineTotal > 0);
  const routinePct = clamp01(routineDone / routineTotal);

  // --- focus
  const focusPct = clamp01(workMin / 240);

  const metrics: SmartMetric[] = [
    {
      key: "sleep",
      label: "Sommeil",
      value: sleepH ? sleepH.toFixed(1) : "—",
      unit: sleepH ? "h" : undefined,
      pct: clamp01(sleepH / 8),
      status: recovery,
      context: sleepAvg
        ? `${deltaText(sleepDeltaMin, " min")} vs ta moyenne`
        : "Première nuit enregistrée",
      detail: [
        recoveryLabel,
        sleepAvg ? `Moyenne 7 j · ${sleepAvg.toFixed(1)}h` : "Objectif · 8h",
      ],
      spark: days.map((d) => i.sleep[d]?.hours ?? 0),
      priority: sleepH === 0 ? 70 : recovery === "bad" ? 90 : recovery === "warn" ? 55 : 20,
    },
    {
      key: "water",
      label: "Hydratation",
      value: (waterMl / 1000).toFixed(1),
      unit: "L",
      pct: clamp01(waterMl / i.goals.waterMl),
      status: waterLeft === 0 ? "good" : waterMl > i.goals.waterMl * 0.5 ? "warn" : "bad",
      context: waterLeft === 0
        ? "Objectif atteint"
        : `Reste ${(waterLeft / 1000).toFixed(1)} L à boire`,
      detail: [
        `Objectif · ${(i.goals.waterMl / 1000).toFixed(1)} L`,
        lastDrink ? `Dernier verre ${ago(lastDrink, nowMs)}` : `Moyenne · ${(waterAvg / 1000).toFixed(1)} L`,
        waterStreak > 1 ? `Série ${waterStreak} j` : "",
      ].filter(Boolean),
      spark: days.map((d) => (i.water[d] ?? 0) / 1000),
      priority: waterLeft === 0 ? 15 : period === "morning" ? 80 : waterLeft > i.goals.waterMl * 0.6 ? 85 : 50,
      badge: waterStreak >= 6 ? `Série ${waterStreak} jours` : undefined,
    },
    {
      key: "kcal",
      label: "Calories",
      value: String(kcal),
      unit: `/ ${kcalTarget} kcal`,
      pct: clamp01(kcal / kcalTarget),
      status: kcal === 0 ? "bad" : kcal > kcalTarget * 1.1 ? "warn" : kcal > kcalTarget * 0.8 ? "good" : "warn",
      context: kcalLeft > 0
        ? `${kcalLeft} kcal restantes aujourd'hui`
        : `${Math.abs(kcalLeft)} kcal au-dessus de la cible`,
      detail: [
        kcalAvg ? `Moyenne 7 j · ${Math.round(kcalAvg)} kcal` : `Objectif · ${i.goals.kcal} kcal`,
        burned > 250 ? `Cible ajustée · +${Math.round(burned * 0.6)} kcal (sport)` : "",
      ].filter(Boolean),
      spark: days.map((d) => i.nutrition[d]?.kcal ?? 0),
      priority: kcal === 0 && period !== "morning" ? 88 : kcal < kcalTarget * 0.6 ? 60 : 25,
    },
    {
      key: "routine",
      label: "Routine",
      value: `${routineDone}/${routineTotal}`,
      pct: routinePct,
      status: routinePct === 1 ? "good" : routinePct >= 0.5 ? "warn" : "bad",
      context: routinePct === 1
        ? "Toutes tes habitudes sont faites"
        : `${routineTotal - routineDone} habitude${routineTotal - routineDone > 1 ? "s" : ""} en attente`,
      detail: [
        routineStreak > 1 ? `Série ${routineStreak} j` : "Objectif · 100 %",
        period === "evening" && routinePct < 1 ? "Dernier moment pour compléter" : "",
      ].filter(Boolean),
      spark: days.map((d) => (i.routineDone[d] ?? []).length),
      priority: routinePct === 1 ? 10 : period === "evening" ? 92 : 45,
      badge: routineStreak >= 7 ? `Série ${routineStreak} jours` : undefined,
    },
    {
      key: "focus",
      label: "Focus",
      value: `${Math.floor(workMin / 60)}h ${String(workMin % 60).padStart(2, "0")}`,
      pct: focusPct,
      status: focusPct >= 0.9 ? "good" : focusPct >= 0.5 ? "warn" : "bad",
      context: workAvg
        ? `${deltaText(Math.round(workMin - workAvg), " min")} vs ta moyenne`
        : "Objectif · 4h de concentration",
      detail: [
        `Reste ${Math.max(0, 240 - workMin)} min pour l'objectif`,
        workAvg ? `Moyenne 7 j · ${Math.round(workAvg)} min` : "",
      ].filter(Boolean),
      spark: days.map((d) => i.work[d] ?? 0),
      priority: period === "afternoon" && focusPct < 0.7 ? 75 : focusPct >= 0.9 ? 12 : 35,
    },
    {
      key: "weight",
      label: "Poids",
      value: lastWeight != null ? lastWeight.toFixed(1) : "—",
      unit: lastWeight != null ? "kg" : undefined,
      pct: i.goals.weightGoalKg && lastWeight
        ? clamp01(1 - Math.abs(lastWeight - i.goals.weightGoalKg) / Math.max(lastWeight, 1))
        : 0,
      status: weightDelta === 0 ? "neutral" : weightDelta < 0 ? "good" : "warn",
      context: prevWeight != null
        ? `${deltaText(weightDelta, " kg", 1)} depuis la dernière pesée`
        : "Ajoute une première pesée",
      detail: [
        i.goals.weightGoalKg ? `Objectif · ${i.goals.weightGoalKg} kg` : "",
        i.goals.weightGoalKg && lastWeight
          ? `Écart · ${Math.abs(lastWeight - i.goals.weightGoalKg).toFixed(1)} kg`
          : "",
      ].filter(Boolean),
      spark: wSeries,
      priority: 18,
    },
    {
      key: "finance",
      label: "Finances",
      value: `${(todayIncome - todaySpend).toFixed(0)}€`,
      pct: spendAvg ? clamp01(todaySpend / (spendAvg * 1.5)) : 0,
      status: overBudget ? "bad" : todaySpend > 0 ? "warn" : "good",
      context: overBudget
        ? `Dépenses ${Math.round((todaySpend / Math.max(spendAvg, 1) - 1) * 100)} % au-dessus de ta moyenne`
        : spendAvg ? `Moyenne quotidienne · ${spendAvg.toFixed(0)}€` : "Aucune dépense enregistrée",
      detail: [
        `Entrées · +${todayIncome.toFixed(0)}€`,
        `Sorties · −${todaySpend.toFixed(0)}€`,
      ],
      spark: days.map(spendOf),
      priority: overBudget ? 86 : 22,
    },
  ];

  // --- rythme expliqué
  const rhythmLines: RhythmLine[] = [
    { label: "Récupération", text: sleepH ? `${sleepH.toFixed(1)}h · ${recoveryLabel.toLowerCase()}` : "Nuit non renseignée", status: recovery },
    { label: "Hydratation", text: waterLeft === 0 ? "Objectif atteint" : `${(waterMl / 1000).toFixed(1)} L sur ${(i.goals.waterMl / 1000).toFixed(1)} L`, status: waterLeft === 0 ? "good" : waterMl > i.goals.waterMl / 2 ? "warn" : "bad" },
    { label: "Nutrition", text: kcalLeft > 0 ? `${kcal} kcal · légèrement sous la cible` : `${kcal} kcal · cible atteinte`, status: kcalLeft > i.goals.kcal * 0.4 ? "warn" : "good" },
    { label: "Routine", text: `${routineDone} sur ${routineTotal} complétée${routineDone > 1 ? "s" : ""}`, status: routinePct === 1 ? "good" : routinePct >= 0.5 ? "warn" : "bad" },
    { label: "Focus", text: `${Math.floor(workMin / 60)}h ${String(workMin % 60).padStart(2, "0")} de concentration`, status: focusPct >= 0.9 ? "good" : focusPct >= 0.5 ? "warn" : "bad" },
  ];

  const goodCount = rhythmLines.filter((l) => l.status === "good").length;
  const rhythmSummary =
    score >= 85 ? "Journée maîtrisée"
    : score >= 65 ? "Bon rythme, quelques ajustements"
    : score >= 40 ? "Rythme en construction"
    : "Journée à relancer";

  // --- insights croisés (le système pense globalement)
  const cross: { text: string; status: Status }[] = [];
  if (recovery === "bad") cross.push({ text: "Nuit courte : privilégie une séance légère et allonge la récupération.", status: "warn" });
  if (recovery === "good" && routinePct > 0.5) cross.push({ text: "Bonne récupération : c'est le moment idéal pour une séance intense.", status: "good" });
  if (waterLeft === 0 && focusPct < 0.9) cross.push({ text: "Hydratation optimale : ta concentration devrait rester stable cet après-midi.", status: "good" });
  if (burned > 300) cross.push({ text: `${burned} kcal dépensées : ta cible nutritionnelle a été relevée automatiquement.`, status: "good" });
  if (overBudget) cross.push({ text: "Budget dépassé aujourd'hui : limite les dépenses non essentielles d'ici demain.", status: "bad" });
  if (kcal > 0 && kcal < i.goals.kcal * 0.5 && period === "evening") cross.push({ text: "Apport faible en fin de journée : un repas complet aidera la récupération nocturne.", status: "warn" });
  if (i.steps > 9000) cross.push({ text: `${i.steps.toLocaleString("fr-FR")} pas : excellente activité de fond.`, status: "good" });

  // --- succès discrets
  const achievements: string[] = [];
  if (waterStreak >= 3) achievements.push(`Hydratation · ${waterStreak} jours`);
  if (routineStreak >= 3) achievements.push(`Routine · ${routineStreak} jours`);
  if (score >= 90) achievements.push("Rythme > 90");
  if (lastWeight != null && i.goals.weightGoalKg && Math.abs(lastWeight - i.goals.weightGoalKg) < 0.3) achievements.push("Objectif de poids atteint");
  if (!overBudget && todaySpend > 0 && spendAvg > 0) achievements.push("Budget respecté");

  const goalsDonePct = Math.round(
    ((clamp01(sleepH / 8) + clamp01(waterMl / i.goals.waterMl) + clamp01(kcal / kcalTarget) + routinePct + focusPct) / 5) * 100,
  );

  // --- insight principal, priorisé
  let headline = `Tu as complété ${goalsDonePct} % de tes objectifs du jour.`;
  let headlineStatus: Status = goalsDonePct >= 75 ? "good" : "neutral";
  if (recovery === "bad") {
    headline = `Nuit de ${sleepH.toFixed(1)}h : allège ta journée et vise un coucher plus tôt.`;
    headlineStatus = "bad";
  } else if (overBudget) {
    headline = `Tes dépenses du jour dépassent ta moyenne de ${Math.round((todaySpend / Math.max(spendAvg, 1) - 1) * 100)} %.`;
    headlineStatus = "bad";
  } else if (waterLeft > i.goals.waterMl * 0.6 && period !== "morning") {
    headline = `Il te reste ${(waterLeft / 1000).toFixed(1)} L d'eau à boire aujourd'hui.`;
    headlineStatus = "warn";
  } else if (sleepDeltaMin >= 20) {
    headline = `Tu as dormi ${sleepDeltaMin} minutes de plus que d'habitude.`;
    headlineStatus = "good";
  } else if (period === "evening" && routinePct < 1) {
    headline = `${routineTotal - routineDone} habitude${routineTotal - routineDone > 1 ? "s" : ""} à boucler avant la fin de journée.`;
    headlineStatus = "warn";
  } else if (goodCount >= 4) {
    headline = "Excellente journée : tous tes indicateurs sont dans le vert.";
    headlineStatus = "good";
  }

  const greeting =
    period === "morning" ? "Bonjour"
    : period === "afternoon" ? "Bon après-midi"
    : period === "evening" ? "Bonsoir"
    : "Bonne nuit";

  // Priorisation contextuelle : l'urgent d'abord, l'accompli en bas.
  const ordered = [...metrics].sort((a, b) => b.priority - a.priority);

  return {
    period,
    greeting,
    score,
    scoreAvg,
    scoreDelta,
    rhythmSummary,
    rhythmLines,
    headline,
    headlineStatus,
    metrics: ordered,
    crossInsights: cross.slice(0, 3),
    achievements: achievements.slice(0, 3),
    goalsDonePct,
  };
}

export const statusColor: Record<Status, string> = {
  good: "var(--success)",
  warn: "var(--warning)",
  bad: "var(--destructive)",
  neutral: "var(--muted-foreground)",
};
