import type { NutritionItem } from "./nutrition-log";

export type CanonicalFoodLogRow = {
  id: string;
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
  meta: unknown;
  created_at?: string;
};

export type CanonicalNutritionItem = NutritionItem & {
  __foodLogCanonical: true;
  created_at?: string;
};

const FOOD_LOG_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOMBSTONE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export function queueNutritionTombstone(
  raw: string | null,
  id: string,
  nowMs = Date.now(),
): Record<string, string> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ||
    !Number.isFinite(nowMs)
  ) {
    throw new RangeError("A valid food-log UUID and timestamp are required");
  }
  const tombstones: Record<string, string> = {};
  const active = readActiveNutritionTombstones(raw, nowMs);
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed)) {
          if (active.has(key) && typeof value === "string") tombstones[key] = value;
        }
      }
    } catch {
      // A malformed tombstone map is rebuilt from the new deletion.
    }
  }
  tombstones[id] = new Date(nowMs).toISOString();
  const ordered = Object.entries(tombstones)
    .sort((left, right) => Date.parse(left[1]) - Date.parse(right[1]));
  return Object.fromEntries(ordered.slice(-500));
}

export function readActiveNutritionTombstones(
  raw: string | null,
  nowMs = Date.now(),
): Set<string> {
  if (!raw || !Number.isFinite(nowMs)) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return new Set();
    return new Set(
      Object.entries(value).filter(([id, timestamp]) => {
        if (
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9]{3}-[89ab][0-9]{3}-[0-9]{12}$/i.test(id) ||
          typeof timestamp !== "string"
        ) {
          return false;
        }
        const parsed = Date.parse(timestamp);
        return Number.isFinite(parsed) &&
          parsed <= nowMs + 5 * 60 * 1000 &&
          parsed >= nowMs - TOMBSTONE_RETENTION_MS;
      }).map(([id]) => id),
    );
  } catch {
    return new Set();
  }
}

function missingNutrients(meta: unknown): Set<string> {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return new Set();
  const value = (meta as Record<string, unknown>).missing_nutrients;
  return Array.isArray(value)
    ? new Set(value.filter((entry): entry is string => typeof entry === "string"))
    : new Set();
}

