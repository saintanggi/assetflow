// =============================================================================
// Edge Function: sync-sheets
// Menarik dokumen pengiriman dari Google Sheet ke sistem TANPA upload manual.
//
// - Selalu memakai SHEET TERBARU (nama sheet bertanggal, mis. "14 OKT").
// - Qty mengikuti aturan template dokumen pengiriman (lihat shippingUpload.ts):
//   satu angka QTY yang di-merge = total satu blok barang, dibagi ke baris-barisnya.
// - STATUS ASSET menentukan stok yang dipotong:
//   ASSET BARU → STOK-BARU · ASSET RETUR/RETURN → STOK-RETUR · UNREADY → STOK-UNREADY.
// - Idempoten: baris yang sudah pernah masuk (tiket + barang + barcode/resi)
//   dilewati, jadi dijalankan tiap 15 menit pun aman.
//
// Aksi:
//   { action: "test"    }              -> cek file & sebutkan sheet terbaru
//   { action: "preview" }              -> ringkasan yang AKAN diimpor (tanpa tulis)
//   { action: "run"     }              -> import + potong stok + catat log
// Parameter opsional: source_id, spreadsheet_id, sheet_mode, sheet_name,
//                     deduct_stock, allow_negative, auto_create_items
// =============================================================================
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import * as XLSX from "./xlsx.ts";
import { downloadWorkbook, extractSpreadsheetId } from "./googleSheet.ts";
import {
  aggregateGroup,
  buildDupIndex,
  filterDuplicateRows,
  findDuplicateRowsInFile,
  groupKeyOf,
  parseSheetLabel,
  parseWorkbook,
  pickNewestSheet,
  type AggLine,
  type DupIndex,
  type KodeKondisi,
  type ParsedShippingRow,
  type StoredItemRow,
} from "./shippingUpload.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? SERVICE_KEY;
const LOKASI: KodeKondisi[] = ["STOK-BARU", "STOK-RETUR", "STOK-UNREADY"];

interface SourceConfig {
  id?: string;
  name?: string;
  spreadsheet_id: string;
  sheet_mode: "newest" | "named";
  sheet_name?: string | null;
  deduct_stock: boolean;
  allow_negative: boolean;
  auto_create_items: boolean;
}

interface FailLine { ticket: string; detail: string }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function pesanError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]")
    .replace(/Stok tidak mencukupi \(item \[id\][^)]*\)/i, "Stok tidak mencukupi")
    .slice(0, 500);
}

/** Kumpulkan sidik jari baris yang sudah pernah diimpor (untuk idempotensi). */
async function loadStoredFingerprints(
  db: SupabaseClient,
  rows: ParsedShippingRow[],
): Promise<DupIndex> {
  const tickets = [...new Set(rows.map((r) => r.ticket).filter(Boolean))];
  const dates = [...new Set(rows.map((r) => r.date))];
  if (tickets.length === 0 || dates.length === 0) return buildDupIndex([]);
  const stored: StoredItemRow[] = [];
  const { data: reqs, error } = await db
    .from("requests")
    .select("id, ticket_no, request_date")
    .in("ticket_no", tickets.slice(0, 200))
    .in("request_date", dates.slice(0, 60))
    .limit(5000);
  if (error) throw new Error(`Gagal membaca permintaan lama: ${error.message}`);
  const reqById = new Map(
    ((reqs ?? []) as { id: string; ticket_no: string; request_date: string }[]).map((r) => [r.id, r]),
  );
  if (reqById.size === 0) return buildDupIndex([]);
  for (let i = 0; i < reqById.size; i += 100) {
    const ids = [...reqById.keys()].slice(i, i + 100);
    const { data: items, error: itErr } = await db
      .from("request_items")
      .select("request_id, item_id, barcode, resi, qty_requested")
      .in("request_id", ids)
      .limit(5000);
    if (itErr) throw new Error(`Gagal membaca item lama: ${itErr.message}`);
    for (const it of (items ?? []) as {
      request_id: string; item_id: string; barcode: string | null; resi: string | null; qty_requested: number | string;
    }[]) {
      const req = reqById.get(it.request_id);
      if (!req) continue;
      stored.push({
        ticket_no: req.ticket_no,
        request_date: req.request_date,
        item_id: it.item_id,
        barcode: it.barcode,
        resi: it.resi,
        qty_requested: it.qty_requested,
      });
    }
  }
  return buildDupIndex(stored);
}

