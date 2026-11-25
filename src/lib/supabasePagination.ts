/**
 * Helper paginasi otomatis untuk query Supabase/PostgREST agar data tidak
 * pernah terpotong diam-diam oleh batas default 1.000 baris PostgREST.
 */
export async function fetchAllPages<T>(
  fetchPage: (
    from: number,
    to: number
  ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  options?: { pageSize?: number; maxRows?: number }
): Promise<T[]> {
  const pageSize = options?.pageSize ?? 1000;
  const maxRows = options?.maxRows ?? 25_000;
  const result: T[] = [];

  for (let from = 0; from < maxRows; from += pageSize) {
    const to = Math.min(from + pageSize - 1, maxRows - 1);
    const { data, error } = await fetchPage(from, to);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    result.push(...batch);
    if (batch.length < pageSize) break;
  }

  return result;
}
