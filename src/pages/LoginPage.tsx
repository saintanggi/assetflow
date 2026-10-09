import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";

const loginSchema = z.object({
  email: z.string().min(1, "Email wajib diisi").email("Masukkan alamat email yang valid"),
  password: z.string().min(1, "Kata sandi wajib diisi"),
});

type LoginForm = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { user, loading: authLoading, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const from = (location.state as { from?: string } | undefined)?.from ?? "/dashboard";

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  if (!authLoading && user) {
    return <Navigate to={from} replace />;
  }

  async function onSubmit(data: LoginForm) {
    setFormError(null);
    const { error } = await signIn(data.email, data.password);
    if (error) {
      setFormError("Email atau kata sandi salah");
      return;
    }
    navigate(from, { replace: true });
  }

  return (
    <div className="relative flex min-h-[calc(100vh-4rem)] overflow-hidden bg-ink-950">
      {/* Glow latar */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_-10%,rgba(45,212,191,0.12),transparent_70%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_40%_40%_at_90%_110%,rgba(251,191,36,0.06),transparent_70%)]"
      />

      {/* Panel kiri — branding */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden border-r border-white/5 p-10 lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 shadow-glow">
            <span className="font-display text-sm font-extrabold text-ink-950">IW</span>
          </div>
          <div>
            <p className="font-display text-lg font-bold leading-tight text-white">
              Inventory Warehouse
            </p>
            <p className="text-[11px] uppercase tracking-widest text-brand-400/80">
              Command Center
            </p>
          </div>
        </div>
        <div>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-brand-400/30 bg-brand-400/10 px-3 py-1 text-xs font-medium text-brand-300">
            <ShieldCheck className="h-3.5 w-3.5" />
            Sistem terpadu aset & gudang
          </div>
          <h2 className="font-display text-4xl font-bold leading-tight tracking-tight text-white">
            Operasional gudang,
            <br />
            dalam satu kendali.
          </h2>
          <p className="mt-4 max-w-md text-slate-400">
            Pencatatan aset tetap, persediaan, dan transaksi dalam satu command
            center yang akurat, transparan, dan siap diaudit.
          </p>
          <div className="mt-8 grid max-w-md grid-cols-3 gap-3">
            {[
              ["Real-time", "Stok & transaksi"],
              ["Audit-ready", "Jejak tercatat"],
              ["Aman", "Kontrol akses peran"],
            ].map(([t, d]) => (
              <div
                key={t}
                className="rounded-xl border border-white/10 bg-white/5 p-3 backdrop-blur"
              >
                <p className="font-display text-sm font-bold text-brand-300">{t}</p>
                <p className="mt-1 text-xs text-slate-500">{d}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-slate-400">
          © {new Date().getFullYear()} Inventory Warehouse — Sistem Informasi Manajemen Aset &amp; Gudang
        </p>
      </div>

      {/* Panel kanan — form */}
      <div className="relative flex w-full items-center justify-center px-4 py-12 lg:w-1/2">
        <Card className="w-full max-w-md shadow-card">
          <CardHeader className="space-y-1">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 shadow-glow lg:hidden">
              <span className="font-display text-base font-extrabold text-ink-950">IW</span>
            </div>
            <CardTitle className="font-display text-2xl text-white">Selamat datang kembali</CardTitle>
            <CardDescription>
              Masuk untuk mengakses command center operasional.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="nama@perusahaan.id"
                  {...register("email")}
                />
                {errors.email && (
                  <p className="text-xs text-rose-400">{errors.email.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Kata sandi</Label>
                  <Link
                    to="/lupa-password"
                    className="text-xs font-medium text-brand-300 hover:text-brand-200"
                  >
                    Lupa kata sandi?
                  </Link>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="pr-10"
                    {...register("password")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-xs text-rose-400">{errors.password.message}</p>
                )}
              </div>
              {formError && (
                <p className="rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-300">
                  {formError}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Masuk ke Command Center
              </Button>
            </form>
            <p className="mt-6 text-center text-sm text-slate-500">
              Belum punya akun? Hubungi administrator sistem Anda.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
