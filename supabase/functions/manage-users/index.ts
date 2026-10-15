// Edge Function: manage-users
// Superadmin kelola akun operasional (username + password).
// Auth: hanya user dengan permission users.manage (dicek via JWT + RPC).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // Verifikasi JWT pemanggil.
    const authHeader = req.headers.get("authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    const caller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: perm } = await caller.rpc("has_permission", { p_code: "users.manage" });
    if (!perm) return json({ error: "Forbidden: butuh permission users.manage" }, 403);

    const { data: { user: callerUser } } = await caller.auth.getUser(jwt);

    const body = await req.json();
    const action = body.action as string;

    // --- CREATE ---
    if (action === "create") {
      const username = String(body.username ?? "").toLowerCase().trim();
      const password = String(body.password ?? "");
      const role = String(body.role ?? "");
      const display_name = String(body.display_name ?? "").trim();

      if (!/^[a-z0-9_.-]{3,30}$/.test(username))
        return json({ error: "Username 3-30 karakter: huruf kecil, angka, _ . -" }, 400);
      if (password.length < 6)
        return json({ error: "Password minimal 6 karakter" }, 400);
      if (!["admin_ho", "admin_gudang", "helper"].includes(role))
        return json({ error: "Role tidak valid" }, 400);
      if (!display_name)
        return json({ error: "Nama tampilan wajib diisi" }, 400);

      const email = `${username}@inventory.internal`;

      // Cek username sudah ada.
      const { data: existing } = await admin
        .from("user_accounts")
        .select("id")
        .eq("username", username)
        .maybeSingle();
      if (existing) return json({ error: "Username sudah dipakai" }, 409);

      // Buat auth user.
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { username, full_name: display_name, display_name, role },
      });
      if (cErr) return json({ error: `Gagal buat user auth: ${cErr.message}` }, 500);

      // Simpan mapping.
      const { error: mErr } = await admin.from("user_accounts").insert({
        username,
        auth_user_id: created.user.id,
        role,
        display_name,
        is_active: true,
        created_by: callerUser?.id ?? null,
      });
      if (mErr) {
        await admin.auth.admin.deleteUser(created.user.id);
        return json({ error: `Gagal simpan akun: ${mErr.message}` }, 500);
      }

      // Sinkronkan juga ke tabel profiles (agar FK & join profiles tetap valid).
      const { data: roleRow } = await admin
        .from("roles")
        .select("id")
        .eq("name", role)
        .maybeSingle();
      await admin.from("profiles").upsert({
        id: created.user.id,
        email,
        full_name: display_name,
        role_id: roleRow?.id ?? null,
        is_active: true,
      });

      return json({ ok: true, username });
    }

    // --- RESET PASSWORD ---
    if (action === "reset-password") {
      const username = String(body.username ?? "").toLowerCase().trim();
      const password = String(body.password ?? "");
      if (password.length < 6)
        return json({ error: "Password minimal 6 karakter" }, 400);

      const { data: acc } = await admin
        .from("user_accounts")
        .select("auth_user_id")
        .eq("username", username)
        .maybeSingle();
      if (!acc?.auth_user_id) return json({ error: "Akun tidak ditemukan" }, 404);

      const { error } = await admin.auth.admin.updateUserById(acc.auth_user_id, { password });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // --- SET ACTIVE ---
    if (action === "set-active") {
      const username = String(body.username ?? "").toLowerCase().trim();
      const is_active = !!body.is_active;

      const { data: acc } = await admin
        .from("user_accounts")
        .select("auth_user_id")
        .eq("username", username)
        .maybeSingle();
      if (!acc?.auth_user_id) return json({ error: "Akun tidak ditemukan" }, 404);

      await admin.from("user_accounts").update({ is_active }).eq("username", username);
      await admin.from("profiles").update({ is_active }).eq("id", acc.auth_user_id);
      // Ban/unban auth user juga.
      await admin.auth.admin.updateUserById(acc.auth_user_id, {
        ban_duration: is_active ? "none" : "876000h",
      });
      return json({ ok: true });
    }

    // --- LIST ---
    if (action === "list") {
      const { data } = await admin
        .from("user_accounts")
        .select("username, role, display_name, is_active, created_at")
        .order("created_at", { ascending: false });
      return json({ ok: true, accounts: data ?? [] });
    }

    return json({ error: "Action tidak dikenal" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Internal error" }, 500);
  }
});
