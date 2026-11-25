import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Mesin laporan stok per periode — satu rumus untuk SEMUA halaman stok.
 *
 * Kenapa dipisah: sebelumnya tiap halaman menghitung sendiri dengan campuran
 * tiga sumber angka (saldo live, ledger difilter created_at, dan opening_qty),
 * sehingga Stok Awal + IN − OUT hampir selalu ≠ Stok Akhir.
 *
 * Aturan di sini (sama persis dengan RPC `stock_period_report` di migrasi
 * 20261125000001_stock_consistency.sql):
 *
 *   closing(D)        = saldo live − seluruh mutasi bertanggal > D
 *   opening(periode)  = closing − mutasi bertanggal dalam periode
 *   IN                = Σ mutasi positif dalam periode
 *   OUT               = −Σ mutasi negatif dalam periode
 *
 * Konsekuensinya `opening + IN − OUT = closing` SELALU benar (dibulatkan
 * 3 desimal, sama dengan numeric(15,3) di database), dan "Stok Akhir" untuk
 * periode lampau adalah saldo pada akhir periode itu — bukan saldo hari ini.
 *
 * Tanggal yang dipakai adalah TANGGAL TRANSAKSI (tanggal dokumen / tanggal
 * pengiriman), bukan `created_at` (waktu input), supaya pengiriman 10 Nov yang
 * diunggah 11 Nov tetap masuk periode 10 Nov.
 */

export interface RawBalance {
  item_id: string;
  location_id: string;
  qty: number | string;
  opening_qty?: number | string | null;
}

export interface RawMove {
  item_id: string;
  location_id: string;
  qty_change: number | string;
  /** Tanggal transaksi 'YYYY-MM-DD'. */
  txnDate: string;
}

export interface StockPeriodRow {
  item_id: string;
  location_id: string;
  /** Saldo awal periode. */
  opening: number;
  /** Total mutasi positif dalam periode. */
  totalIn: number;
  /** Total mutasi negatif dalam periode (angka positif). */
  totalOut: number;
  /** Saldo akhir periode = opening + totalIn − totalOut. */
  closing: number;
  /** Saldo live saat ini (pembanding). */
  balance: number;
  /** Stok awal dasar tersimpan (opening_qty, angka SO / Atur Stok). */
  openingBaseline: number;
  /** Seluruh mutasi ledger, semua tanggal. */
  ledgerNet: number;
  /** true bila balance === openingBaseline + ledgerNet. */
  reconciled: boolean;
}

/** Bulatkan ke 3 desimal agar cocok dengan numeric(15,3). */
export function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

const EPS = 0.0005;

/**
 * Hitung laporan stok per periode dari baris mentah.
 * `start`/`end` inklusif, format 'YYYY-MM-DD'.
 */