interface ImportResult {
  sheet: string;
  sheetDate: string | null;
  rowsTotal: number;
  rowsNew: number;
  rowsSkippedDup: number;
  rowsDupInFile: number;
  rowsTanpaMaster: number;
  requests: number;
  items: number;
  qty: number;
  failures: FailLine[];
  preview: { item: string; kondisi: string; qty: number; rows: number; aset: string }[];
  unmatched: string[];
}

/**
 * Proses inti: unduh → pilih sheet terbaru → cocokkan barang → buang duplikat →
 * (bila bukan dryRun) buat permintaan + potong stok.
 */
async function syncSource(
  db: SupabaseClient,
  cfg: SourceConfig,
  opts: { dryRun: boolean; actorId: string | null; triggeredBy: "cron" | "manual" },
): Promise<ImportResult> {
  const wb = await downloadWorkbook(cfg.spreadsheet_id);
  const parsed = parseWorkbook(wb);
  if (parsed.sheets.length === 0) {
    throw new Error("Tidak ada sheet berisi tabel pengiriman (kolom NAMA BARANG) di file itu.");
  }

  let dipakai = pickNewestSheet(parsed.sheets) ?? parsed.sheets[0];
  if (cfg.sheet_mode === "named" && cfg.sheet_name) {
    const nama = cfg.sheet_name.trim().toUpperCase();
    const dicari = parsed.sheets.find((s) => s.name.trim().toUpperCase() === nama);
    if (!dicari) {
      throw new Error(
        `Sheet "${cfg.sheet_name}" tidak ditemukan. Sheet yang ada: ${parsed.sheets.map((s) => s.name).join(", ")}.`,
      );
    }
    dipakai = dicari;
  }
  const semuaBaris = dipakai.rows;

  // Cocokkan nama barang dengan master.
  const { data: items, error: itemsErr } = await db
    .from("inventory_items")
    .select("id, name")
    .eq("is_active", true)
    .limit(5000);
  if (itemsErr) throw new Error(`Gagal membaca master barang: ${itemsErr.message}`);
  const byName = new Map<string, string>();
  for (const it of (items ?? []) as { id: string; name: string }[]) {
    byName.set(it.name.trim().toUpperCase(), it.id);
  }

  const unmatched = [
    ...new Set(semuaBaris.filter((r) => !byName.has(r.itemName.toUpperCase())).map((r) => r.itemName)),
  ];
  if (cfg.auto_create_items && unmatched.length > 0 && !opts.dryRun) {
    const { data: units } = await db.from("units").select("id, code").limit(50);
    const pcs =
      ((units ?? []) as { id: string; code: string }[]).find((u) => u.code.toUpperCase() === "PCS") ??
      (units?.[0] as { id: string } | undefined);
    if (!pcs) throw new Error("Tabel satuan kosong — hubungi Super Admin.");
    const stamp = Date.now().toString(36).toUpperCase();
    const { data: created, error } = await db
      .from("inventory_items")
      .insert(
        unmatched.map((n, i) => ({
          sku: `SYNC-${stamp}-${i}`,
          name: n,
          unit_id: pcs.id,
          is_active: true,
        })),
      )
      .select("id, name");
    if (error) throw new Error(`Gagal membuat barang baru: ${error.message}`);
    for (const c of (created ?? []) as { id: string; name: string }[]) {
      byName.set(c.name.trim().toUpperCase(), c.id);
    }
  } else if (unmatched.length > 0 && !cfg.auto_create_items && !opts.dryRun) {
    // Saat pratinjau kita tetap lanjut supaya daftar barang baru bisa dilihat.
    throw new Error(
      `${unmatched.length} nama barang belum ada di master (contoh: ${unmatched.slice(0, 5).join(", ")}). ` +
        'Tambahkan di Master Barang atau aktifkan "Buat barang baru otomatis" lalu jalankan lagi.',
    );
  }

  // Baris yang barangnya belum ada di master tidak bisa diproses (kecuali auto-create).
  const rows = semuaBaris.filter((r) => byName.has(r.itemName.toUpperCase()));
  const rowsTanpaMaster = semuaBaris.length - rows.length;

  // Buang baris yang sudah pernah masuk (idempoten).
  const keyOf = (r: ParsedShippingRow): string => byName.get(r.itemName.toUpperCase()) ?? "";
  const index = await loadStoredFingerprints(db, rows);
  const { kept, skipped } = filterDuplicateRows(rows, keyOf, index);
  const dupInFile = findDuplicateRowsInFile(kept, keyOf);

  // Lokasi stok per kondisi.
  const locByKondisi = new Map<KodeKondisi, string>();
  if (cfg.deduct_stock) {
    const { data: locs } = await db.from("locations").select("id, code").in("code", LOKASI);
    for (const l of ((locs ?? []) as { id: string; code: string }[])) {
      locByKondisi.set(l.code as KodeKondisi, l.id);
    }
    if (!locByKondisi.has("STOK-BARU")) throw new Error("Lokasi STOK-BARU belum ada di database.");
  }

  // Kelompokkan per permintaan (tanggal + gerai + tiket).
  const groups = new Map<string, ParsedShippingRow[]>();
  for (const r of kept) {
    const k = groupKeyOf(r);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  const result: ImportResult = {
    sheet: dipakai.name,
    sheetDate: parseSheetLabel(dipakai.name).date,
    rowsTotal: semuaBaris.length,
    rowsNew: kept.length,
    rowsSkippedDup: skipped.length,
    rowsDupInFile: dupInFile.length,
    rowsTanpaMaster,
    requests: 0,
    items: 0,
    qty: 0,
    failures: [],
    preview: [],
    unmatched,
  };

  let n = 0;
  for (const rs of groups.values()) {
    n++;
    const first = rs[0];
    const ticket = first.ticket || null;
    const lines = aggregateGroup(rs, keyOf);
    for (const l of lines) {
      result.preview.push({
        item: l.itemName,
        kondisi: l.kodeKondisi,
        qty: l.qty,
        rows: l.rowCount,
        aset: l.rows[0]?.statusAset || "",
      });
    }
    result.qty += lines.reduce((s, l) => s + l.qty, 0);
    result.items += lines.length;
    if (opts.dryRun) continue;

    let reqId: string | null = null;
    try {
      const hasPending = lines.some((l) => l.isPending);
      const { data: req, error: reqErr } = await db
        .from("requests")
        .insert({
          ticket_no: ticket ?? `UPL-${first.date}-${n}`,
          request_date: first.date,
          branch_name: first.branch,
          branch_code: first.branchCode || null,
          status: "disetujui",
          notes: `Sinkron Google Sheet otomatis (${dipakai.name}).`,
          requested_by: opts.actorId,
          reviewed_by: opts.actorId,
          reviewed_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (reqErr) throw new Error(reqErr.message);
      reqId = req.id as string;

      const planned = lines.map((line: AggLine) => ({
        line,
        id: crypto.randomUUID(),
      }));
      const payload = planned.map(({ line, id }) => ({
        id,
        request_id: reqId,
        item_id: line.itemKey,
        qty_requested: line.qty,
        qty_approved: line.qty,
        qty_shipped: 0,
        barcode: [...new Set(line.rows.map((x) => x.barcode).filter(Boolean))].join("\n") || null,
        item_type: line.rows[0]?.typeBarang || null,
        status_aset: line.rows[0]?.statusAset || null,
        resi: [...new Set(line.rows.map((x) => x.resi).filter(Boolean))].join("\n") || null,
        item_status: line.isPending ? "pending_sebagian" : "disetujui",
        notes: [...new Set(
          line.rows.map((x) =>
            [x.ket && `Ket: ${x.ket}`, x.statusRequest && `Status request: ${x.statusRequest}`]
              .filter(Boolean)
              .join(" | "),
          ),
        )].filter(Boolean).join("\n") || null,
      }));
      const { error: insErr } = await db.from("request_items").insert(payload);
      if (insErr) throw new Error(insErr.message);
      result.requests++;

      if (cfg.deduct_stock) {
        const perKondisi = new Map<KodeKondisi, { request_item_id: string; qty: number; resi: string }[]>();
        for (const { line, id } of planned) {
          if (line.isPending) continue;
          const list = perKondisi.get(line.kodeKondisi) ?? [];
          list.push({
            request_item_id: id,
            qty: line.qty,
            resi: line.rows.map((x) => x.resi).find(Boolean) ?? "",
          });
          perKondisi.set(line.kodeKondisi, list);
        }
        for (const [kode, plines] of perKondisi) {
          const locId = locByKondisi.get(kode);
          if (!locId) throw new Error(`Lokasi ${kode} belum ada di database.`);
          const { error: shipErr } = await db.rpc("sync_ship_request_items", {
            p_request_id: reqId,
            p_location_id: locId,
            p_lines: plines,
            p_notes: `Sinkron Google Sheet ${ticket ?? ""} (${kode}) — sheet ${dipakai.name}`.trim(),
            p_allow_negative: cfg.allow_negative,
          });
          if (shipErr) throw new Error(`Gagal kirim ${ticket ?? "tanpa tiket"} [${kode}]: ${shipErr.message}`);
        }
        if (hasPending) {
          await db.from("requests").update({ status: "disetujui_sebagian" }).eq("id", reqId);
        }
      } else {
        for (const { line, id } of planned) {
          await db
            .from("request_items")
            .update({
              qty_shipped: line.isPending ? 0 : line.qty,
              item_status: line.isPending ? "pending_sebagian" : "terkirim",
            })
            .eq("id", id);
        }
        await db
          .from("requests")
          .update({ status: hasPending ? "disetujui_sebagian" : "selesai" })
          .eq("id", reqId);
      }
    } catch (e) {
      if (reqId) await db.from("requests").delete().eq("id", reqId);
      result.failures.push({ ticket: ticket ?? `grup ${n}`, detail: pesanError(e) });
    }
  }

  if (!opts.dryRun && cfg.id) {
    const status = result.failures.length === 0 ? "sukses" : result.requests > 0 ? "sebagian" : "gagal";
    await db
      .from("sheet_sync_sources")
      .update({
        last_sheet: dipakai.name,
        last_run_at: new Date().toISOString(),
        last_status: status,
        last_message:
          `Sheet ${dipakai.name}: ${result.requests} permintaan, ${result.items} baris, ` +
          `${result.qty} unit` + (result.failures.length ? `, ${result.failures.length} gagal` : ""),
        last_requests: result.requests,
        last_items: result.items,
        last_qty: result.qty,
      })
      .eq("id", cfg.id);
  }
  return result;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = (body.action as string) ?? "run";
    const dryRun = action === "preview" || action === "test";
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const isService = token === SERVICE_KEY;

    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Sumber konfigurasi: dari tabel (source_id) atau parameter langsung.
    let cfg: SourceConfig | null = null;
    let actorId: string | null = null;

    if (typeof body.source_id === "string" && body.source_id) {
      const { data, error } = await db
        .from("sheet_sync_sources")
        .select("*")
        .eq("id", body.source_id)
        .maybeSingle();
      if (error) throw new Error(`Gagal membaca konfigurasi: ${error.message}`);
      if (!data) return json({ error: "Sumber sinkronisasi tidak ditemukan." }, 404);
      cfg = {
        id: data.id,
        name: data.name,
        spreadsheet_id: data.spreadsheet_id,
        sheet_mode: data.sheet_mode,
        sheet_name: data.sheet_name,
        deduct_stock: data.deduct_stock,
        allow_negative: data.allow_negative,
        auto_create_items: data.auto_create_items,
      };
    } else if (typeof body.spreadsheet_id === "string" && body.spreadsheet_id) {
      const id = extractSpreadsheetId(body.spreadsheet_id);
      if (!id) return json({ error: "Link/ID Google Sheet tidak valid." }, 400);
      cfg = {
        spreadsheet_id: id,
        sheet_mode: (body.sheet_mode as "newest" | "named") ?? "newest",
        sheet_name: (body.sheet_name as string) ?? null,
        deduct_stock: body.deduct_stock !== false,
        allow_negative: body.allow_negative !== false,
        auto_create_items: body.auto_create_items === true,
      };
    }

    if (!cfg) {
      // Tanpa parameter: jalankan semua sumber aktif (dipakai cron).
      if (!isService) return json({ error: "Hanya service role (cron) yang bisa menjalankan semua sumber." }, 403);
      const { data: sources, error } = await db
        .from("sheet_sync_sources")
        .select("*")
        .eq("is_active", true);
      if (error) throw new Error(error.message);
      const hasil: unknown[] = [];
      for (const s of sources ?? []) {
        const runId = await startRun(db, s.id, "cron");
        try {
          const res = await syncSource(
            db,
            {
              id: s.id,
              name: s.name,
              spreadsheet_id: s.spreadsheet_id,
              sheet_mode: s.sheet_mode,
              sheet_name: s.sheet_name,
              deduct_stock: s.deduct_stock,
              allow_negative: s.allow_negative,
              auto_create_items: s.auto_create_items,
            },
            { dryRun: false, actorId: null, triggeredBy: "cron" },
          );
          await finishRun(db, runId, res, "cron");
          hasil.push({ source: s.name, ...res });
        } catch (e) {
          const msg = pesanError(e);
          await db
            .from("sheet_sync_runs")
            .update({ status: "gagal", finished_at: new Date().toISOString(), message: msg })
            .eq("id", runId);
          await db
            .from("sheet_sync_sources")
            .update({ last_run_at: new Date().toISOString(), last_status: "gagal", last_message: msg })
            .eq("id", s.id);
          hasil.push({ source: s.name, error: msg });
        }
      }
      return json({ ok: true, sources: (sources ?? []).length, hasil });
    }

    // Aksi oleh pengguna: wajib punya settings.manage / super admin.
    if (!isService) {
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
        auth: { persistSession: false },
      });
      const { data: userData } = await userClient.auth.getUser();
      actorId = userData?.user?.id ?? null;
      const { data: boleh } = await userClient.rpc("has_permission", { p_code: "settings.manage" });
      const { data: superAdmin } = await userClient.rpc("is_super_admin");
      if (!boleh && !superAdmin) {
        return json({ error: "Hanya Super Admin (settings.manage) yang bisa menjalankan sinkronisasi." }, 403);
      }
    }

    if (action === "test") {
      const wb = await downloadWorkbook(cfg.spreadsheet_id);
      const parsed = parseWorkbook(wb);
      const terbaru = pickNewestSheet(parsed.sheets);
      return json({
        ok: true,
        fileId: cfg.spreadsheet_id,
        sheetsDenganData: parsed.sheets.length,
        totalSheets: parsed.sheets.length + parsed.skipped.length,
        sheetTerbaru: terbaru?.name ?? null,
        sheetTerbaruTanggal: terbaru ? parseSheetLabel(terbaru.name).date : null,
        barisSheetTerbaru: terbaru?.rows.length ?? 0,
        contohSheet: parsed.sheets.slice(-5).map((s) => ({ name: s.name, rows: s.rows.length })),
      });
    }

    const runId = dryRun ? null : await startRun(db, cfg.id ?? null, isService ? "cron" : "manual");
    try {
      const res = await syncSource(db, cfg, {
        dryRun,
        actorId,
        triggeredBy: isService ? "cron" : "manual",
      });
      if (runId) await finishRun(db, runId, res, "manual");
      return json({ ok: res.failures.length === 0, dryRun, ...res });
    } catch (e) {
      const msg = pesanError(e);
      if (runId) {
        await db
          .from("sheet_sync_runs")
          .update({ status: "gagal", finished_at: new Date().toISOString(), message: msg })
          .eq("id", runId);
      }
      if (cfg.id) {
        await db
          .from("sheet_sync_sources")
          .update({ last_run_at: new Date().toISOString(), last_status: "gagal", last_message: msg })
          .eq("id", cfg.id);
      }
      return json({ error: msg }, 400);
    }
  } catch (e) {
    return json({ error: pesanError(e) }, 400);
  }
});

