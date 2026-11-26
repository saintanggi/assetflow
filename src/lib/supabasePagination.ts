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
  const maxRows = options?.maxRows ?? 500_000;
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

/**
 * Pecah array ID menjadi potongan kecil agar query `.in(...)` tidak melebihi
 * batas panjang URL ataupun batas 1.000 baris PostgREST.
 */
export function chunkArray<T>(items: readonly T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
