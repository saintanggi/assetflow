import { useNavigate } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";

export function ForbiddenPage() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <div className="rounded-full bg-brand-50 p-4 ring-1 ring-inset ring-brand-100">
            <ShieldAlert className="h-8 w-8 text-brand-600" />
          </div>
          <p className="tnum font-mono text-sm font-semibold text-ink-500">403</p>
          <h1 className="font-display text-xl font-bold text-ink-800">Akses Ditolak</h1>
          <p className="max-w-sm text-sm text-ink-500">
            Anda tidak memiliki izin untuk mengakses halaman ini. Hubungi administrator jika Anda
            merasa ini keliru.
          </p>
          <Button className="mt-2" onClick={() => void navigate("/dashboard")}>
            Kembali ke Dashboard
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
