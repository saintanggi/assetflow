import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Plus, Power } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { DataTable } from "../components/DataTable";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import type { ColumnDef } from "@tanstack/react-table";

interface Account {
  username: string;
  role: string;
  display_name: string;
  is_active: boolean;
  created_at: string;
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin_ho: "Admin HO",
  admin_gudang: "Admin Gudang",
  helper: "Helper Gudang",
};

export function UserManagementPage() {
  const { isSuperAdmin } = useAuth();
  const [rows, setRows] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  const [showAdd, setShowAdd] = useState(false);
  const [fUsername, setFUsername] = useState("");
  const [fPassword, setFPassword] = useState("");
  const [fName, setFName] = useState("");
  const [fRole, setFRole] = useState("helper");
  const [saving, setSaving] = useState(false);

  const [resetUser, setResetUser] = useState<Account | null>(null);
  const [newPass, setNewPass] = useState("");
  const [resetting, setResetting] = useState(false);

  const callFn = async (action: string, payload: Record<string, unknown> = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-users`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ action, ...payload }),
      }
    );
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error ?? "Gagal memanggil server");
    return json;
  };

  const load = async () => {
    setLoading(true);
    try {
      const json = await callFn("list");
      setRows(json.accounts ?? []);
    } catch {
      // Fallback baca langsung via RLS bila Edge Function belum di-redeploy.
      const { data, error } = await supabase
        .from("user_accounts")
        .select("username, role, display_name, is_active, created_at")
        .order("created_at", { ascending: false });
      if (error) {
        toast.error(error.message);
      } else {
        setRows((data ?? []) as Account[]);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async () => {
    setSaving(true);
    try {
      await callFn("create", {
        username: fUsername,
        password: fPassword,
        display_name: fName,
        role: fRole,
      });
      toast.success(`Akun "${fUsername}" dibuat.`);
      setShowAdd(false);
      setFUsername(""); setFPassword(""); setFName(""); setFRole("helper");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membuat akun");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!resetUser) return;
    setResetting(true);
    try {
      await callFn("reset-password", { username: resetUser.username, password: newPass });
      toast.success("Password direset.");
      setResetUser(null);
      setNewPass("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal reset password");
    } finally {
      setResetting(false);
    }
  };

  const toggleActive = async (acc: Account) => {
    try {
      try {
        await callFn("set-active", { username: acc.username, is_active: !acc.is_active });
      } catch {
        const { error } = await supabase
          .from("user_accounts")
          .update({ is_active: !acc.is_active, updated_at: new Date().toISOString() })
          .eq("username", acc.username);
        if (error) throw new Error(error.message);
      }
      toast.success(acc.is_active ? "Akun dinonaktifkan." : "Akun diaktifkan.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengubah status");
    }
  };

  if (!isSuperAdmin) {
    return (
      <div className="py-20 text-center text-ink-500">
        Hanya Super Admin yang bisa mengakses halaman ini.
      </div>
    );
  }

  const columns: ColumnDef<Account, unknown>[] = [
    { header: "Username", accessorKey: "username",
      cell: ({ row }) => <span className="font-mono text-sm text-brand-700">{row.original.username}</span> },
    { header: "Nama", accessorKey: "display_name" },
    { header: "Role", accessorKey: "role",
      cell: ({ row }) => <Badge>{ROLE_LABELS[row.original.role] ?? row.original.role}</Badge> },
    { header: "Status", accessorKey: "is_active",
      cell: ({ row }) => (
        <Badge variant={row.original.is_active ? "success" : "destructive"}>
          {row.original.is_active ? "Aktif" : "Nonaktif"}
        </Badge>
      ) },
    {
      header: "", id: "aksi",
      cell: ({ row }) => (
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={() => setResetUser(row.original)} title="Reset password">
            <KeyRound className="h-3 w-3" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => toggleActive(row.original)} title={row.original.is_active ? "Nonaktifkan" : "Aktifkan"}>
            <Power className="h-3 w-3" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Kelola Akun"
        description="Buat akun operasional (username + password) untuk tim. Tanpa email."
        actions={
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="mr-1 h-4 w-4" /> Buat Akun
          </Button>
        }
      />

      <DataTable<Account>
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Cari username / nama…"
        pageSize={15}
        emptyTitle="Belum ada akun operasional"
        emptyDescription="Buat akun untuk tim gudang / HO."
      />

      <Dialog open={showAdd} onOpenChange={(o) => !o && setShowAdd(false)}>
        <DialogHeader>
          <DialogTitle>Buat Akun Baru</DialogTitle>
          <DialogDescription>Akun login pakai username + password. Permanen tersimpan di database.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 px-1 py-2">
          <div className="space-y-1.5">
            <Label>Username</Label>
            <Input value={fUsername} onChange={(e) => setFUsername(e.target.value.toLowerCase())} placeholder="cth: helper1" />
            <p className="text-xs text-ink-500">Huruf kecil, angka, _ . - (3-30 karakter)</p>
          </div>
          <div className="space-y-1.5">
            <Label>Nama Tampilan</Label>
            <Input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="cth: Budi Helper" />
          </div>
          <div className="space-y-1.5">
            <Label>Password</Label>
            <Input type="password" value={fPassword} onChange={(e) => setFPassword(e.target.value)} placeholder="Minimal 6 karakter" />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <select
              value={fRole}
              onChange={(e) => setFRole(e.target.value)}
              className="w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-800"
            >
              <option value="helper">Helper Gudang</option>
              <option value="admin_gudang">Admin Gudang</option>
              <option value="admin_ho">Admin HO</option>
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowAdd(false)} disabled={saving}>Batal</Button>
          <Button onClick={handleCreate} disabled={saving}>{saving ? "Menyimpan…" : "Buat Akun"}</Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={!!resetUser} onOpenChange={(o) => !o && setResetUser(null)}>
        <DialogHeader>
          <DialogTitle>Reset Password — {resetUser?.username}</DialogTitle>
          <DialogDescription>Masukkan password baru (minimal 6 karakter).</DialogDescription>
        </DialogHeader>
        <div className="px-1 py-2">
          <Label>Password Baru</Label>
          <Input type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setResetUser(null)} disabled={resetting}>Batal</Button>
          <Button onClick={handleReset} disabled={resetting}>{resetting ? "Menyimpan…" : "Reset"}</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