export function computeStockPeriod(
  balances: RawBalance[],
  moves: RawMove[],
  start: string,
  end: string
): StockPeriodRow[] {
  const keyOf = (item: string, loc: string) => `${item}|${loc}`;

  const balMap = new Map<string, RawBalance>();
  for (const b of balances) balMap.set(keyOf(b.item_id, b.location_id), b);

  interface Agg {
    item_id: string;
    location_id: string;
    periodNet: number;
    tin: number;
    tout: number;
    afterNet: number;
    allNet: number;
  }
  const aggMap = new Map<string, Agg>();
  const ensure = (item: string, loc: string): Agg => {
    const k = keyOf(item, loc);
    let a = aggMap.get(k);
    if (!a) {
      a = {
        item_id: item,
        location_id: loc,
        periodNet: 0,
        tin: 0,
        tout: 0,
        afterNet: 0,
        allNet: 0,
      };
      aggMap.set(k, a);
    }
    return a;
  };
  for (const k of balMap.keys()) {
    const [item, loc] = k.split("|");
    ensure(item, loc);
  }
  for (const m of moves) {
    const q = Number(m.qty_change);
    if (!Number.isFinite(q) || q === 0) continue;
    const a = ensure(m.item_id, m.location_id);
    a.allNet += q;
    const d = (m.txnDate ?? "").slice(0, 10);
    if (d > end) a.afterNet += q;
    if (d >= start && d <= end) {
      a.periodNet += q;
      if (q > 0) a.tin += q;
      else a.tout += -q;
    }
  }

  const rows: StockPeriodRow[] = [];
  for (const a of aggMap.values()) {
    const b = balMap.get(keyOf(a.item_id, a.location_id));
    const balance = Number(b?.qty ?? 0);
    const openingBaseline = Number(b?.opening_qty ?? 0);
    const closing = round3(balance - a.afterNet);
    const opening = round3(closing - a.periodNet);
    rows.push({
      item_id: a.item_id,
      location_id: a.location_id,
      opening,
      totalIn: round3(a.tin),
      totalOut: round3(a.tout),
      closing,
      balance: round3(balance),
      openingBaseline: round3(openingBaseline),
      ledgerNet: round3(a.allNet),
      reconciled: Math.abs(openingBaseline + a.allNet - balance) < EPS,
    });
  }
  return rows;
}

export interface StockIntegrityRow {
  item_id: string;
  location_id: string;
  balance: number;
  openingBaseline: number;
  ledgerNet: number;
  /** balance − (openingBaseline + ledgerNet). */
  drift: number;
}

/** Baris yang saldo live-nya tidak sama dengan stok awal dasar + ledger. */
export function computeStockIntegrity(
  balances: RawBalance[],
  moves: RawMove[]
): StockIntegrityRow[] {
  const net = new Map<string, number>();
  for (const m of moves) {
    const k = `${m.item_id}|${m.location_id}`;
    net.set(k, (net.get(k) ?? 0) + Number(m.qty_change));
  }
  const rows: StockIntegrityRow[] = [];
  for (const b of balances) {
    const k = `${b.item_id}|${b.location_id}`;
    const balance = Number(b.qty);
    const opening = Number(b.opening_qty ?? 0);
    const ledgerNet = round3(net.get(k) ?? 0);
    const drift = round3(balance - (opening + ledgerNet));
    if (Math.abs(drift) < EPS) continue;
    rows.push({
      item_id: b.item_id,
      location_id: b.location_id,
      balance: round3(balance),
      openingBaseline: round3(opening),
      ledgerNet,
      drift,
    });
  }
  return rows.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));
}

// ---------------------------------------------------------------------------
// Loader: utamakan RPC database; bila migrasi belum dijalankan, hitung di
// klien dengan rumus yang sama (fallback). Dengan begitu aplikasi tetap bisa
// dipakai sebelum SQL migrasi dieksekusi, tanpa kembali ke angka yang ngaco.
// ---------------------------------------------------------------------------

const PAGE = 1000;

