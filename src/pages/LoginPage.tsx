import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
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
  username: z.string().min(1, "Username wajib diisi"),
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
    const rawInput = data.username.trim();
    const uname = rawInput.toLowerCase();
    let email = rawInput;

    if (!uname.includes("@")) {
      const { data: resolved, error: rpcErr } = await supabase.rpc(
        "resolve_login_email",
        { p_username: uname }
      );
      if (!rpcErr && typeof resolved === "string" && resolved) {
        email = resolved;
      } else {
        email = `${uname}@inventory.internal`;
      }
    }

    const { error } = await signIn(email, data.password);
    if (error) {
      setFormError("Username atau kata sandi salah");
      return;
    }
    navigate(from, { replace: true });
  }

  return (
    <div className="relative flex min-h-[calc(100vh-4rem)] overflow-hidden bg-ink-50">
      {/* Glow latar */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_-10%,rgba(198,40,40,0.10),transparent_70%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_40%_40%_at_90%_110%,rgba(198,40,40,0.05),transparent_70%)]"
      />

      {/* Panel kiri — branding */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden border-r border-ink-200 bg-white p-12 lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 shadow-soft">
            <span className="font-display text-sm font-extrabold text-white">IW</span>
          </div>
          <div>
            <p className="font-display text-lg font-bold leading-tight text-ink-800">
              Inventory Warehouse
            </p>
            <p className="text-xs uppercase tracking-widest text-brand-600">
              Command Center
            </p>
          </div>
        </div>
        <div>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
            <ShieldCheck className="h-3.5 w-3.5" />
            Sistem terpadu aset & gudang
          </div>
          <h2 className="font-display text-4xl font-bold leading-tight tracking-tight text-ink-800">
            Operasional gudang,
            <br />
            dalam satu kendali.
          </h2>
          <p className="mt-4 max-w-md text-ink-500">
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
                className="rounded-xl border border-ink-200 bg-white p-3"
              >
                <p className="font-display text-sm font-bold text-brand-700">{t}</p>
                <p className="mt-1 text-xs text-ink-500">{d}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-ink-500">
          © {new Date().getFullYear()} Inventory Warehouse — Sistem Informasi Manajemen Aset &amp; Gudang
        </p>
      </div>

      {/* Panel kanan — form */}
      <div className="relative flex w-full items-center justify-center px-4 py-12 lg:w-1/2">
        <Card className="w-full max-w-md shadow-card">
          <CardHeader className="space-y-1">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 shadow-soft lg:hidden">
              <span className="font-display text-base font-extrabold text-white">IW</span>
            </div>
            <CardTitle className="font-display text-2xl text-ink-800">Selamat datang kembali</CardTitle>
            <CardDescription>
              Masuk untuk mengakses command center operasional.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  autoComplete="username"
                  placeholder="username"
                  {...register("username")}
                />
                {errors.username && (
                  <p className="text-xs text-brand-600">{errors.username.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Kata sandi</Label>
                  <Link
                    to="/lupa-password"
                    className="text-xs font-medium text-brand-700 hover:text-brand-700"
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
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-500 hover:text-ink-700"
                    aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-xs text-brand-600">{errors.password.message}</p>
                )}
              </div>
              {formError && (
                <p className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-600">
                  {formError}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Masuk ke Command Center
              </Button>
            </form>
            <p className="mt-6 text-center text-sm text-ink-500">
              Belum punya akun? Hubungi administrator sistem Anda.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
