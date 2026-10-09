import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { KeyRound, Plus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { PERMISSIONS, PUBLISH_PERMISSION } from "../lib/permissions";
import type { Profile, Role } from "../types/database";
import { DataTable } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { cn } from "../lib/utils";

const SELECT_CLASS =
  "flex h-10 w-full rounded-lg border border-white/15 bg-ink-850 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:border-brand-500 disabled:cursor-not-allowed disabled:opacity-50";

interface PermRow {
  id: string;
  code: string;
}

export function UsersPage() {
  const { user, isSuperAdmin } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permIdByCode, setPermIdByCode] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // Dialog tambah admin
  const [addOpen, setAddOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  // Dialog kelola izin
  const [permUser, setPermUser] = useState<Profile | null>(null);
  const [permChecks, setPermChecks] = useState<Record<string, boolean>>({});
  const [permLoading, setPermLoading] = useState(false);
  const [permSaving, setPermSaving] = useState(false);

  const roleIdByName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of roles) m[r.name] = r.id;
    return m;
  }, [roles]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [{ data: profs, error: e1 }, { data: rls }, { data: prms }] = await Promise.all([
      supabase.from("profiles").select("*, roles(name)").order("email"),
      supabase.from("roles").select("id, name"),
      supabase.from("permissions").select("id, code"),
    ]);
    if (e1) {
      toast.error("Gagal memuat data pengguna.");
    } else {
      setProfiles((profs ?? []) as Profile[]);
    }
    setRoles((rls ?? []) as Role[]);
    const map: Record<string, string> = {};
    for (const p of (prms ?? []) as PermRow[]) map[p.code] = p.id;
    setPermIdByCode(map);
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const toggleActive = async (row: Profile) => {
    if (row.id === user?.id && row.is_active) {
      toast.error("Anda tidak dapat menonaktifkan akun sendiri.");
      return;
    }
    const next = !row.is_active;
    const { error } = await supabase.from("profiles").update({ is_active: next }).eq("id", row.id);
    if (error) {
      toast.error("Gagal mengubah status pengguna.");
      return;
    }
    toast.success(next ? "Pengguna diaktifkan." : "Pengguna dinonaktifkan.");
    void fetchData();
  };

  const handleRoleChange = async (row: Profile, roleName: string) => {
    if (roleName === "super_admin" && !isSuperAdmin) {
      toast.error("Hanya Super Admin yang dapat memberi peran Super Admin.");
      return;
    }
    const roleId = roleIdByName[roleName];
    if (!roleId) {
      toast.error("Peran tidak dikenal.");
      return;
    }
    const { error } = await supabase.from("profiles").update({ role_id: roleId }).eq("id", row.id);
    if (error) {
      toast.error("Gagal mengubah peran.");
      return;
    }
    toast.success("Peran berhasil diubah.");
    void fetchData();
  };

  const openPermDialog = async (row: Profile) => {
    setPermUser(row);
    setPermLoading(true);
    setPermChecks({});
    const rolePerms = row.role_id
      ? await supabase.from("role_permissions").select("permission_id").eq("role_id", row.role_id)
      : { data: [] as { permission_id: string }[] };
    const { data: userPerms } = await supabase
      .from("user_permissions")
      .select("permission_id, granted")
      .eq("user_id", row.id);
    const roleSet = new Set((rolePerms.data ?? []).map((r) => r.permission_id));
    const override = new Map(
      ((userPerms ?? []) as { permission_id: string; granted: boolean }[]).map((r) => [
        r.permission_id,
        r.granted,
      ])
    );
    const checks: Record<string, boolean> = {};
    for (const p of PERMISSIONS) {
      const pid = permIdByCode[p.code];
      if (!pid) continue;
      checks[p.code] = override.has(pid) ? override.get(pid)! : roleSet.has(pid);
    }
    setPermChecks(checks);
    setPermLoading(false);
  };

  const savePermissions = async () => {
    if (!permUser || !user) return;
    setPermSaving(true);
    const rows = PERMISSIONS.filter((p) => permIdByCode[p.code]).map((p) => ({
      user_id: permUser.id,
      permission_id: permIdByCode[p.code],
      granted: permChecks[p.code] === true,
      granted_by: user.id,
      granted_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from("user_permissions")
      .upsert(rows, { onConflict: "user_id,permission_id" });
    setPermSaving(false);
    if (error) {
      toast.error("Gagal menyimpan izin.");
      return;
    }
    toast.success("Izin berhasil disimpan.");
    setPermUser(null);
  };

  const handleAddAdmin = async () => {
    if (!newEmail.trim() || !newPassword) {
      toast.error("Email dan password wajib diisi.");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("Password minimal 6 karakter.");
      return;
    }
    setAdding(true);
    const { error } = await supabase.auth.signUp({
      email: newEmail.trim(),
      password: newPassword,
      options: { data: { full_name: newName.trim() || null } },
    });
    setAdding(false);
    if (error) {
      toast.error(`Gagal membuat admin: ${error.message}`);
      return;
    }
    toast.success(
      "Admin dibuat. Pengguna harus mengonfirmasi email sebelum bisa masuk (nonaktifkan konfirmasi email di dashboard Supabase bila tidak diperlukan)."
    );
    setAddOpen(false);
    setNewEmail("");
    setNewPassword("");
    setNewName("");
    void fetchData();
  };

  const columns = useMemo<ColumnDef<Profile, unknown>[]>(
    () => [
      {
        id: "nama",
        header: "Nama",
        cell: ({ row }) => row.original.full_name || "—",
      },
      { id: "email", header: "Email", accessorKey: "email" },
      {
        id: "peran",
        header: "Peran",
        cell: ({ row }) => {
          const roleName = row.original.roles?.name;
          return roleName === "super_admin" ? (
            <Badge variant="default">Super Admin</Badge>
          ) : (
            <Badge variant="secondary">Admin</Badge>
          );
        },
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={row.original.is_active ? "success" : "secondary"}>
            {row.original.is_active ? "Aktif" : "Nonaktif"}
          </Badge>
        ),
      },
      {
        id: "aksi",
        header: "Aksi",
        cell: ({ row }) => {
          const r = row.original;
          const roleName = r.roles?.name ?? "admin";
          const canChangeRole = isSuperAdmin || roleName !== "super_admin";
          return (
            <div className="flex flex-wrap items-center gap-1">
              <Button variant="outline" size="sm" onClick={() => void toggleActive(r)}>
                {r.is_active ? "Nonaktifkan" : "Aktifkan"}
              </Button>
              {canChangeRole ? (
                <select
                  aria-label="Ubah peran"
                  className={cn(SELECT_CLASS, "h-9 w-36")}
                  value={roleName}
                  onChange={(e) => void handleRoleChange(r, e.target.value)}
                >
                  <option value="admin">Admin</option>
                  <option value="super_admin" disabled={!isSuperAdmin}>
                    Super Admin
                  </option>
                </select>
              ) : (
                <Badge variant="default">Super Admin</Badge>
              )}
              <Button variant="ghost" size="sm" onClick={() => void openPermDialog(r)}>
                <KeyRound className="mr-1 h-4 w-4" /> Kelola Izin
              </Button>
            </div>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isSuperAdmin, roleIdByName, permIdByCode, user]
  );

  return (
    <div>
      <PageHeader
        title="Pengguna"
        description="Kelola akun admin, peran, dan izin akses."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <UserPlus className="mr-2 h-4 w-4" /> Tambah Admin
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={profiles}
        loading={loading}
        searchPlaceholder="Cari nama, email…"
      />

      {/* Dialog tambah admin */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogHeader>
          <DialogTitle>Tambah Admin</DialogTitle>
          <DialogDescription>
            Buat akun admin baru. Pengguna harus mengonfirmasi email sebelum bisa masuk — atau
            nonaktifkan konfirmasi email di dashboard Supabase (Authentication → Providers → Email).
            <span className="mt-1 block font-medium text-amber-300">
              Catatan: jika konfirmasi email dimatikan, akun baru akan langsung masuk dan sesi Anda
              bisa terganggu.
            </span>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="adm-name">Nama Lengkap</Label>
            <Input
              id="adm-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="cth. Budi Santoso"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adm-email">
              Email <span className="text-rose-400">*</span>
            </Label>
            <Input
              id="adm-email"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="admin@perusahaan.id"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adm-pass">
              Password <span className="text-rose-400">*</span>
            </Label>
            <Input
              id="adm-pass"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Minimal 6 karakter"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAddOpen(false)} disabled={adding}>
            Batal
          </Button>
          <Button onClick={() => void handleAddAdmin()} disabled={adding}>
            <Plus className="mr-2 h-4 w-4" />
            {adding ? "Membuat…" : "Buat Admin"}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Dialog kelola izin */}
      <Dialog open={permUser !== null} onOpenChange={(o) => !o && setPermUser(null)}>
        <DialogHeader>
          <DialogTitle>Kelola Izin</DialogTitle>
          <DialogDescription>
            {permUser?.email} — nilai awal mengikuti peran, perubahan disimpan sebagai izin khusus
            pengguna.
          </DialogDescription>
        </DialogHeader>
        {permLoading ? (
          <p className="py-6 text-center text-sm text-slate-500">Memuat izin…</p>
        ) : (
          <div className="max-h-[50vh] space-y-1 overflow-y-auto pr-1">
            {PERMISSIONS.map((p) => {
              const locked = p.code === PUBLISH_PERMISSION && !isSuperAdmin;
              return (
                <label
                  key={p.code}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border border-white/10 p-3 hover:bg-white/[0.03] ${
                    locked ? "opacity-70" : ""
                  }`}
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={permChecks[p.code] === true}
                    disabled={locked}
                    onChange={(e) =>
                      setPermChecks((prev) => ({ ...prev, [p.code]: e.target.checked }))
                    }
                  />
                  <span>
                    <span className="block font-mono text-xs font-semibold text-white">
                      {p.code}
                    </span>
                    <span className="block text-xs text-slate-500">{p.description}</span>
                    {locked && (
                      <span className="mt-1 block text-xs font-medium text-amber-300">
                        Hanya Super Admin — ditegakkan juga di database.
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setPermUser(null)} disabled={permSaving}>
            Batal
          </Button>
          <Button onClick={() => void savePermissions()} disabled={permSaving || permLoading}>
            {permSaving ? "Menyimpan…" : "Simpan Izin"}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
