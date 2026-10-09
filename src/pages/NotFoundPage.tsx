import { useNavigate } from "react-router-dom";
import { FileQuestion } from "lucide-react";
import { Button } from "../components/ui/button";

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <div className="rounded-full bg-white/5 p-5">
        <FileQuestion className="h-10 w-10 text-slate-400" />
      </div>
      <p className="font-mono text-sm font-semibold text-slate-400">404</p>
      <h1 className="text-2xl font-bold text-white">Halaman Tidak Ditemukan</h1>
      <p className="max-w-sm text-sm text-slate-500">
        Halaman yang Anda cari tidak ada atau sudah dipindahkan.
      </p>
      <div className="mt-2 flex gap-2">
        <Button variant="outline" onClick={() => void navigate("/")}>
          Ke Beranda
        </Button>
        <Button onClick={() => void navigate("/dashboard")}>Ke Dashboard</Button>
      </div>
    </div>
  );
}