async function selectAll<T>(
  make: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await make(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    out.push(...batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

/** Ambil seluruh mutasi ledger (semua tanggal) + tanggal transaksinya. */
export async function loadLedgerMoves(
  supabase: SupabaseClient,
  locationIds: string[]
): Promise<RawMove[]> {
  if (locationIds.length === 0) return [];
  const ledRaw = await selectAll<{
    item_id: string;
    location_id: string;
    qty_change: number | string;
    transaction_id: string;
    created_at: string;
  }>((from, to) =>
    supabase
      .from("inventory_ledger")
      .select("item_id, location_id, qty_change, transaction_id, created_at")
      .in("location_id", locationIds)
      .order("id", { ascending: true })
      .range(from, to)
  );

  const txnIds = [...new Set(ledRaw.map((r) => r.transaction_id))];
  const txnDate = new Map<string, string>();
  for (let i = 0; i < txnIds.length; i += 200) {
    const { data, error } = await supabase
      .from("inventory_transactions")
      .select("id, transaction_date")
      .in("id", txnIds.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const t of (data ?? []) as { id: string; transaction_date: string }[])
      txnDate.set(t.id, t.transaction_date);
  }

  return ledRaw.map((r) => ({
    item_id: r.item_id,
    location_id: r.location_id,
    qty_change: Number(r.qty_change),
    // Fallback created_at hanya bila transaksi hilang (tidak mungkin karena FK).
    txnDate: (txnDate.get(r.transaction_id) ?? r.created_at ?? "").slice(0, 10),
  }));
}

export async function loadBalances(
  supabase: SupabaseClient,
  locationIds: string[]
): Promise<RawBalance[]> {
  if (locationIds.length === 0) return [];
  return selectAll<RawBalance>((from, to) =>
    supabase
      .from("inventory_balances")
      .select("item_id, location_id, qty, opening_qty")
      .in("location_id", locationIds)
      .order("item_id", { ascending: true })
      .range(from, to)
  );
}

/**
 * Laporan stok per periode + audit selisih historis dalam satu pemanggilan.
 * RPC database dipakai bila migrasi sudah dijalankan; bila belum, dihitung di
 * klien dengan rumus yang sama (fallback) supaya aplikasi tetap bisa dipakai.
 */
export async function loadStockReport(
  supabase: SupabaseClient,
  locationIds: string[],
  start: string,
  end: string
): Promise<{ rows: StockPeriodRow[]; integrity: StockIntegrityRow[]; via: "rpc" | "fallback" }> {
  const isMissingFn = (msg: string) =>
    /could not find|does not exist|schema cache|PGRST202/i.test(msg);

  const { data, error } = await supabase.rpc("stock_period_report", {
    p_location_ids: locationIds,
    p_start: start,
    p_end: end,
  });

  if (!error && data) {
    const rows = (data as {
      item_id: string;
      location_id: string;
      opening_qty: number | string;
      total_in: number | string;
      total_out: number | string;
      closing_qty: number | string;
      balance_qty: number | string;
      opening_baseline: number | string;
      ledger_net: number | string;
      reconciled: boolean;
    }[]).map((r) => ({
      item_id: r.item_id,
      location_id: r.location_id,
      opening: Number(r.opening_qty),
      totalIn: Number(r.total_in),
      totalOut: Number(r.total_out),
      closing: Number(r.closing_qty),
      balance: Number(r.balance_qty),
      openingBaseline: Number(r.opening_baseline),
      ledgerNet: Number(r.ledger_net),
      reconciled: Boolean(r.reconciled),
    }));

    let integrity: StockIntegrityRow[] = [];
    const intRes = await supabase.rpc("stock_integrity", {
      p_location_ids: locationIds,
    });
    if (!intRes.error && intRes.data) {
      integrity = (intRes.data as {
        item_id: string;
        location_id: string;
        qty: number | string;
        opening_qty: number | string;
        ledger_net: number | string;
        drift: number | string;
      }[]).map((r) => ({
        item_id: r.item_id,
        location_id: r.location_id,
        balance: Number(r.qty),
        openingBaseline: Number(r.opening_qty),
        ledgerNet: Number(r.ledger_net),
        drift: Number(r.drift),
      }));
    }
    return { rows, integrity, via: "rpc" };
  }

  // RPC belum ada (migrasi belum dijalankan) atau gagal sementara → fallback.
  // Error izin tetap dilempar agar tidak menyembunyikan masalah akses.
  const msg = error?.message ?? "";
  if (error && !isMissingFn(msg)) throw new Error(msg);

  const [balances, moves] = await Promise.all([
    loadBalances(supabase, locationIds),
    loadLedgerMoves(supabase, locationIds),
  ]);
  return {
    rows: computeStockPeriod(balances, moves, start, end),
    integrity: computeStockIntegrity(balances, moves),
    via: "fallback",
  };
}