function optionalMetaNutrient(meta: unknown, key: string): number | undefined {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return undefined;
  const value = (meta as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function mapFoodLogRow(row: CanonicalFoodLogRow): CanonicalNutritionItem {
  const missing = missingNutrients(row.meta);
  const sat = optionalMetaNutrient(row.meta, "sat_fat_g");
  const salt = optionalMetaNutrient(row.meta, "salt_g");
  const iron = optionalMetaNutrient(row.meta, "iron_mg");
  const calcium = optionalMetaNutrient(row.meta, "calcium_mg");
  const vitC = optionalMetaNutrient(row.meta, "vitamin_c_mg");
  return {
    id: row.id,
    name: row.name,
    meal: row.meal,
    kcal: missing.has("kcal") ? 0 : Number(row.kcal ?? 0),
    p: missing.has("protein_g") ? 0 : Number(row.protein_g ?? 0),
    c: missing.has("carbs_g") ? 0 : Number(row.carbs_g ?? 0),
    f: missing.has("fat_g") ? 0 : Number(row.fat_g ?? 0),
    ...(sat === undefined ? {} : { sat }),
    ...(salt === undefined ? {} : { salt }),
    ...(missing.has("fiber_g") || row.fiber_g == null ? {} : { fiber: Number(row.fiber_g) }),
    ...(missing.has("sugar_g") || row.sugar_g == null ? {} : { sugar: Number(row.sugar_g) }),
    ...(missing.has("sodium_mg") || row.sodium_mg == null ? {} : { sodium: Number(row.sodium_mg) }),
    ...(iron === undefined ? {} : { iron }),
    ...(calcium === undefined ? {} : { calcium }),
    ...(vitC === undefined ? {} : { vitC }),
    ...(row.created_at ? { created_at: row.created_at } : {}),
    qty: 1,
    __foodLogCanonical: true,
  };
}

/**
 * SQL food_log rows are authoritative for items previously reconciled from
 * that table. Old JSON-only entries remain visible until they are migrated.
 * A deleted SQL row is removed after its cached item has been marked canonical.
 */
export function mergeCanonicalNutritionItems(
  localItems: readonly NutritionItem[],
  remoteRows: readonly CanonicalFoodLogRow[],
  deletedIds: ReadonlySet<string> = new Set(),
): NutritionItem[] {
  const remoteItems = remoteRows
    .filter((row) => !deletedIds.has(row.id))
    .map(mapFoodLogRow);
  const remoteIds = new Set(remoteItems.map((item) => item.id));
  const legacyItems = localItems.filter((item) => {
    const candidate = item as NutritionItem & { __foodLogCanonical?: unknown };
    return !deletedIds.has(item.id) &&
      !remoteIds.has(item.id) &&
      candidate.__foodLogCanonical !== true;
  });
  return [...remoteItems, ...legacyItems];
}

export const NUTRITION_CACHE_OWNER_KEY = "pace.__nutrition_cache_owner";
export const NUTRITION_UNASSIGNED_BACKUP_KEY = "pace.__nutrition_unassigned_legacy_backup";
export const NUTRITION_LEGACY_TOMBSTONES_KEY = "pace.nutrition.deleted_ids";

export function nutritionAccountCacheKeys(userId: string): {
  items: string;
  totals: string;
  deletedIds: string;
  foodLogCursor: string;
} {
  if (!userId.trim()) throw new Error("A user ID is required for the Nutrition cache");
  const scope = encodeURIComponent(userId);
  return {
    items: `pace.__nutrition_cache:${scope}:items`,
    totals: `pace.__nutrition_cache:${scope}:totals`,
    deletedIds: `pace.__nutrition_cache:${scope}:deleted_ids`,
    foodLogCursor: `pace.__nutrition_cache:${scope}:food_log_cursor`,
  };
}

/** Old unowned global JSON must never be auto-assigned to the first login. */
export function mayReadGlobalNutritionCache(
  cacheOwner: string | null,
  userId: string | null,
): boolean {
  if (!userId) return cacheOwner === null;
  return cacheOwner === userId;
}


export type FoodLogPageResult<T> = {
  data: readonly T[] | null;
  error: unknown;
};

/**
 * Fetch an entire food_log collection using its immutable UUID primary key.
 * A partial/error/non-progressing page is never returned as a successful
 * snapshot, so callers cannot replace their local cache with truncated data.
 * PostgreSQL UUID ordering and canonical UUID string ordering use the same
 * byte order, making the cursor deterministic across pages.
 */
export async function fetchAllFoodLogKeysetPages<T extends { id: string }>(
  fetchPage: (afterId: string | null, limit: number) => Promise<FoodLogPageResult<T>>,
  options: { pageSize: number; isCancelled?: () => boolean },
): Promise<T[] | null> {
  const { pageSize, isCancelled = () => false } = options;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new RangeError("pageSize must be a positive safe integer");
  }

  const rows: T[] = [];
  let cursor: string | null = null;

  while (true) {
    if (isCancelled()) return null;
    let result: FoodLogPageResult<T>;
    try {
      result = await fetchPage(cursor, pageSize);
    } catch {
      return null;
    }
    if (isCancelled() || result.error != null || result.data == null) return null;
    const page = result.data;
    if (page.length > pageSize) return null;

    let lastId: string | null = cursor;
    for (const row of page) {
      if (!row || typeof row.id !== "string" || row.id.length === 0) return null;
      if (lastId !== null && row.id <= lastId) return null;
      lastId = row.id;
    }

    rows.push(...page);
    if (page.length < pageSize) return rows;
    if (lastId === null) return null;
    cursor = lastId;
  }
}


/**
 * Merge successive guest-only Nutrition snapshots for recovery. Items are
 * deduplicated by their stable local ID; the incoming snapshot wins only for
 * an ID already present. Invalid JSON is never allowed to overwrite a backup.
 */
export function mergeUnassignedNutritionSnapshots(
  existingRaw: string | null,
  incomingRaw: string | null,
): Record<string, NutritionItem[]> | null {
  const parse = (raw: string | null): Record<string, NutritionItem[]> | null => {
    if (raw === null) return {};
    try {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      const result: Record<string, NutritionItem[]> = {};
      for (const [day, entries] of Object.entries(value)) {
        if (!Array.isArray(entries)) return null;
        if (entries.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry))) {
          return null;
        }
        result[day] = entries as NutritionItem[];
      }
      return result;
    } catch {
      return null;
    }
  };

  const existing = parse(existingRaw);
  const incoming = parse(incomingRaw);
  if (!existing || !incoming) return null;

  const merged: Record<string, NutritionItem[]> = {};
  for (const day of new Set([...Object.keys(existing), ...Object.keys(incoming)])) {
    const output: NutritionItem[] = [];
    const positions = new Map<string, number>();
    for (const item of [...(existing[day] ?? []), ...(incoming[day] ?? [])]) {
      const id = typeof item.id === "string" ? item.id : "";
      if (!id) {
        output.push(item);
        continue;
      }
      const previousIndex = positions.get(id);
      if (previousIndex === undefined) {
        positions.set(id, output.length);
        output.push(item);
      } else {
        output[previousIndex] = item;
      }
    }
    merged[day] = output;
  }
  return merged;
}


