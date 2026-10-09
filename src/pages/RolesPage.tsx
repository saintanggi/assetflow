import { useCallback, useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { PERMISSIONS, PUBLISH_PERMISSION } from "../lib/permissions";
import type { Role } from "../types/database";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/badge";
import { Checkbox } from "../components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { Skeleton } from "../components/ui/skeleton";

export function RolesPage() {
  const { isSuperAdmin } = useAuth();
  const [roles, setRoles] = useState<Role[]>([]);
  const [permIdByCode, setPermIdByCode] = useState<Record<string, string>>({});
  const [grants, setGrants] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [{ data: rls }, { data: prms }, { data: rp }] = await Promise.all([
      supabase.from("roles").select("id, name").order("name"),
      supabase.from("permissions").select("id, code"),
      supabase.from("role_permissions").select("role_id, permission_id"),
    ]);
    setRoles((rls ?? []) as Role[]);
    const map: Record<string, string> = {};
    for (const p of (prms ?? []) as { id: string; code: string }[]) map[p.code] = p.id;
    setPermIdByCode(map);
    setGrants(
      new Set(
        ((rp ?? []) as { role_id: string; permission_id: string }[]).map(
          (r) => `${r.role_id}:${r.permission_id}`
        )
      )
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleToggle = async (role: Role, code: string, checked: boolean) => {
    const permId = permIdByCode[code];
    if (!permId) return;
    if (code === PUBLISH_PERMISSION && !isSuperAdmin) {
      toast.error("Hanya Super Admin yang dapat memberi izin ini.");
      return;
    }
    const key = `${role.id}:${permId}`;
    setBusyKey(key);
    // Optimistic update
    setGrants((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
    const { error } = checked
      ? await supabase.from("role_permissions").insert({ role_id: role.id, permission_id: permId })
      : await supabase
          .from("role_permissions")
          .delete()
          .eq("role_id", role.id)
          .eq("permission_id", permId);
    setBusyKey(null);
    if (error) {
      toast.error("Gagal menyimpan perubahan.");
      void fetchData();
    } else {
      toast.success("Izin peran diperbarui.");
    }
  };

  const orderedRoles = useMemo(
    () =>
      [...roles].sort((a, b) =>
        a.name === "super_admin" ? -1 : b.name === "super_admin" ? 1 : 0
      ),
    [roles]
  );

  return (
    <div>
      <PageHeader
        title="Peran & Izin"
        description="Atur izin bawaan untuk setiap peran."
      />

      <div className="mb-6 flex items-start gap-3 rounded-xl border border-sky-400/20 bg-sky-400/5 p-4 text-sm text-sky-200">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" />
        <div>
          <p className="font-semibold">Cara kerja matriks izin</p>
          <p className="mt-1 text-sky-300">
            Setiap peran memiliki izin bawaan. Izin khusus per pengguna (di halaman Pengguna) akan
            menimpa izin peran: centang berarti diberikan, tidak dicentang berarti dicabut untuk
            pengguna tersebut. Izin <span className="font-mono font-semibold">assets.publish</span>{" "}
            hanya dapat diberikan oleh Super Admin — aturan ini ditegakkan juga di database (RPC).
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-64">Izin</TableHead>
                {orderedRoles.map((r) => (
                  <TableHead key={r.id} className="text-center">
                    {r.name === "super_admin" ? (
                      <Badge variant="default">Super Admin</Badge>
                    ) : (
                      <Badge variant="secondary">Admin</Badge>
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {PERMISSIONS.map((p) => (
                <TableRow key={p.code}>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-white">
                        {p.code}
                      </span>
                      {p.code === PUBLISH_PERMISSION && (
                        <Badge variant="warning" title="Hanya Super Admin yang dapat memberi izin ini — ditegakkan di database (RPC)">
                          Super Admin
                        </Badge>
                      )}
                      <span className="w-full text-xs text-slate-500">{p.description}</span>
                      {p.code === PUBLISH_PERMISSION && (
                        <span className="w-full text-xs text-amber-300">
                          Hanya Super Admin yang dapat memberi izin ini — ditegakkan di database
                          (RPC).
                        </span>
                      )}
                    </div>
                  </TableCell>
                  {orderedRoles.map((r) => {
                    const permId = permIdByCode[p.code];
                    const key = `${r.id}:${permId}`;
                    const checked = grants.has(key);
                    const locked = p.code === PUBLISH_PERMISSION && !isSuperAdmin;
                    return (
                      <TableCell key={key} className="text-center">
                        <Checkbox
                          aria-label={`${p.code} untuk ${r.name}`}
                          checked={checked}
                          disabled={locked || busyKey === key}
                          onChange={(e) => void handleToggle(r, p.code, e.target.checked)}
                        />
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