async function startRun(
  db: SupabaseClient,
  sourceId: string | null,
  _triggeredBy: "cron" | "manual",
): Promise<string | null> {
  if (!sourceId) return null;
  const { data } = await db
    .from("sheet_sync_runs")
    .insert({ source_id: sourceId, status: "jalan", triggered_by: _triggeredBy })
    .select("id")
    .single();
  return (data?.id as string) ?? null;
}

async function finishRun(
  db: SupabaseClient,
  runId: string | null,
  res: ImportResult,
  triggeredBy: "cron" | "manual",
): Promise<void> {
  if (!runId) return;
  const status = res.failures.length === 0 ? "sukses" : res.requests > 0 ? "sebagian" : "gagal";
  await db
    .from("sheet_sync_runs")
    .update({
      status,
      finished_at: new Date().toISOString(),
      sheet_name: res.sheet,
      requests_created: res.requests,
      items_created: res.items,
      qty_imported: res.qty,
      rows_skipped_dup: res.rowsSkippedDup,
      message:
        `${res.rowsNew}/${res.rowsTotal} baris baru` +
        (res.rowsSkippedDup ? `, ${res.rowsSkippedDup} duplikat dilewati` : "") +
        (res.failures.length ? `, ${res.failures.length} gagal` : ""),
      detail: { failures: res.failures.slice(0, 20), preview: res.preview.slice(0, 50), triggeredBy },
    })
    .eq("id", runId);
}

// Dipakai test lokal (npm run test) agar logika bisa diuji tanpa Deno.
export { syncSource };
