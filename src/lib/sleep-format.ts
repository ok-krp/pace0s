/**
 * Formate une durée de sommeil en heures décimales (ex: 7.5) vers le format
 * lisible "7h30" — jamais "7.5h", "7,5 h" ou "450 minutes" dans l'UI. Les
 * données restent stockées en décimal, seul l'affichage change.
 */
export function formatSleepDuration(hours: number | null | undefined): string {
  if (hours == null || Number.isNaN(hours)) return "—";
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}

/** Convertit "7h30" (ou "7:30", "7") saisi par l'utilisateur en heures décimales (7.5). */
export function parseSleepDuration(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{1,2})\s*[h:]?\s*(\d{0,2})$/i);
  if (!match) {
    const n = Number(trimmed.replace(",", "."));
    return Number.isNaN(n) ? null : n;
  }
  const h = Number(match[1]);
  const m = match[2] ? Number(match[2]) : 0;
  if (Number.isNaN(h) || Number.isNaN(m) || m > 59) return null;
  return h + m / 60;
}
