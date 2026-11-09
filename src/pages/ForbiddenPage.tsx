import { useNavigate } from "react-router-dom";
import type { HTMLAttributes } from "react";
import { ShieldAlert } from "lucide-react";
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

export function ForbiddenPage() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <GlassCard className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <div className="rounded-full bg-brand-500/15 p-4 ring-1 ring-inset ring-brand-500/25">
            <ShieldAlert className="h-8 w-8 text-brand-200" />
          </div>
          <p className="tnum font-mono text-sm font-semibold text-ink-300">403</p>
          <h1 className="font-display text-xl font-bold text-white">Akses Ditolak</h1>
          <p className="max-w-sm text-sm text-ink-300">
            Anda tidak memiliki izin untuk mengakses halaman ini. Hubungi administrator jika Anda
            merasa ini keliru.
          </p>
          <Button className="mt-2" onClick={() => void navigate("/dashboard")}>
            Kembali ke Dashboard
          </Button>
        </CardContent>
      </GlassCard>
    </div>
  );
}
