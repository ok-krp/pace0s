export const USER_EXPORT_PAGE_SIZE = 500;

/** Fetch a complete, ordered user-data export without silent row truncation. */
export async function collectUserExportPages<T>(
  fetchPage: (from: number, to: number) => Promise<{
    data: readonly T[] | null;
    error: { message: string } | null;
  }>,
  pageSize = USER_EXPORT_PAGE_SIZE,
): Promise<T[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new RangeError("pageSize must be a positive safe integer");
  }
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const {data, error} = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
