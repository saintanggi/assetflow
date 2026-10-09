import { useNavigate } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { Button } from "../components/ui/button";

export function ForbiddenPage() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <div className="rounded-full bg-red-50 p-5">
        <ShieldAlert className="h-10 w-10 text-red-500" />
      </div>
      <p className="font-mono text-sm font-semibold text-slate-400">403</p>
      <h1 className="text-2xl font-bold text-navy-900">Akses Ditolak</h1>
      <p className="max-w-sm text-sm text-slate-500">
        Anda tidak memiliki izin untuk mengakses halaman ini. Hubungi administrator jika Anda
        merasa ini keliru.
      </p>
      <Button className="mt-2" onClick={() => void navigate("/dashboard")}>
        Kembali ke Dashboard
      </Button>
    </div>
  );
}
