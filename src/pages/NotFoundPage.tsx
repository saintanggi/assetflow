import { useNavigate } from "react-router-dom";
import type { HTMLAttributes } from "react";
import { FileQuestion } from "lucide-react";
import { Button } from "../components/ui/button";
import { CardContent } from "../components/ui/card";
import { cn } from "../lib/utils";

/** Permukaan kaca gelap — sama seperti dashboard. */
function GlassCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/15 bg-white/[0.07] shadow-[0_8px_32px_rgba(2,6,23,0.35)] backdrop-blur-xl transition-all duration-300 hover:border-white/25 hover:bg-white/[0.09]",
        className
      )}
      {...props}
    />
  );
}

/** Tombol outline di atas kaca gelap (ganti bawaan putih). */
const DARK_OUTLINE_BTN =
  "border-white/20 bg-white/10 text-white hover:border-white/25 hover:bg-white/15 hover:text-white";

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <GlassCard className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <div className="rounded-full bg-white/10 p-4 ring-1 ring-inset ring-white/15">
            <FileQuestion className="h-8 w-8 text-ink-300" />
          </div>
          <p className="tnum font-mono text-sm font-semibold text-ink-300">404</p>
          <h1 className="font-display text-xl font-bold text-white">Halaman Tidak Ditemukan</h1>
          <p className="max-w-sm text-sm text-ink-300">
            Halaman yang Anda cari tidak ada atau sudah dipindahkan.
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={() => void navigate("/")} className={DARK_OUTLINE_BTN}>
              Ke Beranda
            </Button>
            <Button onClick={() => void navigate("/dashboard")}>Ke Dashboard</Button>
          </div>
        </CardContent>
      </GlassCard>
    </div>
  );
}
