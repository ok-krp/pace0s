const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_PENDING_FOOD_LOG_ROWS = 2_000;

export type FoodLogInsertRow = {
  id: string;
  user_id: string;
  log_date: string;
  meal: string;
  name: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number | null;
  sugar_g: number | null;
  sodium_mg: number | null;
  source: "manual" | "barcode" | "photo" | "recipe";
  meta: Record<string, unknown>;
};

export type FoodLogOutboxEntry = {
  id: string;
  queuedAt: string;
  row: FoodLogInsertRow;
};

export function nutritionFoodLogOutboxKey(userId: string): string {
  const normalized = userId.trim();
  if (!normalized) throw new Error("A user ID is required for the Nutrition outbox");
  return `pace.__sync_food_log_outbox:${encodeURIComponent(normalized)}`;
}

function isCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
}

function isValidQueuedAt(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isOptionalNonNegative(value: unknown): value is number | null {
  return value === null || isFiniteNonNegative(value);
}

export function isValidFoodLogInsertRow(
  value: unknown,
  expectedUserId?: string,
): value is FoodLogInsertRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" &&
    UUID_PATTERN.test(row.id) &&
    typeof row.user_id === "string" &&
    row.user_id.trim().length > 0 &&
    (expectedUserId === undefined || row.user_id === expectedUserId) &&
    typeof row.log_date === "string" &&
    isCalendarDate(row.log_date) &&
    typeof row.meal === "string" &&
    row.meal.trim().length > 0 &&
    typeof row.name === "string" &&
    row.name.trim().length > 0 &&
    isFiniteNonNegative(row.kcal) &&
    isFiniteNonNegative(row.protein_g) &&
    isFiniteNonNegative(row.carbs_g) &&
    isFiniteNonNegative(row.fat_g) &&
    isOptionalNonNegative(row.fiber_g) &&
    isOptionalNonNegative(row.sugar_g) &&
    isOptionalNonNegative(row.sodium_mg) &&
    ["manual", "barcode", "photo", "recipe"].includes(String(row.source)) &&
    !!row.meta &&
    typeof row.meta === "object" &&
    !Array.isArray(row.meta);
}

export function isValidFoodLogOutboxEntry(
  value: unknown,
  expectedUserId?: string,
): value is FoodLogOutboxEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === "string" &&
    UUID_PATTERN.test(entry.id) &&
    isValidQueuedAt(entry.queuedAt) &&
    isValidFoodLogInsertRow(entry.row, expectedUserId) &&
    entry.id === (entry.row as FoodLogInsertRow).id;
}

/**
 * Add or replace one idempotent food_log insert. Entries for other IDs,
 * including malformed legacy payloads, are retained for recovery.
 */
export function queueFoodLogInsert(
  rawOutbox: unknown,
  row: FoodLogInsertRow,
  queuedAt: string,
): unknown[] {
  if (!isValidFoodLogInsertRow(row, row.user_id)) {
    throw new TypeError("Invalid food_log row for the local outbox");
  }
  if (!isValidQueuedAt(queuedAt)) {
    throw new TypeError("Invalid food_log outbox timestamp");
  }

  if (rawOutbox !== null && !Array.isArray(rawOutbox)) {
    throw new TypeError("Malformed Nutrition outbox container; existing data was preserved");
  }
  const entries = Array.isArray(rawOutbox) ? [...rawOutbox] : [];
  const validEntries = entries.filter((entry) =>
    isValidFoodLogOutboxEntry(entry, row.user_id),
  ) as FoodLogOutboxEntry[];
  if (!validEntries.some((entry) => entry.id === row.id) &&
      validEntries.length >= MAX_PENDING_FOOD_LOG_ROWS) {
    throw new RangeError("Nutrition outbox is full; the item was not queued");
  }

  const replacement: FoodLogOutboxEntry = {
    id: row.id,
    queuedAt,
    row: { ...row, meta: { ...row.meta } },
  };
  const next = entries.filter((entry) =>
    !isValidFoodLogOutboxEntry(entry, row.user_id) ||
    (entry as FoodLogOutboxEntry).id !== row.id,
  );
  next.push(replacement);
  return next;
}

/**
 * A late acknowledgement removes only the exact queued version it sent.
 * A newer replacement for the same UUID must survive.
 */
export function removeFoodLogOutboxInsert(
  rawOutbox: unknown,
  completed: FoodLogOutboxEntry,
): unknown[] {
  if (!Array.isArray(rawOutbox)) return [];
  return rawOutbox.filter((entry) =>
    !isValidFoodLogOutboxEntry(entry, completed.row.user_id) ||
    (entry as FoodLogOutboxEntry).id !== completed.id ||
    (entry as FoodLogOutboxEntry).queuedAt !== completed.queuedAt,
  );
}

export function readValidFoodLogOutbox(
  rawOutbox: unknown,
  expectedUserId: string,
): FoodLogOutboxEntry[] {
  if (!Array.isArray(rawOutbox)) return [];
  return rawOutbox
    .filter((entry) => isValidFoodLogOutboxEntry(entry, expectedUserId))
    .map((entry) => ({
      id: entry.id,
      queuedAt: entry.queuedAt,
      row: { ...entry.row, meta: { ...entry.row.meta } },
    }));
}
