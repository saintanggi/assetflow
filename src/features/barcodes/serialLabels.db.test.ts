// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const userA = "00000000-0000-0000-0000-000000000001";
const userB = "00000000-0000-0000-0000-000000000002";
const item = "10000000-0000-0000-0000-000000000001";
const asset = "20000000-0000-0000-0000-000000000001";
const request = (n: number) => `30000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
let db: PGlite;
const migration = readFileSync(new URL("../../../supabase/migrations/20261019000038_serial_qr_labels.sql", import.meta.url), "utf8");
const allocate = (id: number, quantity: number | null, assetId: string | null = null, itemId: string | null = item) =>
  db.query<{ code: string; batch_id: string }>("SELECT * FROM public.allocate_qr_labels($1,$2,$3,$4)", [request(id), quantity, assetId, itemId]);

describe("migrasi nomor QR (PostgreSQL/PGlite)", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users(id uuid PRIMARY KEY);
      INSERT INTO auth.users VALUES ('${userA}'), ('${userB}');
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
      CREATE FUNCTION public.has_permission(text) RETURNS boolean LANGUAGE sql STABLE AS
        $$ SELECT coalesce(current_setting('test.allowed', true), '') = 'yes' $$;
      CREATE TABLE public.assets(id uuid PRIMARY KEY, name text, archived boolean DEFAULT false, asset_code text DEFAULT 'AST-001');
      CREATE TABLE public.inventory_items(id uuid PRIMARY KEY, name text, sku text DEFAULT 'SKU-001', barcode text);
      CREATE TABLE public.request_items(barcode text);
      INSERT INTO public.assets(id,name,archived) VALUES ('${asset}', 'Laptop A', false);
      INSERT INTO public.inventory_items(id,name) VALUES ('${item}', 'Monitor');
      SET test.uid = '${userA}'; SET test.allowed = 'yes';
    `);
    await db.exec(migration);
  }, 30_000);
  afterAll(async () => { await db?.close(); });

  it("memesan rentang 12 digit berurutan, tetap saat retry", async () => {
    const first = await allocate(1, 3);
    expect(first.rows.map((row) => row.code)).toEqual(["000000000001", "000000000002", "000000000003"]);
    expect((await allocate(1, 3)).rows).toEqual(first.rows);
    await expect(allocate(1, 4)).rejects.toThrow("data berbeda");
  });

  it("pengguna lain melanjutkan penghitung yang sama", async () => {
    await db.exec(`SET test.uid = '${userB}'`);
    expect((await allocate(2, 2)).rows.map((row) => row.code)).toEqual(["000000000004", "000000000005"]);
    await expect(allocate(1, 3)).rejects.toThrow("data berbeda");
  });

  it("aset yang sama selalu kembali ke nomor lama, lintas user dan request", async () => {
    const first = await allocate(3, 1, asset, null);
    expect(first.rows[0].code).toBe("000000000006");
    await db.exec(`SET test.uid = '${userA}'`);
    expect((await allocate(4, 1, asset, null)).rows).toEqual(first.rows);
    expect((await allocate(5, 1)).rows[0].code).toBe("000000000007");
  });

  it("menolak input tidak valid tanpa menghabiskan nomor", async () => {
    for (const n of [0, -1, 501, null]) await expect(allocate(6, n)).rejects.toThrow("Pilih satu");
    await expect(allocate(6, 2, asset, null)).rejects.toThrow("Pilih satu");
    await expect(allocate(6, 1, asset, item)).rejects.toThrow("Pilih satu");
    await expect(allocate(6, 1, null, null)).rejects.toThrow("Pilih satu");
    await expect(allocate(6, 1, null, "10000000-0000-0000-0000-000000000099")).rejects.toThrow("tidak ditemukan");
    expect((await allocate(6, 1)).rows[0].code).toBe("000000000008");
  });

  it("rollback kegagalan insert tidak menyisakan batch atau memajukan penghitung", async () => {
    await db.exec(`CREATE FUNCTION public.test_reject_label() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'printer test failure'; END $$;
      CREATE TRIGGER test_reject_label BEFORE INSERT ON public.qr_serial_labels FOR EACH ROW EXECUTE FUNCTION public.test_reject_label();`);
    await expect(allocate(7, 2)).rejects.toThrow("printer test failure");
    expect((await db.query("SELECT * FROM public.qr_label_batches WHERE id = $1", [request(7)])).rows).toHaveLength(0);
    await db.exec("DROP TRIGGER test_reject_label ON public.qr_serial_labels");
    expect((await allocate(7, 2)).rows.map((row) => row.code)).toEqual(["000000000009", "000000000010"]);
  });

  it("banyak permintaan menghasilkan nomor unik dan satu rentang per batch", async () => {
    // PGlite menserialisasi koneksi; tes contention multi-koneksi tetap perlu PostgreSQL staging.
    const results = await Promise.all(Array.from({ length: 10 }, (_, n) => allocate(20 + n, 3)));
    const codes = results.flatMap((result) => result.rows.map((row) => row.code));
    expect(new Set(codes).size).toBe(30);
    expect(codes.sort()[0]).toBe("000000000011");
    expect(codes.sort().at(-1)).toBe("000000000040");
    for (const result of results) expect(Number(result.rows[2].code) - Number(result.rows[0].code)).toBe(2);
  });

  it("RLS dan RPC menolak akun tanpa izin, insert langsung tetap dilarang", async () => {
    await db.exec("SET ROLE authenticated; SET test.allowed = 'no'");
    expect((await db.query("SELECT * FROM public.qr_serial_labels")).rows).toHaveLength(0);
    expect((await db.query("SELECT * FROM public.qr_label_batches")).rows).toHaveLength(0);
    await expect(allocate(60, 1)).rejects.toThrow("Tidak memiliki izin");
    await db.exec("SET test.allowed = 'yes'");
    expect((await db.query("SELECT * FROM public.qr_serial_labels")).rows).toHaveLength(40);
    await expect(db.exec("UPDATE public.qr_label_counter SET last_number = 0")).rejects.toThrow("permission denied");
    await expect(db.exec(`INSERT INTO public.qr_serial_labels(number,batch_id) VALUES (999,'${request(1)}')`)).rejects.toThrow("permission denied");
    await db.exec("RESET ROLE; SET test.uid = ''");
    await expect(allocate(61, 1)).rejects.toThrow("Tidak memiliki izin");
    await db.exec(`SET test.uid = '${userA}'`);
  });

  it("scanner memetakan QR ke aset/barang tanpa menulis data", async () => {
    expect((await db.query("SELECT * FROM public.resolve_qr_label('000000000001')")).rows)
      .toEqual([{ kind: "item", id: item, code: "SKU-001", name: "Monitor" }]);
    expect((await db.query("SELECT * FROM public.resolve_qr_label('000000000006')")).rows)
      .toEqual([{ kind: "asset", id: asset, code: "AST-001", name: "Laptop A" }]);
    await db.exec("SET test.allowed = 'no'");
    expect((await db.query("SELECT * FROM public.resolve_qr_label('000000000001')")).rows).toEqual([]);
    await db.exec("SET test.allowed = 'yes'");
  });

  it("inisialisasi melanjutkan nomor lama termasuk barcode multi-baris", async () => {
    await db.exec(`BEGIN;
      UPDATE public.assets SET asset_code = '000000000123';
      UPDATE public.inventory_items SET barcode = '000000000456';
      INSERT INTO public.request_items VALUES (E'ABC\\n000000000789\\r\\n99999999999999999999');`);
    try {
      const seedSelect = migration.slice(migration.indexOf("SELECT true, coalesce(max"), migration.indexOf("CREATE TABLE public.qr_label_batches"));
      expect((await db.query<{ coalesce: number }>(seedSelect)).rows[0].coalesce).toBe(789);
    } finally { await db.exec("ROLLBACK"); }
  });

  it("melindungi batas 12 digit dari pemotongan lpad", async () => {
    await db.exec("UPDATE public.qr_label_counter SET last_number = 999999999998");
    await expect(allocate(70, 2)).rejects.toThrow("mencapai batas");
    expect((await allocate(70, 1)).rows[0].code).toBe("999999999999");
  });
});