/**
 * Merge local and cloud nutrition deletion markers. The returned compact map
 * is safe to keep account-scoped locally and to publish as the user's
 * pace.nutrition.deleted_ids sync key.
 */
export function mergeNutritionTombstoneMaps(
  ...rawMaps: Array<string | null>
): Record<string, string> {
  const latest = new Map<string, number>();
  const now = Date.now();
  for (const raw of rawMaps) {
    if (!raw) continue;
    try {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      for (const [id, timestamp] of Object.entries(value)) {
        if (
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ||
          typeof timestamp !== "string"
        ) continue;
        const parsed = Date.parse(timestamp);
        if (!Number.isFinite(parsed) ||
            parsed > now + 5 * 60 * 1000 ||
            parsed < now - TOMBSTONE_RETENTION_MS) continue;
        latest.set(id, Math.max(latest.get(id) ?? Number.NEGATIVE_INFINITY, parsed));
      }
    } catch {
      // One corrupt source must not discard valid markers from another source.
    }
  }
  const ordered = [...latest.entries()].sort((left, right) => left[1] - right[1]).slice(-500);
  return Object.fromEntries(ordered.map(([id, timestamp]) => [id, new Date(timestamp).toISOString()]));
}


export type FoodLogTupleCursor = {
  createdAt: string;
  id: string;
};

export type NutritionFoodLogCursor = {
  logDate: string;
  createdAt: string;
  id: string | null;
  lastFullAt: string;
};

export const FOOD_LOG_RECONCILIATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const FOOD_LOG_CURSOR_OVERLAP_MS = 5 * 60 * 1000;

function timestampMicros(value: string): number | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || (match[2]?.length ?? 0) > 6) return null;
  const wholeSecond = Date.parse(`${match[1]}${match[3]}`);
  if (!Number.isFinite(wholeSecond)) return null;
  const fractionMicros = Number((match[2] ?? "").padEnd(6, "0"));
  // Date.parse returns milliseconds; normalize the six-digit fraction from
  // PostgreSQL microseconds before adding it to that millisecond timestamp.
  return wholeSecond * 1000 + fractionMicros / 1000;
}

export function compareFoodLogTupleCursor(
  left: FoodLogTupleCursor,
  right: FoodLogTupleCursor,
): number | null {
  const leftTime = timestampMicros(left.createdAt);
  const rightTime = timestampMicros(right.createdAt);
  if (leftTime === null || rightTime === null) return null;
  if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1;
  return left.id === right.id ? 0 : left.id < right.id ? -1 : 1;
}

export function parseNutritionFoodLogCursor(
  raw: string | null,
  expectedLogDate: string,
): NutritionFoodLogCursor | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const cursor = value as Record<string, unknown>;
    if (
      cursor.logDate !== expectedLogDate ||
      typeof cursor.createdAt !== "string" ||
      timestampMicros(cursor.createdAt) === null ||
      !(cursor.id === null ||
        (typeof cursor.id === "string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cursor.id))) ||
      typeof cursor.lastFullAt !== "string" ||
      !Number.isFinite(Date.parse(cursor.lastFullAt))
    ) return null;
    return {
      logDate: cursor.logDate as string,
      createdAt: cursor.createdAt,
      id: cursor.id as string | null,
      lastFullAt: cursor.lastFullAt,
    };
  } catch {
    return null;
  }
}

