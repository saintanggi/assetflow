import { useCallback, useEffect, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Info, KeyRound, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { formatDateTime } from "../lib/format";
import { DataTable } from "../components/DataTable";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import type { AppSetting } from "../types/database";

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [valueText, setValueText] = useState("");
  const [saving, setSaving] = useState(false);
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwSaving, setPwSaving] = useState(false);

  const handlePasswordChange = async () => {
    if (pw1.length < 6) {
      toast.error("Password minimal 6 karakter.");
      return;
    }
    if (pw1 !== pw2) {
      toast.error("Konfirmasi password tidak sama.");
      return;
    }
    setPwSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pw1 });
    setPwSaving(false);
    if (error) {
      toast.error("Gagal mengubah kata sandi. Coba lagi.");
      return;
    }
    toast.success("Kata sandi berhasil diubah.");
    setPw1("");
    setPw2("");
  };

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("app_settings").select("*").order("key");
    if (error) {
      toast.error("Gagal memuat pengaturan.");
    } else {
      setSettings((data ?? []) as AppSetting[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  const openCreate = () => {
    setEditingKey(null);
    setKey("");
    setValueText("");
    setDialogOpen(true);
  };

  const openEdit = (s: AppSetting) => {
    setEditingKey(s.key);
    setKey(s.key);
    setValueText(JSON.stringify(s.value, null, 2));
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const trimmedKey = key.trim();
    if (!trimmedKey) {
      toast.error("Key wajib diisi.");
      return;
    }
    let parsed: unknown;
    try {
      parsed = valueText.trim() === "" ? null : JSON.parse(valueText);
    } catch {
      toast.error("Value bukan JSON yang valid.");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: trimmedKey, value: parsed }, { onConflict: "key" });
    setSaving(false);
    if (error) {
      toast.error("Gagal menyimpan pengaturan.");
      return;
    }
    toast.success("Pengaturan berhasil disimpan.");
    setDialogOpen(false);
    void fetchSettings();
  };

  const columns: ColumnDef<AppSetting, unknown>[] = [
    {
      id: "key",
      header: "Key",
      cell: ({ row }) => <span className="font-mono text-xs font-semibold">{row.original.key}</span>,
    },
    {
      id: "value",
      header: "Value (JSON)",
      cell: ({ row }) => (
        <pre className="max-w-md overflow-hidden text-ellipsis whitespace-pre-wrap break-all font-mono text-xs text-slate-600">
          {JSON.stringify(row.original.value, null, 2)}
        </pre>
      ),
    },
    {
      id: "updated",
      header: "Diubah",
      cell: ({ row }) => (
        <span className="whitespace-nowrap">{formatDateTime(row.original.updated_at)}</span>
      ),
    },
    {
      id: "aksi",
      header: "Aksi",
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" onClick={() => openEdit(row.original)}>
          <Pencil className="mr-1 h-4 w-4" /> Ubah
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Pengaturan"
        description="Konfigurasi aplikasi dalam bentuk key–value JSON."
        actions={
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> Tambah Key
          </Button>
        }
      />

      <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <p>
          Hanya Super Admin &amp; pemegang izin <span className="font-mono font-semibold">settings.manage</span>{" "}
          yang dapat mengubah pengaturan ini. Nilai harus berupa JSON yang valid.
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-brand-600" />
            <CardTitle className="text-lg">Keamanan Akun</CardTitle>
          </div>
          <CardDescription>
            Ubah kata sandi akun Anda yang sedang masuk.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid max-w-md gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="pw-baru">Kata sandi baru</Label>
              <Input
                id="pw-baru"
                type="password"
                autoComplete="new-password"
                placeholder="Minimal 6 karakter"
                value={pw1}
                onChange={(e) => setPw1(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw-konfirmasi">Konfirmasi kata sandi baru</Label>
              <Input
                id="pw-konfirmasi"
                type="password"
                autoComplete="new-password"
                placeholder="Ketik ulang kata sandi baru"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
              />
            </div>
            <div>
              <Button onClick={() => void handlePasswordChange()} disabled={pwSaving}>
                {pwSaving ? "Menyimpan…" : "Simpan kata sandi baru"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        data={settings}
        loading={loading}
        searchPlaceholder="Cari key…"
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogHeader>
          <DialogTitle>{editingKey ? "Ubah Pengaturan" : "Tambah Pengaturan"}</DialogTitle>
          <DialogDescription>
            {editingKey
              ? "Ubah nilai JSON untuk key ini."
              : "Tambahkan key konfigurasi baru beserta nilai JSON-nya."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="set-key">
              Key <span className="text-red-500">*</span>
            </Label>
            <Input
              id="set-key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="cth. app.name"
              readOnly={editingKey !== null}
              disabled={editingKey !== null}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="set-value">Value (JSON)</Label>
            <Textarea
              id="set-value"
              rows={8}
              value={valueText}
              onChange={(e) => setValueText(e.target.value)}
              placeholder='cth. {"nama": "AssetFlow"}'
              className="font-mono text-xs"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
            Batal
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Menyimpan…" : "Simpan"}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
