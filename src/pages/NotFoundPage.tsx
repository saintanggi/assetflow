import { useNavigate } from "react-router-dom";
import { FileQuestion } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <div className="rounded-full bg-ink-100 p-4 ring-1 ring-inset ring-ink-200">
            <FileQuestion className="h-8 w-8 text-ink-500" />
          </div>
          <p className="tnum font-mono text-sm font-semibold text-ink-500">404</p>
          <h1 className="font-display text-xl font-bold text-ink-800">Halaman Tidak Ditemukan</h1>
          <p className="max-w-sm text-sm text-ink-500">
            Halaman yang Anda cari tidak ada atau sudah dipindahkan.
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={() => void navigate("/")}>
              Ke Beranda
            </Button>
            <Button onClick={() => void navigate("/dashboard")}>Ke Dashboard</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