export function shouldRunFullFoodLogReconciliation(
  cursor: NutritionFoodLogCursor | null,
  logDate: string,
  nowMs = Date.now(),
): boolean {
  if (!Number.isFinite(nowMs) || !cursor || cursor.logDate !== logDate) return true;
  const lastFullAt = Date.parse(cursor.lastFullAt);
  return !Number.isFinite(lastFullAt) ||
    lastFullAt > nowMs ||
    nowMs - lastFullAt >= FOOD_LOG_RECONCILIATION_INTERVAL_MS;
}

export function foodLogDeltaSince(cursor: NutritionFoodLogCursor): string {
  const timestamp = Date.parse(cursor.createdAt);
  if (!Number.isFinite(timestamp)) throw new RangeError("Invalid food_log cursor timestamp");
  return new Date(timestamp - FOOD_LOG_CURSOR_OVERLAP_MS).toISOString();
}

export function nextNutritionFoodLogCursor({
  previous,
  rows,
  logDate,
  fullReconciliation,
  nowMs = Date.now(),
}: {
  previous: NutritionFoodLogCursor | null;
  rows: readonly Pick<CanonicalFoodLogRow, "id" | "created_at">[];
  logDate: string;
  fullReconciliation: boolean;
  nowMs?: number;
}): NutritionFoodLogCursor {
  if (!Number.isFinite(nowMs)) throw new RangeError("Invalid cursor timestamp");

  // Persist a scan watermark, not the last row timestamp. Every successful
  // delta starts again five minutes before this watermark; the overlap catches
  // delayed commits and equal-timestamp inserts without resending old history.
  // The tuple cursor used to paginate within one request remains row-based.
  for (const row of rows) {
    if (!FOOD_LOG_UUID_PATTERN.test(row.id) ||
        typeof row.created_at !== "string" ||
        timestampMicros(row.created_at) === null) {
      throw new TypeError("Invalid food_log row while advancing cursor");
    }
  }

  const watermark = new Date(nowMs).toISOString();
  return {
    logDate,
    createdAt: watermark,
    id: null,
    lastFullAt: fullReconciliation
      ? watermark
      : previous?.lastFullAt ?? new Date(0).toISOString(),
  };
}

export async function fetchAllFoodLogTuplePages<
  T extends { id: string; created_at: string },
>(
  fetchPage: (
    after: FoodLogTupleCursor | null,
    limit: number,
  ) => Promise<FoodLogPageResult<T>>,
  options: { pageSize: number; isCancelled?: () => boolean },
): Promise<T[] | null> {
  const { pageSize, isCancelled = () => false } = options;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new RangeError("pageSize must be a positive safe integer");
  }

  const rows: T[] = [];
  let cursor: FoodLogTupleCursor | null = null;
  while (true) {
    if (isCancelled()) return null;
    let result: FoodLogPageResult<T>;
    try {
      result = await fetchPage(cursor, pageSize);
    } catch {
      return null;
    }
    if (isCancelled() || result.error != null || result.data == null) return null;
    const page = result.data;
    if (page.length > pageSize) return null;

    let last: FoodLogTupleCursor | null = cursor;
    for (const row of page) {
      if (
        !row ||
        typeof row.id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.id) ||
        typeof row.created_at !== "string"
      ) return null;
      const next = { createdAt: row.created_at, id: row.id };
      if (timestampMicros(next.createdAt) === null) return null;
      if (last && (compareFoodLogTupleCursor(last, next) ?? -1) >= 0) return null;
      last = next;
    }
    rows.push(...page);
    if (page.length < pageSize) return rows;
    if (!last) return null;
    cursor = last;
  }
}

export function mergeCanonicalNutritionDelta(
  localItems: readonly NutritionItem[],
  remoteRows: readonly CanonicalFoodLogRow[],
  deletedIds: ReadonlySet<string> = new Set(),
): NutritionItem[] {
  const merged = new Map<string, NutritionItem>();
  for (const item of localItems) {
    if (!deletedIds.has(item.id)) merged.set(item.id, item);
  }
  for (const row of remoteRows) {
    if (deletedIds.has(row.id)) {
      merged.delete(row.id);
      continue;
    }
    merged.set(row.id, mapFoodLogRow(row));
  }
  return [...merged.values()];
}
