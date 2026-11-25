// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Tes integrasi PostgreSQL (PGlite) untuk migrasi Fase 3
 * (`20261126000002_phase3_security_hardening.sql`):
 *  1. Idempotensi migrasi.
 *  2. Akun nonaktif di `user_accounts` tidak lolos `is_super_admin()` / `is_staff()`
 *     meski `profiles.is_active` masih true.
 *  3. `audit_logs` bersifat append-only (INSERT diizinkan, UPDATE & DELETE ditolak).
 *  4. Semua fungsi `SECURITY DEFINER` di `public` otomatis terkunci `search_path`.
 *  5. Semua indeks performa terbentuk.
 */

const phase3Sql = readFileSync(
  new URL(
    "../../supabase/migrations/20261126000002_phase3_security_hardening.sql",
    import.meta.url
  ),
  "utf8"
);

const UID_DEACTIVATED_SA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const UID_ACTIVE_SA = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ROLE_SA = "cccccccc-cccc-cccc-cccc-cccccccccccc";

let db: PGlite;

describe("Fase 3 security hardening (PostgreSQL/PGlite)", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE SCHEMA IF NOT EXISTS extensions;
      CREATE SCHEMA IF NOT EXISTS auth;
      DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;

      CREATE TABLE public.roles (id uuid PRIMARY KEY, name text UNIQUE NOT NULL);
      CREATE TABLE public.profiles (id uuid PRIMARY KEY, role_id uuid REFERENCES public.roles(id), is_active boolean DEFAULT true);
      CREATE TABLE public.user_accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_user_id uuid UNIQUE, role text, is_active boolean DEFAULT true);
      CREATE TABLE public.audit_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_id uuid,
        action text NOT NULL,
        entity_type text NOT NULL,
        entity_id text,
        old_data jsonb,
        new_data jsonb,
        created_at timestamptz DEFAULT now()
      );
      CREATE TABLE public.inventory_transactions (id uuid PRIMARY KEY, transaction_date date, type text, status text, reference text);
      CREATE TABLE public.inventory_ledger (id uuid PRIMARY KEY, item_id uuid, created_at timestamptz);
      CREATE TABLE public.requests (id uuid PRIMARY KEY, ticket_no text, request_date date);
      CREATE TABLE public.request_items (id uuid PRIMARY KEY, item_status text);

      -- Simulasi fungsi SECURITY DEFINER lama tanpa search_path.
      CREATE FUNCTION public.legacy_secdef_fn() RETURNS integer LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;

      INSERT INTO public.roles (id, name) VALUES ('${ROLE_SA}', 'super_admin');
      INSERT INTO public.profiles (id, role_id, is_active) VALUES
        ('${UID_DEACTIVATED_SA}', '${ROLE_SA}', true),
        ('${UID_ACTIVE_SA}', '${ROLE_SA}', true);
      INSERT INTO public.user_accounts (auth_user_id, role, is_active) VALUES
        ('${UID_DEACTIVATED_SA}', 'super_admin', false),
        ('${UID_ACTIVE_SA}', 'super_admin', true);
    `);

    await db.exec(phase3Sql);
  });

  afterAll(async () => {
    await db.close();
  });

  it("1. migrasi Fase 3 bersifat idempoten", async () => {
    await expect(db.exec(phase3Sql)).resolves.not.toThrow();
  });

  it("2. akun nonaktif di user_accounts langsung ditolak is_super_admin() & is_staff() tanpa fallback profiles", async () => {
    await db.query(`SELECT set_config('test.uid', $1, false)`, [UID_DEACTIVATED_SA]);
    const deactivated = (
      await db.query<{ sa: boolean; staff: boolean }>(
        `SELECT public.is_super_admin() AS sa, public.is_staff() AS staff`
      )
    ).rows[0];
    expect(deactivated.sa).toBe(false);
    expect(deactivated.staff).toBe(false);

    await db.query(`SELECT set_config('test.uid', $1, false)`, [UID_ACTIVE_SA]);
    const active = (
      await db.query<{ sa: boolean; staff: boolean }>(
        `SELECT public.is_super_admin() AS sa, public.is_staff() AS staff`
      )
    ).rows[0];
    expect(active.sa).toBe(true);
    expect(active.staff).toBe(true);
  });

  it("3. audit_logs bersifat permanen (INSERT ok, UPDATE & DELETE ditolak)", async () => {
    const id = (
      await db.query<{ id: string }>(
        `INSERT INTO public.audit_logs (action, entity_type, entity_id) VALUES ('INSERT', 'requests', 'req-1') RETURNING id`
      )
    ).rows[0].id;

    await expect(
      db.query(`UPDATE public.audit_logs SET action = 'TAMPERED' WHERE id = $1`, [id])
    ).rejects.toThrow(/permanen/i);
    await expect(
      db.query(`DELETE FROM public.audit_logs WHERE id = $1`, [id])
    ).rejects.toThrow(/permanen/i);
  });

  it("4. semua fungsi SECURITY DEFINER di public otomatis memiliki search_path terkunci", async () => {
    const unpinned = await db.query<{ sig: string }>(`
      SELECT p.oid::regprocedure::text AS sig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.prosecdef = true
         AND NOT EXISTS (
           SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) cfg
            WHERE cfg LIKE 'search_path=%'
         )
    `);
    expect(unpinned.rows).toEqual([]);
  });

  it("5. semua indeks performa utama terbentuk", async () => {
    const idx = await db.query<{ indexname: string }>(`
      SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname IN (
           'idx_inv_txn_date_type_status',
           'idx_inv_txn_reference',
           'idx_inv_ledger_item_created',
           'idx_request_items_status',
           'idx_requests_ticket_date',
           'idx_audit_logs_created_at',
           'idx_audit_logs_entity'
         )
       ORDER BY indexname
    `);
    expect(idx.rows.length).toBe(7);
  });
});
