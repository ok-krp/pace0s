export type KeysetPageResult<T> = {
  data: readonly T[] | null;
  error: unknown;
};

export type KeysetPaginationOptions = {
  pageSize: number;
  isCancelled?: () => boolean;
};

/**
 * Reads a complete keyset-paginated collection before callers apply any rows.
 * Returns null on cancellation, query failure, malformed pages, or a cursor
 * that fails to advance; callers must never treat a partial result as complete.
 *
 * The database owns ordering/collation. This helper only checks that the
 * boundary key does not repeat, avoiding assumptions about JavaScript string
 * ordering that may differ from the PostgreSQL collation.
 */
export async function fetchAllKeysetPages<T extends { key: string }>(
  fetchPage: (afterKey: string | null, limit: number) => Promise<KeysetPageResult<T>>,
  options: KeysetPaginationOptions,
): Promise<T[] | null> {
  const { pageSize, isCancelled = () => false } = options;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new RangeError("pageSize must be a positive safe integer");
  }

  const rows: T[] = [];
  let cursor: string | null = null;

  while (true) {
    if (isCancelled()) return null;

    let pageResult: KeysetPageResult<T>;
    try {
      pageResult = await fetchPage(cursor, pageSize);
    } catch {
      return null;
    }

    if (isCancelled() || pageResult.error != null || pageResult.data == null) {
      return null;
    }

    const page = pageResult.data;
    if (page.length > pageSize) return null;

    let lastKey = cursor;
    for (const row of page) {
      if (!row || typeof row.key !== "string" || row.key.length === 0) return null;
      if (row.key === lastKey) return null;
      lastKey = row.key;
    }

    rows.push(...page);
    if (page.length < pageSize) return rows;
    if (lastKey === null) return null;
    cursor = lastKey;
  }
}
