/**
 * Helper untuk membaca dan menyimpan 1 atau banyak URL foto bukti surat jalan
 * di kolom teks `inventory_transactions.surat_jalan_url` tanpa mengubah skema
 * maupun merusak data lama (1 URL tetap disimpan sebagai string biasa; ≥2 URL
 * disimpan sebagai JSON array string).
 */
export function parseProofUrls(raw?: string | null): string[] {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is string => typeof item === "string")
          .map((s) => s.trim())
          .filter(Boolean);
      }
    } catch {
      return [];
    }
  }
  return [trimmed];
}

export function serializeProofUrls(urls: string[]): string | null {
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const s = raw.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    cleaned.push(s);
  }
  if (cleaned.length === 0) return null;
  if (cleaned.length === 1) return cleaned[0];
  return JSON.stringify(cleaned);
}
